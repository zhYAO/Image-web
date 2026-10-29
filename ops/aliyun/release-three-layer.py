#!/usr/bin/python3 -I
"""Fixed-root privileged layer adapter; offline bundle remains unprivileged."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = Path('/opt/zimage')
NODE = ROOT / 'toolchain/node-v24.19.0-linux-x64/bin/node'
DROPIN = Path('/etc/systemd/system/zimage.service.d/three-layer-assets.conf')
SYSTEMD_TEMPLATE = '[Service]\nEnvironmentFile=-/opt/zimage/current/.runtime-assets.env\n'
SAFE_PATH = str(NODE.parent) + ':/usr/sbin:/usr/bin:/sbin:/bin'
MAX_OUTER = 2_000_000_000
MAX_MANIFEST = 1_000_000
HEX40 = re.compile(r'[a-f0-9]{40}')
HEX64 = re.compile(r'[a-f0-9]{64}')
TOOLS = ('release-three-layer.py', 'release.py', 'release-layers.py', 'three-layer-release.py', 'release-transport.py', 'release-public-policy.json')
TARGET_CONFIG = Path('/etc/zimage/three-layer-target.json')
MAX_REQUEST = 16384


def sha_file(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


def signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode


def owned(path, uid=0, directory=False, ancestors=False):
    paths = [path, *path.parents] if ancestors else [path]
    for target in paths:
        info = target.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != uid or info.st_mode & 0o022:
            raise ValueError('Untrusted root-managed path: ' + str(target))
        expected_dir = directory if target == path else True
        if not (stat.S_ISDIR(info.st_mode) if expected_dir else stat.S_ISREG(info.st_mode)):
            raise ValueError('Unexpected root-managed path type: ' + str(target))


def load_tools(strict=False):
    parent = Path(__file__).absolute().parent
    if strict:
        owned(parent, directory=True, ancestors=True)
        for name in TOOLS:
            owned(parent / name)
        bytecode = parent / '__pycache__'
        if os.path.lexists(bytecode):
            owned(bytecode, directory=True)
            for path in bytecode.iterdir():
                owned(path)
    def load(name, alias):
        spec = importlib.util.spec_from_file_location(alias, parent / name)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    return load('three-layer-release.py', 'root_three_layers'), load('release.py', 'root_legacy_release')


def load_transport():
    spec = importlib.util.spec_from_file_location('root_release_transport', Path(__file__).with_name('release-transport.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def enabled_target_check(manifest=None):
    owned(TARGET_CONFIG, ancestors=True)
    if TARGET_CONFIG.stat().st_size > MAX_REQUEST:
        raise ValueError('Enabled target configuration exceeds bound')
    layers, _ = load_tools()
    config = layers.parse(layers.read_regular(TARGET_CONFIG))
    if not isinstance(config, dict) or set(config) != {'enabled', 'target'} or config['enabled'] is not True:
        raise ValueError('Administrator must install and explicitly enable the reviewed target configuration')
    target = config['target']
    layers.validate_target_shape(target)
    if target['runtime'] != layers.runtime_identity():
        raise ValueError('Enabled target differs from actual Node/ABI/Linux/glibc runtime')
    if manifest is not None and (manifest['runtime'] != target['runtime'] or
                                 (manifest['schema'] == 2 and manifest['target'] != target)):
        raise ValueError('Release target differs from administrator enabled target')
    return target


def read_inventory_request(stream):
    body = stream.read(MAX_REQUEST + 1)
    if len(body) > MAX_REQUEST:
        raise ValueError('Inventory request exceeds bounded stdin')
    return json.loads(body)


@contextmanager
def safe_node_environment():
    names = ('PATH', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')
    previous = {name: os.environ.get(name) for name in names}
    try:
        for name in names:
            os.environ.pop(name, None)
        os.environ['PATH'] = SAFE_PATH
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def expected_files(manifest, sha):
    return load_transport().required_files(manifest, sha)


def bundle(store, manifest_path, output, manifest_sha, inventory=None):
    return load_transport().bundle(store, manifest_path, output, manifest_sha, inventory)


def copy_incoming(root, sha, destination, checksum):
    """Anchor untrusted upload to directory FDs; copy once into root-controlled storage."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root_fd = os.open(root, flags)
    try:
        incoming_fd = os.open('incoming', flags, dir_fd=root_fd)
        try:
            source_fd = os.open(sha + '.layers.tgz', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=incoming_fd)
        finally:
            os.close(incoming_fd)
    finally:
        os.close(root_fd)
    with os.fdopen(source_fd, 'rb') as source, destination.open('xb') as output:
        destination.chmod(0o600)
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_OUTER:
            raise ValueError('Incoming outer payload must be a bounded regular file')
        digest, total = hashlib.sha256(), 0
        while True:
            block = source.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > MAX_OUTER:
                raise ValueError('Incoming outer payload exceeds size bound')
            digest.update(block)
            output.write(block)
        output.flush()
        os.fsync(output.fileno())
        if signature(before) != signature(os.fstat(source.fileno())) or total != before.st_size:
            raise ValueError('Incoming outer payload changed during root copy')
        if digest.hexdigest() != checksum:
            raise ValueError('Outer checksum mismatch')


