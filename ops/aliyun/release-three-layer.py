#!/usr/bin/python3 -I
"""Separate manual adapter. bundle is local; deploy/rollback are fixed-path root operations."""
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
import tarfile
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
TOOLS = ('release-three-layer.py', 'release.py', 'release-layers.py', 'three-layer-release.py', 'release-public-policy.json')


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
    if manifest.get('releaseId') != sha or set(manifest.get('layers', {})) != {'code', 'runtime', 'assets'}:
        raise ValueError('Invalid outer release/layer identity')
    expected = {f'releases/{sha}.json': None}
    for kind, layer in manifest['layers'].items():
        identity = layer['identity']
        if not HEX64.fullmatch(identity):
            raise ValueError('Invalid outer layer identity')
        base = f'layers/{kind}-{identity}'
        if layer['index'] != base + '.json' or layer['archive'] != base + '.tgz':
            raise ValueError('Invalid outer layer path')
        expected[layer['index']] = (identity, layer['indexBytes'])
        expected[layer['archive']] = (layer['archiveSha256'], layer['archiveBytes'])
    if len(expected) != 7:
        raise ValueError('Outer transport must contain exactly seven files')
    return expected


def bundle(store, manifest_path, output, manifest_sha):
    layers, _ = load_tools()
    store, manifest_path, output = map(layers.absolute, (store, manifest_path, output))
    store = layers.root_path(store)
    layers.ancestors_safe(output)
    if output.is_relative_to(store) or os.path.lexists(output):
        raise ValueError('Bundle output must be new and outside the store')
    body = layers.read_regular(manifest_path)
    if len(body) > MAX_MANIFEST or layers.digest(body) != manifest_sha:
        raise ValueError('Release manifest checksum mismatch')
    manifest = layers.parse(body)
    sha = manifest['releaseId']
    if not HEX40.fullmatch(sha) or manifest_path != store / 'releases' / (sha + '.json'):
        raise ValueError('Outer release manifest requires full SHA identity')
    expected = expected_files(manifest, sha)
    expected[f'releases/{sha}.json'] = (manifest_sha, len(body))
    entries = []
    for name, (checksum, size) in sorted(expected.items()):
        source = layers.checked_store_file(store, name, checksum, size)
        entries.append({'path': name, 'type': 'file', 'mode': 0o644, 'bytes': source.stat().st_size, 'sha256': checksum})
    if sum(entry['bytes'] for entry in entries) > MAX_OUTER:
        raise ValueError('Outer transport exceeds bounded payload size')
    layers.directory(output.parent)
    with tempfile.TemporaryDirectory(prefix='.bundle-', dir=output.parent) as pending:
        archive = Path(pending) / 'transport.tgz'
        checksum, size = layers.make_archive(store, archive, entries)
        layers.rename_no_replace(archive, output)
    return {'bundle': str(output), 'outerSha256': checksum, 'bytes': size, 'manifestSha256': manifest_sha, 'productionReady': False}


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
    with tarfile.open(archive, 'r:gz') as tar:
        members = []
        total = 0
        for item in tar:
            members.append(item)
            total += item.size
            if len(members) > 7 or total > MAX_OUTER:
                raise ValueError('Outer member count or payload exceeds bound')
        if len(members) != 7 or len({item.name for item in members}) != 7:
            raise ValueError('Outer transport must contain seven unique regular files')
        if sum(item.size for item in members) > MAX_OUTER:
            raise ValueError('Outer extracted payload exceeds bound')
        for item in members:
            layers.safe_name(item.name)
            if item.type not in (tarfile.REGTYPE, tarfile.AREGTYPE) or item.size < 0:
                raise ValueError('Outer payload permits regular files only')
        manifest_name = f'releases/{sha}.json'
        candidates = [item for item in members if item.name == manifest_name]
        if len(candidates) != 1 or candidates[0].size > MAX_MANIFEST:
            raise ValueError('Outer manifest is missing or oversized')
        with tar.extractfile(candidates[0]) as stream:
            body = stream.read(MAX_MANIFEST + 1)
        if layers.digest(body) != manifest_sha:
            raise ValueError('Release manifest checksum mismatch')
        manifest = layers.parse(body)
        expected = expected_files(manifest, sha)
        expected[manifest_name] = (manifest_sha, len(body))
        if set(expected) != {item.name for item in members}:
            raise ValueError('Outer payload has extra/missing members')
        for item in members:
            expected_sha, size = expected[item.name]
            if item.size != size:
                raise ValueError('Outer member size mismatch')
            target = destination / item.name
            layers.directory(target.parent)
            with tar.extractfile(item) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o600)
            if sha_file(target) != expected_sha:
                raise ValueError('Outer member checksum mismatch')
    return manifest, body


