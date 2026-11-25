"""Read-only capacity check for the receiver's post-stop verification paths."""
import hashlib
import os
import re

# The .rollback-check-*/app.pending tree is renamed, not duplicated. Allow for
# its wrappers, generated links/markers (manifest <= 1 MB), atomic journals,
# maintenance and pointer temporaries, plus a margin for filesystem metadata.
RESERVE_BYTES = 64 * 1024**2
RESERVE_INODES = 128
MAX_ENTRIES = 100_000  # As in the layer verifier, before implicit directories.


def _pinned_json(management, path, digest, limit):
    # bounded_json enforces managed ownership, type, size and strict JSON. The
    # deploy lock protects these immutable metadata files across the two reads.
    value = management.bounded_json(path, limit)
    with path.open('rb') as source:
        if hashlib.sha256(source.read(limit + 1)).hexdigest() != digest:
            raise ValueError(f'Headroom inventory digest differs: {path}')
    return value


def _scratch(root, sha, management, *, legacy_ok):
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('Expected exact release SHA for headroom check')
    target = root/'releases'/sha
    management.owned(target, directory=True)
    marker = target/'.three-layer-release.json'
    pin = target/'.manifest-sha256'
    if legacy_ok and not os.path.lexists(marker):
        if os.path.lexists(pin):
            raise ValueError('Missing retained layered activation manifest')
        return 0, 0  # Legacy font preflight does not unpack an app.
    management.owned(pin)
    with pin.open('rb') as source:
        digest = source.read(66)
    if not re.fullmatch(rb'[a-f0-9]{64}\n?', digest):
        raise ValueError('Invalid retained manifest digest')
    manifest = _pinned_json(management, marker, digest.decode().strip(), 1_000_000)
    if manifest['releaseId'] != sha:
        raise ValueError('Unexpected release in headroom check')
    payload = leaves = 0
    directories = set()
    for kind in ('runtime', 'assets', 'code'):
        layer = manifest['layers'][kind]
        identity = layer['identity']
        if not re.fullmatch('[a-f0-9]{64}', identity):
            raise ValueError('Unexpected layer identity in headroom check')
        if kind != 'code':
            # ensure_cache verifies an existing directory; don't budget a warm
            # cache and then let activation unpack a missing one after stop.
            management.owned(root/'layer-cache'/kind/identity, directory=True)
        if kind == 'assets':
            continue  # The app points to the managed asset cache.
        name = f'layers/{kind}-{identity}.json'
        if layer['index'] != name:
            raise ValueError('Unexpected layer index path in headroom check')
        entries = _pinned_json(management, root/'layer-store'/name, identity, 32*1024**2)['entries']
        if not isinstance(entries, list) or leaves + len(entries) > MAX_ENTRIES:
            raise ValueError('Layer headroom inventory exceeds bound')
        leaves += len(entries)
        for entry in entries:
            if entry['type'] == 'file':
                size = entry['bytes']  # Budget a full copy even for runtime hard links.
            elif entry['type'] == 'symlink':
                size = len(os.fsencode(entry['target']))
            else:
                raise ValueError('Unexpected layer entry in headroom check')
            if type(size) is not int or size < 0:
                raise ValueError('Invalid layer size in headroom check')
            payload += size
            name = entry['path']
            if len(os.fsencode(name)) >= 4096:
                raise ValueError('Layer path exceeds headroom inventory bound')
            parent = name.rpartition('/')[0]
            while parent and parent not in directories:
                directories.add(parent)
                if len(directories) > MAX_ENTRIES:
                    raise ValueError('Layer directory inventory exceeds bound')
                parent = parent.rpartition('/')[0]
    return payload, leaves + len(directories)


def check_headroom(root, etc, candidate, retained, management):
    """Call once under deploy.lock after preparation, before the first gate write."""
    scratch = (_scratch(root, candidate, management, legacy_ok=False),
               _scratch(root, retained, management, legacy_ok=True))
    paths = [root, etc, root/'frontend', root/'frontend/assets']
    old = root/'releases'/retained
    if not os.path.lexists(old/'.runtime-assets.env'):
        paths.append(old)  # Legacy font preflight may create its first binding here.
    for path in paths:
        management.owned(path, directory=True)
        fs = os.statvfs(path)
        if fs.f_frsize <= 0 or fs.f_bsize <= 0:
            raise ValueError(f'Unknown filesystem allocation size for headroom at {path}')
        needed_bytes, needed_inodes = RESERVE_BYTES, RESERVE_INODES
        if path == root:
            # Candidate verification is cleaned up before restoration begins.
            # The peaks for bytes and inodes may belong to different releases.
            # Allow a block per node for tail rounding/small directories, and a
            # second for directory entries and allocation overhead.
            block = max(fs.f_bsize, fs.f_frsize)
            needed_bytes += max(payload + 2*block*nodes for payload, nodes in scratch)
            needed_inodes += max(nodes for _, nodes in scratch)
        available = fs.f_bavail * fs.f_frsize
        if available < needed_bytes or fs.f_favail < needed_inodes:
            raise ValueError(f'Insufficient verification headroom at {path}: need {needed_bytes} bytes and '
                             f'{needed_inodes} inodes; have {available} bytes and {fs.f_favail} inodes')
