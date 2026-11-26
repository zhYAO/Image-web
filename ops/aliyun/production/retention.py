"""Prune retired code on the production host while holding the receiver's deploy lock."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

ROOT = Path('/opt/zimage')
KEEP_COUNT = 3
SHA = re.compile('[a-f0-9]{40}')
FRONT = re.compile('release-(?:[a-f0-9]{40}|[a-f0-9]{12})')
CODE = re.compile(r'code-[a-f0-9]{64}\.(?:json|tgz)')


def check(condition, message):
    if not condition:
        raise ValueError(message)


def owned(path, uid, kind):
    info = path.lstat()
    check(kind(info.st_mode) and info.st_uid == uid and
          (kind is stat.S_ISLNK or not info.st_mode & 0o022), f'Unexpected managed path: {path}')
    return info


def read(path, uid, limit=1_000_000):
    info = owned(path, uid, stat.S_ISREG)
    check(0 < info.st_size <= limit, f'Unexpected metadata size: {path}')
    with path.open('rb') as stream:
        return stream.read(limit + 1)


def linked_directory(link, parent, pattern, uid, *, optional=False):
    if optional and not os.path.lexists(link):
        return None
    owned(link, uid, stat.S_ISLNK)
    target = Path(os.path.abspath(link.parent / os.readlink(link)))
    check(target.parent == parent and pattern.fullmatch(target.name), f'Invalid pointer: {link}')
    if optional and not os.path.lexists(target):
        return None  # Old manual tooling may have left a dangling pointer.
    owned(target, uid, stat.S_ISDIR)
    return target.name


def code_files(path, body):
    manifest = json.loads(body)
    layer = manifest['layers']['code']
    identity = layer['identity']
    check(manifest['releaseId'] == path.stem and re.fullmatch('[a-f0-9]{64}', identity),
          f'Invalid release manifest: {path}')
    base = f'code-{identity}'
    names = (base + '.json', base + '.tgz')
    check((layer['index'], layer['archive']) == tuple('layers/' + name for name in names),
          f'Unexpected code objects: {path}')
    return names


def plan(root, live_directory, uid):
    back = root/'releases'
    front = root/'frontend/releases'
    aliases = root/'frontend/assets'
    manifests = root/'layer-store/releases'
    layers = root/'layer-store/layers'
    for path in (root, back, front.parent, front, aliases, manifests.parent, manifests, layers):
        owned(path, uid, stat.S_ISDIR)
    journal = root/'production-release.json'
    if not os.path.lexists(journal):
        return None
    state = json.loads(read(journal, uid, 4096))
    if state['phase'] != 'committed' or any(os.path.lexists(path) for path in
            (root/'current.backend-next', root/'frontend/current.pending-release')):
        return None

    current, current_front = state['new']
    previous, previous_front = state['old']
    check(SHA.fullmatch(current) and current_front == 'release-'+current and
          SHA.fullmatch(previous) and previous != current and
          previous_front in ('release-'+previous, 'release-'+previous[:12]), 'Unexpected journal pair')
    check(linked_directory(root/'current', back, SHA, uid) == current and
          linked_directory(root/'frontend/current', front, FRONT, uid) == current_front and
          live_directory() == back/current/'apps/web', 'Live release differs from the committed journal')

    backend = {path.name: path for path in back.iterdir() if SHA.fullmatch(path.name)}
    frontend = {path.name: path for path in front.iterdir() if FRONT.fullmatch(path.name)}
    mapped = {}
    dangling = []
    for link in aliases.iterdir():
        if FRONT.fullmatch(link.name):
            info = owned(link, uid, stat.S_ISLNK)
            check(os.readlink(link) == '../releases/'+link.name, f'Unexpected asset mapping: {link}')
            if link.name in frontend:
                mapped[link.name] = info.st_mtime_ns
            else:
                dangling.append(link)
    for path in (*backend.values(), *frontend.values()):
        owned(path, uid, stat.S_ISDIR)

    pinned = {current: current_front, previous: previous_front}
    third = sorted((sha for sha in backend if sha not in pinned and 'release-'+sha in mapped),
                   key=lambda sha: (mapped['release-'+sha], sha), reverse=True)
    for sha in third[:KEEP_COUNT - len(pinned)]:
        pinned[sha] = 'release-'+sha
    for sha, namespace in pinned.items():
        check(sha in backend and namespace in mapped, f'Missing retained pair: {sha}')
        check(read(back/sha/'.release-sha', uid, 64).decode('ascii').strip() == sha and
              json.loads(read(front/namespace/'version.json', uid, 4096))['frontendRelease'] == namespace,
              f'Retained release identity differs: {sha}')

    # Older tools used previous links and abbreviated namespaces. Preserve
    # still-resolvable references because the current receiver does not update them.
    keep = set(pinned)
    legacy_back = linked_directory(root/'previous', back, SHA, uid, optional=True)
    legacy_front = linked_directory(root/'frontend/previous', front, FRONT, uid, optional=True)
    if legacy_back:
        keep.add(legacy_back)
    for name in frontend:
        if len(name) == len('release-')+12 or name == legacy_front:
            keep.update(sha for sha in backend if sha.startswith(name[len('release-'):]))
    keep_front = set(pinned.values()) | {'release-'+sha for sha in keep}
    if legacy_front:
        keep_front.add(legacy_front)

    retired_front = sorted(name for name in frontend if SHA.fullmatch(name[len('release-'):]) and name not in keep_front)
    retired_back = sorted(set(backend) - keep)
    retired_manifests = []
    retained_code = set()
    verified_manifests = set()
    for path in sorted(manifests.glob('*.json')):
        body = read(path, uid)
        names = code_files(path, body)
        if SHA.fullmatch(path.stem) and path.stem not in keep:
            retired_manifests.append(path)
            continue
        for name in names:
            owned(layers/name, uid, stat.S_ISREG)
        if path.stem in keep:
            pin = read(back/path.stem/'.manifest-sha256', uid, 65).decode('ascii').strip()
            check(hashlib.sha256(body).hexdigest() == pin, f'Retained manifest checksum differs: {path}')
            verified_manifests.add(path.stem)
        retained_code.update(names)
    for sha in keep:
        if any(os.path.lexists(back/sha/name) for name in ('.manifest-sha256', '.three-layer-release.json')):
            check(sha in verified_manifests, f'Missing retained layered manifest: {sha}')
    retired_code = []
    for path in sorted(layers.iterdir()):
        if CODE.fullmatch(path.name) and path.name not in retained_code:
            owned(path, uid, stat.S_ISREG)
            retired_code.append(path)

    # References go first. If interrupted, the next pass collects any
    # remaining old files. rmtree never follows links to shared caches.
    paths = (sorted(dangling) + [aliases/name for name in retired_front if name in mapped] +
             [front/name for name in retired_front] + [back/sha for sha in retired_back] +
             retired_manifests + retired_code)
    return sorted(keep), paths


def runtime_directory():
    pid = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage.service', '-p', 'MainPID', '--value'],
                                  text=True, timeout=5).strip()
    check(pid.isdecimal() and int(pid) > 0, 'No production service PID')
    return (Path('/proc')/pid/'cwd').resolve(strict=True)


def run(root, live_directory, uid, *, apply):
    import fcntl

    owned(root, uid, stat.S_ISDIR)
    lock = root/'deploy.lock'
    owned(lock, uid, stat.S_ISREG)
    with os.fdopen(os.open(lock, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Retention deferred: deployment lock is held.', flush=True)
            return
        result = plan(root, live_directory, uid)
        if result is None:
            print('Retention deferred: there is no reconciled committed release.', flush=True)
            return
        keep, paths = result
        print('Kept backend releases: '+', '.join(keep), flush=True)
        if apply:
            check(shutil.rmtree.avoids_symlink_attacks, 'Retention requires symlink-safe directory removal')
        for path in paths:
            print(('Removing: ' if apply else 'Would remove: ')+str(path), flush=True)
            if apply:
                if stat.S_ISDIR(path.lstat().st_mode):
                    shutil.rmtree(path)
                else:
                    path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Remove the planned paths. Default prints the plan.')
    args = parser.parse_args()
    check(os.geteuid() == 0 and sys.flags.isolated and sys.dont_write_bytecode,
          'Run as root with python3 -I -B')
    check(ROOT.resolve(strict=True) == ROOT, 'Production root must not be a symlink')
    run(ROOT, runtime_directory, 0, apply=args.apply)


if __name__ == '__main__':
    main()