def unpack_outer(archive, destination, sha, manifest_sha, layers):
    return load_transport().unpack_bundle(archive, destination, sha, manifest_sha)


def native_probe(candidate, environment, runner=subprocess.run):
    # One actual Sharp/hash payload shared with full-package activation.
    return load_tools()[1].native_probe(candidate, environment, runner=runner)


def service_preflight():
    owned(DROPIN, ancestors=True)
    if DROPIN.read_text() != SYSTEMD_TEMPLATE:
        raise ValueError('Install the exact reviewed systemd assets template manually before deployment')
    user = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=User', '--value'], text=True).strip()
    group = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=Group', '--value'], text=True).strip()
    files = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=EnvironmentFiles', '--value'], text=True)
    paths = re.findall(r'(/[^\s]+)', files)
    if user != 'zimage' or group != 'zimage' or not paths or paths[-1] != '/opt/zimage/current/.runtime-assets.env':
        raise ValueError('Service must retain User/Group=zimage and load the per-release assets environment LAST')


class Adapter:
    """Internal dependency injection exists for local fixtures, never as CLI path arguments."""
    def __init__(self, root, layers, legacy, native_check=native_probe, service_check=service_preflight,
                 target_check=enabled_target_check):
        self.root, self.layers, self.legacy = Path(root).absolute(), layers, legacy
        self.uid = os.geteuid()
        self.native_check, self.service_check = native_check, service_check
        self.transport, self.target_check = load_transport(), target_check
        self.layers.root_path(self.root)
        owned(self.root, self.uid, directory=True)
        for key, value in {'ROOT': self.root, 'INCOMING': self.root / 'incoming', 'RELEASES': self.root / 'releases',
                           'CURRENT': self.root / 'current', 'PREVIOUS': self.root / 'previous'}.items():
            setattr(legacy, key, value)

    def managed_directory(self, path):
        self.layers.directory(path)
        for current in (path, *path.parents):
            if current == self.root.parent:
                break
            owned(current, self.uid, directory=True)

    @contextmanager
    def locked(self):
        path = self.root / 'deploy.lock'
        if os.path.lexists(path):
            owned(path, self.uid)
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def current_target(self):
        current = self.root / 'current'
        if not current.is_symlink():
            raise ValueError('Current must be an exact retained full-SHA release')
        target = Path(os.path.abspath(current.parent / os.readlink(current)))
        if target.parent != self.root / 'releases' or not HEX40.fullmatch(target.name) or target.is_symlink() or not target.is_dir():
            raise ValueError('Current is not an exact retained full-SHA release')
        if target.resolve(strict=True) != target:
            raise ValueError('Current retained release has a symlink ancestor')
        owned(target, self.uid, directory=True)
        marker = target / '.release-sha'
        owned(marker, self.uid)
        if marker.read_text().strip() != target.name:
            raise ValueError('Current release marker does not match exact retained target')
        return target

    def validate_manifest(self, manifest, sha):
        self.layers.validate_manifest(manifest)
        build, asset = manifest.get('build', {}), manifest.get('assetsVersion', '')
        same_origin = (manifest.get('schema') == 2 and manifest.get('assetDeliveryMode') == 'same-origin-public'
                       and manifest.get('compiledAssetBaseUrl') is None)
        remote = (manifest.get('compiledAssetBaseUrl') == 'https://www.zimage.store/static-assets/' + asset
                  and (manifest.get('schema') == 1 or manifest.get('assetDeliveryMode') == 'remote'))
        if (manifest.get('productionReady') is not False or manifest.get('releaseId') != sha or manifest.get('distDir') != '.next'
                or any(build.get(key) != sha for key in ('sourceCommit', 'marker', 'buildId'))
                or not HEX64.fullmatch(asset) or manifest.get('assemblyCacheRoot') != str(self.root / 'layer-cache')
                or not (same_origin or remote)):
            raise ValueError('Production identity/configuration gates reject this artifact; original manifest is never rewritten')

    def initial_empty(self):
        for name in ('current', 'previous', 'current.next', 'previous.next', 'last-deployment-run'):
            if os.path.lexists(self.root / name):
                raise ValueError('Initial deployment requires no current/previous links or deployment sequence')
        releases = self.root / 'releases'
        if os.path.lexists(releases):
            owned(releases, self.uid, directory=True)
            if any(releases.iterdir()):
                raise ValueError('Initial deployment requires no retained releases')

    def checked_object(self, store, name, checksum, size):
        path = store / name
        owned(path, self.uid)
        for parent in path.parents:
            owned(parent, self.uid, directory=True)
            if parent == self.root:
                break
        return self.layers.checked_store_file(store, name, checksum, size)

    def inventory(self, request):
        request = self.transport._validated_request(request)
        self.target_check()
        found = {}
        store = self.root / 'layer-store'
        # Unlike advisory local inventory, corruption in a privileged immutable
        # store is fatal. Missing paths alone are reported absent.
        self.layers.ancestors_safe(store)
        if os.path.lexists(store):
            owned(store, self.uid, directory=True)
        for name, item in request['files'].items():
            path = self.layers.ancestors_safe(store / name)
            if not os.path.lexists(path):
                continue
            self.checked_object(store, name, item['sha256'], item['bytes'])
            found[name] = dict(item)
        return {'schema': 1, 'releaseSha': request['releaseSha'], 'files': found}

    def verify_store_closure(self, manifest, body, sha, manifest_sha):
        if self.layers.digest(body) != manifest_sha:
            raise ValueError('Trusted manifest checksum mismatch')
        store = self.root / 'layer-store'
        required = self.transport.required_files(manifest, sha, body)
        for name, (checksum, size) in required.items():
            self.checked_object(store, name, checksum, size)
        # Recheck indexes, schema bindings and accounting as well as byte hashes.
        self.transport.request(store, store / f'releases/{sha}.json', manifest_sha)
        return required

    def merge_transport(self, unpacked, manifest, body, provided, sha, manifest_sha):
        store = self.root / 'layer-store'
        required = self.transport.required_files(manifest, sha, body)
        if self.layers.digest(body) != manifest_sha or not set(provided).issubset(required):
            raise ValueError('Transport does not match trusted manifest closure')
        # Preflight every omission and every existing immutable object before
        # publishing even a single supplied file. Never overwrite corruption.
        for name, (checksum, size) in required.items():
            self.layers.ancestors_safe(store / name)
            if os.path.lexists(store / name) or name not in provided:
                self.checked_object(store, name, checksum, size)
        for name in provided:
            if provided[name] != required[name]:
                raise ValueError('Provided object differs from trusted manifest')
            self.layers.checked_store_file(unpacked, name, *required[name])
            self.install_file(unpacked / name, store / name)
        return self.verify_store_closure(manifest, body, sha, manifest_sha)

    def install_file(self, source, destination):
        self.managed_directory(destination.parent)
        if os.path.lexists(destination):
            owned(destination, self.uid)
            if destination.stat().st_size != source.stat().st_size or sha_file(destination) != sha_file(source):
                raise ValueError('Existing immutable store file differs')
            return
        descriptor, pending_name = tempfile.mkstemp(prefix='.pending-', dir=destination.parent)
        pending = Path(pending_name)
        try:
            with os.fdopen(descriptor, 'wb') as output, source.open('rb') as content:
                shutil.copyfileobj(content, output)
                output.flush()
                os.fsync(output.fileno())
            pending.chmod(0o444)
            os.link(pending, destination)
        finally:
            pending.unlink(missing_ok=True)

    def metadata(self, target, sha, outer_sha, manifest_sha, environment):
        values = {'.release-sha': sha + '\n', '.archive-sha256': outer_sha + '\n', '.manifest-sha256': manifest_sha + '\n',
                  '.runtime-assets.env': ''.join(key + '=' + environment[key] + '\n' for key in ('ZIMAGE_SHARED_FONT_DIR', 'ZIMAGE_STATIC_ASSET_SHA256'))}
        for name, value in values.items():
            with (target / name).open('x') as stream:
                stream.write(value)
            (target / name).chmod(0o600 if name == '.runtime-assets.env' else 0o644)

    def validate_candidate(self, candidate, manifest, sha, entries):
        config = self.layers.parse(self.layers.read_regular(candidate / 'apps/web/.next/required-server-files.json'))['config']
        base = self.layers.asset_delivery(config, manifest['assetsVersion'], manifest.get('assetDeliveryMode'), manifest['schema'])
        if (config.get('distDir') not in ('.next', './.next') or config.get('env', {}).get('ZIMAGE_BUILD_SHA') != sha
                or (candidate / 'apps/web/.next/BUILD_ID').read_text().strip() != sha
                or base != manifest.get('compiledAssetBaseUrl')):
            raise ValueError('Production candidate actual config/build marker mismatch')
        if manifest['schema'] == 2 and self.layers.dependency_resolution(config, manifest['inputRoots'].values()) != manifest['configFingerprint']['dependencyResolution']:
            raise ValueError('Production candidate actual dependency config differs')
        for entry in entries:
            if entry['type'] == 'symlink' and not (candidate / entry['path']).resolve(strict=False).is_relative_to(candidate):
                raise ValueError('Production candidate original symlink escapes managed final graph')

    def compare_retained(self, existing, candidate):
        # Require BOTH original audit files even though a cold/delta retry can
        # have a different outer value. Missing or nonregular metadata must not
        # disappear from both inventories and make damaged state compare equal.
        for root in (existing, candidate):
            marker = root / '.archive-sha256'
            owned(marker, self.uid)
            if not HEX64.fullmatch(self.layers.read_regular(marker).decode('ascii').strip()):
                raise ValueError('Invalid retained outer digest')
        def inventory(root):
            result = {}
            for current, dirs, files in os.walk(root, followlinks=False):
                for name in dirs + files:
                    target = Path(current) / name
                    info = target.lstat()
                    relative = target.relative_to(root).as_posix()
                    # Outer transport can differ for a byte-identical same-SHA
                    # retry (cold versus delta). Retain its original audit hash.
                    if relative == '.archive-sha256':
                        continue
                    if info.st_uid != self.uid:
                        raise ValueError('Existing retained release ownership mismatch')
                    if stat.S_ISLNK(info.st_mode):
                        result[relative] = ('link', os.readlink(target))
                    elif stat.S_ISDIR(info.st_mode):
                        result[relative] = ('dir', stat.S_IMODE(info.st_mode))
                    elif stat.S_ISREG(info.st_mode):
                        result[relative] = ('file', stat.S_IMODE(info.st_mode), info.st_size, sha_file(target))
                    else:
                        raise ValueError('Existing retained release has unsupported file type')
            return result
        owned(existing, self.uid, directory=True)
        if stat.S_IMODE(existing.stat().st_mode) != stat.S_IMODE(candidate.stat().st_mode) or inventory(existing) != inventory(candidate):
            raise ValueError('Existing retained release differs from freshly verified candidate')

    def cache_ownership(self, assembled):
        # Service-owned readonly files are not immutable: their owner can chmod
        # them. Validate root ownership before reusing any shared runtime inode.
        for reference in assembled['cache'].values():
            version = Path(reference['directory'])
            owned(version.parent, self.uid, directory=True)
            owned(version, self.uid, directory=True)
            for current, dirs, files in os.walk(version, followlinks=False):
                for name in dirs + files:
                    target = Path(current) / name
                    if target.lstat().st_uid != self.uid:
                        raise ValueError('Shared cache must be root-owned: ' + str(target))

    def recheck_caches(self, manifest):
        references = {}
        for kind in ('runtime', 'assets'):
            layer = manifest['layers'][kind]
            body = self.layers.read_regular(self.root / 'layer-store' / layer['index'])
            if kind == 'assets':
                entries, _ = self.layers.resource_entries(body)
                entries = entries + [{'path': 'asset-manifest.json', 'type': 'file', 'mode': 0o644,
                                      'bytes': len(body), 'sha256': layer['identity']}]
            else:
                entries = self.layers.parse(body)['entries']
            version = self.layers.ancestors_safe(self.root / 'layer-cache' / kind / layer['identity'])
            self.layers.verify_tree(version, entries, readonly=True)
            references[kind] = {'directory': str(version)}
        self.cache_ownership({'cache': references})

    def write_sequence(self, run):
        descriptor, pending_name = tempfile.mkstemp(prefix='.run-', dir=self.root)
        pending = Path(pending_name)
        try:
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(run + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(pending, self.root / 'last-deployment-run')
        finally:
            pending.unlink(missing_ok=True)

    def deploy(self, sha, outer_sha, manifest_sha, run, initial=False):
        if not HEX40.fullmatch(sha) or not HEX64.fullmatch(outer_sha) or not HEX64.fullmatch(manifest_sha) or not re.fullmatch(r'[0-9]{1,20}', run):
            raise ValueError('Invalid fixed deployment arguments')
        with self.locked():
            if initial:
                self.initial_empty()
                old = None
            else:
                old = self.current_target()
            self.target_check()
            sequence = self.root / 'last-deployment-run'
            if os.path.lexists(sequence):
                owned(sequence, self.uid)
                previous = sequence.read_text().strip()
                if not re.fullmatch(r'[0-9]{1,20}', previous):
                    raise ValueError('Invalid retained deployment run')
                if int(run) < int(previous) or (int(run) == int(previous) and (old is None or old.name != sha)):
                    raise ValueError('Refusing an older or reused deployment run')
            self.service_check()
            for name in ('layer-store', 'layer-cache', 'releases'):
                self.managed_directory(self.root / name)
            mutable = self.layers.ancestors_safe(self.root / 'cache')
            if not mutable.is_dir():
                raise ValueError('Existing managed mutable Next cache is missing')
            with tempfile.TemporaryDirectory(prefix='.three-incoming-', dir=self.root) as incoming:
                protected = Path(incoming)
                archive = protected / 'transport.tgz'
                copy_incoming(self.root, sha, archive, outer_sha)
                unpacked = protected / 'unpacked'
                manifest, body, provided = unpack_outer(archive, unpacked, sha, manifest_sha, self.layers)
                self.validate_manifest(manifest, sha)
                self.target_check(manifest)
                store = self.root / 'layer-store'
                self.merge_transport(unpacked, manifest, body, provided, sha, manifest_sha)
                entries = []
                for kind in ('code', 'runtime'):
                    index = self.layers.parse(self.layers.read_regular(store / manifest['layers'][kind]['index']))
                    for entry in index['entries']:
                        name = entry['path']
                        if (name in ('.release-sha', '.archive-sha256', '.manifest-sha256', '.runtime-assets.env')
                                or name == 'apps/web/.next/cache' or name.startswith('apps/web/.next/cache/')):
                            raise ValueError('Incoming archive claims reserved adapter/cache path')
                    entries.extend(index['entries'])
                candidate_parent = Path(tempfile.mkdtemp(prefix='.three-candidate-', dir=self.root / 'releases'))
                candidate_parent.chmod(0o755)
                candidate = candidate_parent / 'app'
                try:
                    assembled = self.layers.assemble(store / f'releases/{sha}.json', store, candidate, self.root / 'layer-cache', manifest_sha, True)
                    self.cache_ownership(assembled)
                    environment = assembled['environment']
                    cache = candidate / 'apps/web/.next/cache'
                    cache.symlink_to(mutable, target_is_directory=True)
                    self.validate_candidate(candidate, manifest, sha, entries)
                    self.metadata(candidate, sha, outer_sha, manifest_sha, environment)
                    self.native_check(candidate, environment)
                    target = self.root / 'releases' / sha
                    reused = os.path.lexists(target)
                    if reused:
                        if target.is_symlink():
                            raise ValueError('Existing release target must not be a symlink')
                        self.compare_retained(target, candidate)
                    else:
                        self.layers.rename_no_replace(candidate, target)
                finally:
                    self.layers.remove_owned(candidate_parent)
            # The old target is captured under exactly the same lock as legacy deploy.
            self.verify_store_closure(manifest, body, sha, manifest_sha)
            self.recheck_caches(manifest)
            if initial:
                for name in ('current', 'previous', 'last-deployment-run'):
                    if os.path.lexists(self.root / name):
                        raise ValueError('Initial installation changed before activation')
                self.legacy.activate_initial(target)
            else:
                if self.current_target() != old:
                    raise ValueError('Current changed before activation')
                self.legacy.activate(target)
            self.write_sequence(run)
            return {'release': str(target), 'previous': str(old) if old else None, 'initial': initial, 'reused': reused, 'productionReady': False,
                    'activatedLocally': True, 'externalVerificationRequired': True, 'manifestSha256': manifest_sha}

    def rollback(self, sha):
        if not HEX40.fullmatch(sha):
            raise ValueError('Rollback requires an exact retained full SHA')
        with self.locked():
            self.current_target()
            self.service_check()
            target = self.root / 'releases' / sha
            owned(target, self.uid, directory=True)
            owned(target / '.release-sha', self.uid)
            if (target / '.release-sha').read_text().strip() != sha:
                raise ValueError('Retained rollback identity mismatch')
            marker = target / '.three-layer-release.json'
            if os.path.lexists(marker):
                self.verify_retained_layered(target, sha)
            elif os.path.lexists(target / '.manifest-sha256'):
                raise ValueError('Retained layered rollback manifest is missing')
            self.legacy.activate(target, restore_previous_on_failure=False)
            return {'release': str(target), 'productionReady': False, 'externalVerificationRequired': True}

    def verify_retained_layered(self, target, sha):
        marker = target / '.three-layer-release.json'
        for name in ('.three-layer-release.json', '.manifest-sha256', '.archive-sha256', '.runtime-assets.env'):
            owned(target / name, self.uid)
        body = self.layers.read_regular(marker)
        manifest_sha = (target / '.manifest-sha256').read_text().strip()
        outer_sha = (target / '.archive-sha256').read_text().strip()
        if not HEX64.fullmatch(manifest_sha) or not HEX64.fullmatch(outer_sha):
            raise ValueError('Invalid retained layered digests')
        manifest = self.layers.parse(body)
        self.validate_manifest(manifest, sha)
        self.target_check(manifest)
        self.verify_store_closure(manifest, body, sha, manifest_sha)
        store = self.root / 'layer-store'
        entries = []
        for kind in ('code', 'runtime'):
            entries.extend(self.layers.parse(self.layers.read_regular(store / manifest['layers'][kind]['index']))['entries'])
        # Assembly checks actual caches, runtime ABI/libc and native headers;
        # comparison also pins every retained file, link and resource env pair.
        with tempfile.TemporaryDirectory(prefix='.rollback-check-', dir=self.root) as pending:
            candidate = Path(pending) / 'app'
            assembled = self.layers.assemble(store / f'releases/{sha}.json', store, candidate,
                                             self.root / 'layer-cache', manifest_sha, True)
            self.cache_ownership(assembled)
            (candidate / 'apps/web/.next/cache').symlink_to(self.root / 'cache', target_is_directory=True)
            self.validate_candidate(candidate, manifest, sha, entries)
            self.metadata(candidate, sha, outer_sha, manifest_sha, assembled['environment'])
            self.compare_retained(target, candidate)
            self.native_check(target, assembled['environment'])
            self.verify_store_closure(manifest, body, sha, manifest_sha)
            self.recheck_caches(manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='mode', required=True)
    producer = commands.add_parser('bundle')
    producer.add_argument('store', type=Path)
    producer.add_argument('manifest', type=Path)
    producer.add_argument('output', type=Path)
    producer.add_argument('--manifest-sha256', required=True)
    producer.add_argument('--inventory', type=Path)
    deploy = commands.add_parser('deploy')
    for name in ('sha', 'outer_sha256', 'manifest_sha256', 'run_number'):
        deploy.add_argument(name)
    deploy.add_argument('--initial-deploy', action='store_true', help='Explicit verified empty installation only')
    rollback = commands.add_parser('rollback')
    rollback.add_argument('sha')
    commands.add_parser('systemd-template')
    commands.add_parser('inventory', help='Bounded request JSON on stdin; fixed immutable store only')
    commands.add_parser('check-target', help='Verify installed enabled target against actual runtime')
    args = parser.parse_args()
    if args.mode == 'systemd-template':
        print(SYSTEMD_TEMPLATE, end='')
        return
    if args.mode == 'bundle':
        inventory = json.loads(args.inventory.read_bytes()) if args.inventory else None
        result = bundle(args.store, args.manifest, args.output, args.manifest_sha256, inventory)
    else:
        if os.geteuid() != 0 or not sys.flags.isolated:
            raise RuntimeError('Use root with /usr/bin/python3 -I and the reviewed fixed tool installation')
        layers, legacy = load_tools(strict=True)  # Validate the complete import closure first.
        owned(ROOT, directory=True, ancestors=True)
        owned(NODE, ancestors=True)
        with safe_node_environment():
            operation = Adapter(ROOT, layers, legacy)
            if args.mode == 'deploy':
                result = operation.deploy(args.sha, args.outer_sha256, args.manifest_sha256, args.run_number, initial=args.initial_deploy)
            elif args.mode == 'rollback':
                result = operation.rollback(args.sha)
            elif args.mode == 'inventory':
                with operation.locked():
                    result = operation.inventory(read_inventory_request(sys.stdin.buffer))
            else:
                result = {'enabled': True, 'target': enabled_target_check(), 'productionReady': False}
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Three-layer operation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