NATIVE_PROBE = r"""(async()=>{const sharp=require('sharp'),path=require('node:path');let codecs=0;
for(const [file,font] of [['NotoSansCJKsc-Regular.otf','Noto Sans CJK SC 24'],['NotoSansCJKsc-Bold.otf','Noto Sans CJK SC Bold 24']]){
const buffer=await sharp({text:{text:'中文 Aa 123',font,fontfile:path.join(process.env.ZIMAGE_SHARED_FONT_DIR,file),rgba:true,dpi:72}}).png().toBuffer();
const source=await sharp(buffer).metadata();if(source.format!=='png'||!source.width||!source.height)throw Error('native');
for(const codec of ['jpeg','webp','avif']){
const encoded=await sharp(buffer).toFormat(codec).toBuffer();const metadata=await sharp(encoded).metadata();
if(metadata.width!==source.width||metadata.height!==source.height||metadata.format!==({jpeg:'jpeg',webp:'webp',avif:'heif'})[codec]||(codec==='avif'&&metadata.compression!=='av1'))throw Error('codec');codecs++;}}
if(codecs!==6)throw Error('codec count');console.log(JSON.stringify({native:true,fonts:2,codecs}));
})().catch(()=>{console.error('Native/font verification failed');process.exit(1)})"""


def native_probe(candidate, environment, runner=subprocess.run):
    command = ['/usr/sbin/runuser', '--user', 'zimage', '--', '/usr/bin/env', '-i', 'PATH=' + SAFE_PATH, 'NODE_ENV=production']
    command += [key + '=' + environment[key] for key in ('ZIMAGE_SHARED_FONT_DIR', 'ZIMAGE_STATIC_ASSET_SHA256')]
    command += [str(NODE), '-e', NATIVE_PROBE]
    result = runner(command, cwd=candidate / 'apps/web', check=True, capture_output=True, text=True, timeout=90,
                    env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'})
    if result.returncode or json.loads(result.stdout) != {'native': True, 'fonts': 2, 'codecs': 6}:
        raise RuntimeError('Non-root native/font candidate verification failed')


def service_preflight():
    owned(DROPIN, ancestors=True)
    if DROPIN.read_text() != SYSTEMD_TEMPLATE:
        raise ValueError('Install the exact reviewed systemd assets template manually before deployment')
    user = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=User', '--value'], text=True).strip()
    group = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=Group', '--value'], text=True).strip()
    files = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=EnvironmentFiles', '--value'], text=True)
    if user != 'zimage' or group != 'zimage' or not re.search(r'(?:^|\s)/opt/zimage/current/\.runtime-assets\.env(?:\s|$)', files):
        raise ValueError('Service must retain User/Group=zimage and load the per-release assets environment')


class Adapter:
    """Internal dependency injection exists for local fixtures, never as CLI path arguments."""
    def __init__(self, root, layers, legacy, native_check=native_probe, service_check=service_preflight):
        self.root, self.layers, self.legacy = Path(root).absolute(), layers, legacy
        self.uid = os.geteuid()
        self.native_check, self.service_check = native_check, service_check
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
        build, asset = manifest.get('build', {}), manifest.get('assetsVersion', '')
        if (manifest.get('productionReady') is not False or manifest.get('releaseId') != sha or manifest.get('distDir') != '.next'
                or any(build.get(key) != sha for key in ('sourceCommit', 'marker', 'buildId'))
                or not HEX64.fullmatch(asset) or manifest.get('assemblyCacheRoot') != str(self.root / 'layer-cache')
                or manifest.get('compiledAssetBaseUrl') != 'https://www.zimage.store/static-assets/' + asset):
            raise ValueError('Production identity/configuration gates reject this artifact; original manifest is never rewritten')

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
        base = self.layers.validate_compiled_assets(config, manifest['assetsVersion'])
        if (config.get('distDir') not in ('.next', './.next') or config.get('env', {}).get('ZIMAGE_BUILD_SHA') != sha
                or (candidate / 'apps/web/.next/BUILD_ID').read_text().strip() != sha
                or base != 'https://www.zimage.store/static-assets/' + manifest['assetsVersion']):
            raise ValueError('Production candidate actual config/build marker mismatch')
        for entry in entries:
            if entry['type'] == 'symlink' and not (candidate / entry['path']).resolve(strict=False).is_relative_to(candidate):
                raise ValueError('Production candidate original symlink escapes managed final graph')

    def compare_retained(self, existing, candidate):
        def inventory(root):
            result = {}
            for current, dirs, files in os.walk(root, followlinks=False):
                for name in dirs + files:
                    target = Path(current) / name
                    info = target.lstat()
                    relative = target.relative_to(root).as_posix()
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

    def deploy(self, sha, outer_sha, manifest_sha, run):
        if not HEX40.fullmatch(sha) or not HEX64.fullmatch(outer_sha) or not HEX64.fullmatch(manifest_sha) or not re.fullmatch(r'[0-9]{1,20}', run):
            raise ValueError('Invalid fixed deployment arguments')
        with self.locked():
            old = self.current_target()
            sequence = self.root / 'last-deployment-run'
            if os.path.lexists(sequence):
                owned(sequence, self.uid)
                previous = sequence.read_text().strip()
                if not re.fullmatch(r'[0-9]{1,20}', previous):
                    raise ValueError('Invalid retained deployment run')
                if int(run) < int(previous) or (int(run) == int(previous) and old.name != sha):
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
                manifest, body = unpack_outer(archive, unpacked, sha, manifest_sha, self.layers)
                self.validate_manifest(manifest, sha)
                store = self.root / 'layer-store'
                entries = []
                for kind in ('code', 'runtime'):
                    index = self.layers.parse((unpacked / manifest['layers'][kind]['index']).read_bytes())
                    for entry in index['entries']:
                        name = entry['path']
                        if (name in ('.release-sha', '.archive-sha256', '.manifest-sha256', '.runtime-assets.env')
                                or name == 'apps/web/.next/cache' or name.startswith('apps/web/.next/cache/')):
                            raise ValueError('Incoming archive claims reserved adapter/cache path')
                    entries.extend(index['entries'])
                for name in expected_files(manifest, sha):
                    self.install_file(unpacked / name, store / name)
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
            if self.current_target() != old:
                raise ValueError('Current changed before activation')
            self.legacy.activate(target)
            self.write_sequence(run)
            return {'release': str(target), 'previous': str(old), 'reused': reused, 'productionReady': False,
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
            self.legacy.activate(target, restore_previous_on_failure=False)
            return {'release': str(target), 'productionReady': False, 'externalVerificationRequired': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='mode', required=True)
    producer = commands.add_parser('bundle')
    producer.add_argument('store', type=Path)
    producer.add_argument('manifest', type=Path)
    producer.add_argument('output', type=Path)
    producer.add_argument('--manifest-sha256', required=True)
    deploy = commands.add_parser('deploy')
    for name in ('sha', 'outer_sha256', 'manifest_sha256', 'run_number'):
        deploy.add_argument(name)
    rollback = commands.add_parser('rollback')
    rollback.add_argument('sha')
    commands.add_parser('systemd-template')
    args = parser.parse_args()
    if args.mode == 'systemd-template':
        print(SYSTEMD_TEMPLATE, end='')
        return
    if args.mode == 'bundle':
        result = bundle(args.store, args.manifest, args.output, args.manifest_sha256)
    else:
        if os.geteuid() != 0 or not sys.flags.isolated:
            raise RuntimeError('Use root with /usr/bin/python3 -I and the reviewed fixed tool installation')
        layers, legacy = load_tools(strict=True)  # Validate the complete import closure first.
        owned(NODE, ancestors=True)
        with safe_node_environment():
            operation = Adapter(ROOT, layers, legacy)
            result = operation.deploy(args.sha, args.outer_sha256, args.manifest_sha256, args.run_number) if args.mode == 'deploy' else operation.rollback(args.sha)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Three-layer operation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
