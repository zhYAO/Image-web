"""Export/verify an unactivated Mac business-code candidate, never a Linux release.

No install, network, service or activation actions exist here. Linux canonical
assembly must retain package-release.mjs's original target/native/layer gates.
"""
import argparse
import gzip
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile


def sibling(name, alias):
    spec = importlib.util.spec_from_file_location(alias, Path(__file__).with_name(name))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


layers = sibling('three-layer-release.py', 'business_layers')
handoff = sibling('linux-handoff.py', 'business_source_handoff')
canonical, digest = layers.canonical, layers.digest
MAX_BYTES, MAX_FILES, MAX_FILE, MAX_JSON = 512_000_000, 20_000, 128_000_000, 10_000_000
SHA40, SHA64 = re.compile(r'[a-f0-9]{40}'), re.compile(r'[a-f0-9]{64}')
CONFIG_SOURCES = layers.CONFIG_SOURCES
PACKAGES = ('package.json', 'apps/web/package.json', 'packages/domain/package.json')
NEXT_ROOT = 'apps/web/.next/'
ROOT_FILES = {'BUILD_ID', 'package.json', 'app-build-manifest.json', 'build-manifest.json',
              'prerender-manifest.json', 'react-loadable-manifest.json', 'required-server-files.json',
              'routes-manifest.json', 'server-reference-manifest.json', 'app-path-routes-manifest.json'}
SERVER_SUFFIXES = {'.js', '.json', '.html', '.rsc', '.meta', '.body', '.txt', '.css'}
STATIC_SUFFIXES = SERVER_SUFFIXES | {'.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.avif', '.woff', '.woff2', '.ttf', '.eot'}
NATIVE_MAGIC = {b'\x7fELF', b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf',
                b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}


def checksum(value, pattern=SHA64):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError('Invalid checksum or commit')
    return value


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def regular(path, limit=MAX_FILE):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Input link is forbidden: ' + str(path))
    path = path.absolute()
    # Resolve system aliases such as /tmp, but never a link below the caller's
    # selected input root. Tree traversal separately rejects those links.
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError('Expected bounded regular file: ' + str(path))
    body = layers.read_regular(path.resolve())
    if len(body) > limit:
        raise ValueError('File exceeds byte bound')
    return body


def json_file(path, expected=None):
    body = regular(path, MAX_JSON)
    if expected is not None and digest(body) != checksum(expected):
        raise ValueError('Manifest checksum mismatch')
    return parse_json(body), body


def parse_json(body):
    value = layers.parse(body)
    def finite(item):
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError('Nonfinite JSON value is forbidden')
        if isinstance(item, dict):
            for member in item.values(): finite(member)
        elif isinstance(item, list):
            for member in item: finite(member)
    finite(value)
    return value


def directory(path):
    path = Path(path)
    if path.is_symlink() or not path.is_dir():
        raise ValueError('Expected real input directory: ' + str(path))
    return path.resolve()


def safe_path(name):
    if not isinstance(name, str) or len(name.encode()) > 1024 or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError('Unsafe business path characters or length')
    p = PurePosixPath(name)
    if not name or p.is_absolute() or str(p) != name or '\\' in name or '..' in p.parts:
        raise ValueError('Unsafe relative business path')
    if any(part.startswith('.env') or part in {'.npmrc', '.netrc', '.git', '.ssh'} for part in p.parts):
        raise ValueError('Forbidden environment or credential path')


def safe_name(name, frozen_source=False):
    safe_path(name)
    if frozen_source:
        if not handoff.allowed(name) or str(PurePosixPath(name)) != name or '\\' in name:
            raise ValueError('Unsafe frozen Source path')
    else:
        layers.safe_name(name)


def tree_fingerprint(root):
    """Builder audit's complete tree formula; never follows directory links.

    Environment paths are omitted before stat/read, matching the transport's
    exclusion boundary. The actual frozen build contains no such paths.
    """
    root = directory(root)
    entries, total = [], 0
    for current, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [n for n in dirs if not n.startswith('.env')]
        for name in dirs + files:
            if name.startswith('.env'): continue
            p = Path(current) / name; relative = p.relative_to(root).as_posix(); safe_path(relative)
            info = p.lstat()
            if stat.S_ISLNK(info.st_mode):
                entries.append({'path': relative, 'kind': 'symlink', 'target': os.readlink(p)})
            elif stat.S_ISREG(info.st_mode):
                body = regular(p); total += len(body)
                entries.append({'path': relative, 'kind': 'file', 'bytes': len(body), 'sha256': digest(body), 'mode': stat.S_IMODE(info.st_mode)})
            elif not stat.S_ISDIR(info.st_mode):
                raise ValueError('Unsupported compiled tree file type')
            if len(entries) > MAX_FILES or total > MAX_BYTES:
                raise ValueError('Compiled tree exceeds bound')
    return digest(json.dumps(sorted(entries, key=lambda e: e['path']), sort_keys=True, separators=(',', ':')).encode())


def compiled_binding(receipt, dist, identity):
    location = receipt.get('actualDist')
    if (not isinstance(location, str) or not Path(location).is_absolute() or Path(location).resolve() != dist
            or receipt.get('sourceManifestSha256') != identity['manifestSha256']):
        raise ValueError('Successful build receipt has wrong compiled directory or source manifest')
    for key, root in [('standaloneTreeFingerprintSha256', dist / 'standalone'), ('staticTreeFingerprintSha256', dist / 'static')]:
        expected = checksum(receipt.get(key))
        if tree_fingerprint(root) != expected:
            raise ValueError('Successful build compiled tree fingerprint mismatch: ' + key)


def native_guard(name, body):
    leaf = PurePosixPath(name).name.lower()
    if (leaf.endswith(('.node', '.dylib', '.dll', '.otf')) or re.search(r'\.so(?:\.[0-9]+)*\Z', leaf)
            or body[:4] in NATIVE_MAGIC or body[:2] == b'MZ'):
        raise ValueError('Native payload is forbidden in business code: ' + name)


def business_path(name):
    safe_name(name)
    parts = PurePosixPath(name).parts
    if 'node_modules' in parts or name.endswith(('.map', '.nft.json')):
        raise ValueError('Business path contains runtime or diagnostics: ' + name)
    if name in PACKAGES or name == 'apps/web/server.js':
        return
    if name.startswith(NEXT_ROOT):
        relative = name[len(NEXT_ROOT):]
        if relative in ROOT_FILES:
            return
        for prefix, suffixes in [('server/', SERVER_SUFFIXES), ('static/', STATIC_SUFFIXES)]:
            if relative.startswith(prefix) and PurePosixPath(relative).suffix in suffixes:
                return
    raise ValueError('Business path is not allowlisted: ' + name)


def node_identity(node):
    node = Path(node).resolve(strict=True)
    code = "const h=process.report.getReport().header; console.log(JSON.stringify({node:process.versions.node,abi:process.versions.modules,napi:process.versions.napi,platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime?'glibc-'+h.glibcVersionRuntime:null}))"
    body = subprocess.check_output([str(node), '-e', code], env={'PATH': str(node.parent) + ':/usr/bin:/bin'}, timeout=15)
    return parse_json(body)


def validate_host(host):
    if (not exact(host, ['node', 'abi', 'napi', 'platform', 'arch', 'libc']) or
            host['node'] != '24.19.0' or host['abi'] != '137' or host['napi'] != '10' or
            host['platform'] != 'darwin' or host['arch'] not in ('x64', 'arm64') or host['libc'] is not None):
        raise ValueError('Business export requires measured Mac Node24.19/ABI137/N-API10')


def source_identity(source, manifest_path, manifest_sha, commit):
    source = directory(source)
    manifest, body = json_file(manifest_path, manifest_sha)
    checksum(commit, SHA40)
    files = manifest.get('files')
    if (manifest.get('schema') != 1 or manifest.get('baseCommit') != commit or manifest.get('sourceState') != 'clean'
            or manifest.get('formalBuildEligible') is not True or not isinstance(files, list) or len(files) > MAX_FILES
            or manifest.get('fileCount') != len(files) or handoff.fingerprint(files) != manifest.get('fingerprintSha256')):
        raise ValueError('Source manifest identity mismatch')
    names = set()
    for item in files:
        name = item['path']; safe_name(name, frozen_source=True)
        if name in names:
            raise ValueError('Source manifest duplicate path')
        names.add(name)
        current = source
        for part in PurePosixPath(name).parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('Source link is forbidden')
        data = regular(current)
        if (len(data), digest(data), stat.S_IMODE(current.stat().st_mode)) != (item['bytes'], item['sha256'], item['mode']):
            raise ValueError('Source drift: ' + name)
    required = set(PACKAGES) | set(CONFIG_SOURCES) | {'pnpm-lock.yaml', 'pnpm-workspace.yaml'}
    if not required.issubset(names):
        raise ValueError('Source manifest misses dependency/config inputs')
    if json_file(source / 'package.json')[0].get('packageManager') != 'pnpm@11.19.0':
        raise ValueError('Source packageManager mismatch')
    return {'commit': commit, 'manifestSha256': digest(body), 'fingerprintSha256': manifest['fingerprintSha256'],
            'lockSha256': digest(regular(source / 'pnpm-lock.yaml')),
            'configSources': {name: digest(regular(source / name)) for name in CONFIG_SOURCES}}, len(files)


def validate_receipt(receipt, identity, count, host):
    expected = {'schema': 1, 'commit': identity['commit'], 'sourceFingerprintSha256': identity['fingerprintSha256'],
                'sourceFilesVerifiedAfterBuild': count, 'sourceArchiveVerified': True, 'lockSha256': identity['lockSha256'],
                'BUILD_ID': identity['commit'], 'buildPlatform': host['platform'] + '-' + host['arch'], 'runtimeAbi': host['abi'],
                'toolchain': {'node': host['node'], 'pnpm': '11.19.0'}, 'secretsInjected': False, 'serverStarted': False,
                'packagerCalled': False, 'productionReady': False, 'linuxRunnable': False}
    if not isinstance(receipt, dict) or any(receipt.get(k) != v or type(receipt.get(k)) is not type(v) for k, v in expected.items()):
        raise ValueError('Invalid or stale successful build receipt')
    timings = receipt.get('timings')
    if (not isinstance(timings, list) or [s.get('step') for s in timings] != ['install', 'next-build']
            or any(type(s.get('exitCode')) is not int or s['exitCode'] != 0 for s in timings)):
        raise ValueError('Invalid successful build receipt timings')
    checksum(receipt.get('publicConfigSha256')); checksum(receipt.get('staticAssetSha256'))


def omitted(name):
    parts = PurePosixPath(name).parts
    return ('node_modules' in parts or name == 'apps/web/public' or name.startswith('apps/web/public/')
            or any(p.startswith('.env') for p in parts)
            or name.endswith(('.map', '.nft.json')) or name.startswith('apps/web/server/apparel/fonts/')
            or any(name.startswith(NEXT_ROOT + p) for p in ('cache/', 'dev/', 'diagnostics/', 'types/'))
            or name in {NEXT_ROOT + p for p in ('trace', 'trace-build', 'turbopack')})


def collect_code(source, dist):
    paths = {}
    for root, prefix in [(directory(dist / 'standalone'), ''), (directory(dist / 'static'), NEXT_ROOT + 'static/')]:
        for current, dirs, files in os.walk(root, followlinks=False):
            for name in list(dirs) + files:
                path = Path(current) / name
                relative = prefix + path.relative_to(root).as_posix()
                if omitted(relative):
                    if name in dirs:
                        dirs.remove(name)
                    continue
                if path.is_symlink():
                    raise ValueError('Business link is forbidden: ' + relative)
                if path.is_dir():
                    continue
                body = regular(path); native_guard(relative, body); business_path(relative)
                if relative in paths and regular(paths[relative]) != body:
                    raise ValueError('Conflicting same-build business file: ' + relative)
                paths[relative] = path
    required = set(PACKAGES) | {'apps/web/server.js', NEXT_ROOT + 'BUILD_ID', NEXT_ROOT + 'required-server-files.json'}
    if not required.issubset(paths) or not any(n.startswith(NEXT_ROOT + 'server/') for n in paths) or not any(n.startswith(NEXT_ROOT + 'static/') for n in paths):
        raise ValueError('Missing required business build files')
    for name in PACKAGES:
        if regular(paths[name]) != regular(source / name):
            raise ValueError('Source package metadata differs from business output')
    if regular(paths[NEXT_ROOT + 'required-server-files.json']) != regular(dist / 'required-server-files.json'):
        raise ValueError('Same-build required-server-files mismatch')
    return paths


def build_identity(bodies, source, assets, public_config, receipt_sha):
    build_id = bodies[NEXT_ROOT + 'BUILD_ID'].decode('utf-8').strip()
    config_body = bodies[NEXT_ROOT + 'required-server-files.json']
    config = parse_json(config_body).get('config')
    if (build_id != source['commit'] or not isinstance(config, dict) or config.get('distDir') != '.next'
            or config.get('output') != 'standalone' or config.get('env', {}).get('ZIMAGE_BUILD_SHA') != source['commit']):
        raise ValueError('Stale business BUILD_ID, marker or canonical build config')
    server = bodies['apps/web/server.js'].decode('utf-8')
    match = re.search(r'^const nextConfig = (.+)\r?\n\r?\nprocess\.env\.__NEXT_PRIVATE_STANDALONE_CONFIG', server, re.M)
    serialized = parse_json(match[1]) if match else None
    normalized = dict(serialized, distDir=serialized.get('distDir', '').removeprefix('./')) if isinstance(serialized, dict) else None
    if normalized != config:
        raise ValueError('Serialized server.js config differs from same-build config')
    layers.asset_delivery(config, checksum(assets), 'same-origin-public', 2)
    checksum(public_config); checksum(receipt_sha)
    return {'buildId': build_id, 'marker': source['commit'], 'distDir': '.next', 'receiptSha256': receipt_sha,
            'assetsVersion': assets, 'publicConfigSha256': public_config, 'configSha256': digest(config_body),
            'serializedConfigSha256': digest(canonical(serialized)), 'dependencyResolution': layers.dependency_resolution(config)}


def validate_manifest(value, commit):
    if (not exact(value, ['schema', 'kind', 'productionReady', 'source', 'buildHost', 'build', 'files', 'totalBytes', 'archive'])
            or type(value['schema']) is not int or value['schema'] != 1 or value['kind'] != 'zimage-business-code'
            or value['productionReady'] is not False):
        raise ValueError('Invalid business candidate schema')
    validate_host(value['buildHost'])
    source = value['source']
    if not exact(source, ['commit', 'manifestSha256', 'fingerprintSha256', 'lockSha256', 'configSources']) or source['commit'] != checksum(commit, SHA40):
        raise ValueError('Source binding mismatch')
    for key in ('manifestSha256', 'fingerprintSha256', 'lockSha256'):
        checksum(source[key])
    if not exact(source['configSources'], CONFIG_SOURCES):
        raise ValueError('Source config fingerprint mismatch')
    for sha in source['configSources'].values(): checksum(sha)
    build = value['build']
    if not exact(build, ['buildId', 'marker', 'distDir', 'receiptSha256', 'assetsVersion', 'publicConfigSha256', 'configSha256', 'serializedConfigSha256', 'dependencyResolution']):
        raise ValueError('Invalid build binding')
    if build['buildId'] != commit or build['marker'] != commit or build['distDir'] != '.next':
        raise ValueError('Stale build binding')
    for key in ('receiptSha256', 'assetsVersion', 'publicConfigSha256', 'configSha256', 'serializedConfigSha256'): checksum(build[key])
    files = value['files']
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError('Business file count exceeds bound')
    names, total = [], 0
    for e in files:
        if (not exact(e, ['path', 'bytes', 'sha256', 'mode']) or type(e['bytes']) is not int or not 0 <= e['bytes'] <= MAX_FILE
                or type(e['mode']) is not int or e['mode'] not in (0o644, 0o755)):
            raise ValueError('Invalid business file entry')
        business_path(e['path']); native_guard(e['path'], b''); checksum(e['sha256'])
        names.append(e['path']); total += e['bytes']
    if (names != sorted(set(names)) or type(value['totalBytes']) is not int or total != value['totalBytes'] or total > MAX_BYTES
            or any(str(p) in set(names) for n in names for p in PurePosixPath(n).parents)):
        raise ValueError('Duplicate business path, collision or byte accounting mismatch')
    required = set(PACKAGES) | {'apps/web/server.js', NEXT_ROOT + 'BUILD_ID', NEXT_ROOT + 'required-server-files.json'}
    if not required.issubset(names) or not any(n.startswith(NEXT_ROOT + 'server/') for n in names) or not any(n.startswith(NEXT_ROOT + 'static/') for n in names):
        raise ValueError('Business payload closure is missing required files')
    if (not exact(value['archive'], ['bytes', 'sha256']) or type(value['archive']['bytes']) is not int
            or not 0 < value['archive']['bytes'] <= MAX_BYTES):
        raise ValueError('Invalid archive metadata')
    checksum(value['archive']['sha256'])


def inspect_archive(archive, manifest, extract_to=None):
    inspect_raw_ustar(archive)
    expected = {e['path']: e for e in manifest['files']}
    seen, evidence = set(), {}
    with tarfile.open(archive, 'r:gz') as tf:
        for member in tf:
            entry = expected.get(member.name)
            if (entry is None or member.name in seen or member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE)
                    or member.pax_headers or member.sparse is not None or member.linkname or member.size != entry['bytes']
                    or member.mode != entry['mode'] or member.uid != 0 or member.gid != 0):
                raise ValueError('Unsafe, duplicate or inconsistent business archive member')
            seen.add(member.name)
            with tf.extractfile(member) as stream:
                body = stream.read(MAX_FILE + 1)
            if len(body) != entry['bytes'] or digest(body) != entry['sha256']:
                raise ValueError('Business archive file checksum mismatch')
            native_guard(member.name, body)
            if member.name in {'apps/web/server.js', NEXT_ROOT + 'BUILD_ID', NEXT_ROOT + 'required-server-files.json'}:
                evidence[member.name] = body
            if extract_to is not None:
                target = extract_to / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output: output.write(body)
                target.chmod(entry['mode'])
        # tarfile stops at the first zero header. Reject hidden concatenated tar
        # members rather than accepting nonzero data after the end marker.
        tail_bytes = 0
        while True:
            tail = tf.fileobj.read(1024)
            if not tail: break
            tail_bytes += len(tail)
            if tail_bytes > 10240 or any(tail):
                raise ValueError('Unexpected data after business tar end marker')
    if seen != set(expected):
        raise ValueError('Business archive closure mismatch')
    expected_build = build_identity(evidence, manifest['source'], manifest['build']['assetsVersion'],
                                    manifest['build']['publicConfigSha256'], manifest['build']['receiptSha256'])
    if expected_build != manifest['build']:
        raise ValueError('Business compiled config binding mismatch')


def inspect_raw_ustar(archive):
    """Reject metadata headers tarfile would otherwise consume transparently."""
    count, total = 0, 0
    with gzip.open(archive, 'rb') as stream:
        while True:
            header = stream.read(512)
            if len(header) != 512:
                raise ValueError('Truncated USTAR header')
            if not any(header):
                second = stream.read(512)
                if len(second) != 512 or any(second):
                    raise ValueError('Invalid USTAR end marker')
                tail_bytes = 0
                while True:
                    tail = stream.read(1024)
                    if not tail: return
                    tail_bytes += len(tail)
                    if tail_bytes > 10240 or any(tail):
                        raise ValueError('Unexpected data after business tar end marker')
            if header[156:157] not in (b'0', b'\0') or header[257:265] != b'ustar\x0000':
                raise ValueError('Only regular USTAR headers are allowed; metadata is forbidden')
            if any(header[500:512]) or any(header[265:329]):
                raise ValueError('Unexpected USTAR metadata fields')
            item = tarfile.TarInfo.frombuf(header, 'utf-8', 'strict')
            if item.tobuf(format=tarfile.USTAR_FORMAT, encoding='utf-8', errors='strict') != header:
                raise ValueError('Noncanonical USTAR header or hidden header padding')
            raw_size = header[124:136]
            if not re.fullmatch(br'[0-7\x00 ]{12}', raw_size):
                raise ValueError('Invalid USTAR numeric size')
            size = int(raw_size.strip(b'\0 ') or b'0', 8)
            count += 1; total += size
            if size > MAX_FILE or total > MAX_BYTES or count > MAX_FILES:
                raise ValueError('USTAR payload exceeds bound')
            remaining = size
            while remaining:
                body = stream.read(min(remaining, 65536))
                if not body: raise ValueError('Truncated USTAR payload')
                remaining -= len(body)
            padding_size = (-size) % 512
            padding = stream.read(padding_size)
            if len(padding) != padding_size or any(padding):
                raise ValueError('Invalid nonzero USTAR member padding')


def verify_code(archive, manifest_path, manifest_sha, commit):
    manifest, body = json_file(manifest_path, manifest_sha)
    if canonical(manifest) != body:
        raise ValueError('Business manifest must be canonical JSON')
    validate_manifest(manifest, commit)
    archive = Path(archive)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size != manifest['archive']['bytes'] or layers.file_digest(archive) != manifest['archive']['sha256']:
        raise ValueError('Business archive checksum mismatch')
    inspect_archive(archive, manifest)
    return {'manifest': manifest, 'manifestSha256': digest(body), 'verifiedFiles': len(manifest['files']), 'productionReady': False}


def export_code(source, dist, source_manifest, source_sha, receipt_path, receipt_sha, commit, node, output):
    source, dist = directory(source), directory(dist)
    output = Path(output).absolute()
    if os.path.lexists(output) or output.resolve().is_relative_to(source) or source.is_relative_to(output.resolve()):
        raise ValueError('Output must be new and outside source')
    identity, count = source_identity(source, source_manifest, source_sha, commit)
    host = node_identity(node); validate_host(host)
    receipt, _ = json_file(receipt_path, receipt_sha); validate_receipt(receipt, identity, count, host)
    paths = collect_code(source, dist)
    compiled_binding(receipt, dist, identity)
    entries, evidence = [], {}
    for name, file in sorted(paths.items()):
        body = regular(file)
        entries.append({'path': name, 'bytes': len(body), 'sha256': digest(body), 'mode': 0o755 if file.stat().st_mode & 0o111 else 0o644})
        if name in {'apps/web/server.js', NEXT_ROOT + 'BUILD_ID', NEXT_ROOT + 'required-server-files.json'}: evidence[name] = body
    build = build_identity(evidence, identity, receipt['staticAssetSha256'], receipt['publicConfigSha256'], receipt_sha)
    if len(entries) > MAX_FILES or sum(e['bytes'] for e in entries) > MAX_BYTES:
        raise ValueError('Business payload exceeds bound')
    output.mkdir(mode=0o700)
    archive, manifest_path = output / 'business-code.tgz', output / 'business-code.json'
    try:
        with archive.open('xb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as tf:
                for entry in entries:
                    body = regular(paths[entry['path']])
                    if (len(body), digest(body)) != (entry['bytes'], entry['sha256']):
                        raise ValueError('Business input changed while archiving')
                    member = tarfile.TarInfo(entry['path']); member.mode = entry['mode']; member.size = entry['bytes']
                    tf.addfile(member, io.BytesIO(body))
        value = {'schema': 1, 'kind': 'zimage-business-code', 'productionReady': False, 'source': identity,
                 'buildHost': host, 'build': build, 'files': entries, 'totalBytes': sum(e['bytes'] for e in entries),
                 'archive': {'bytes': archive.stat().st_size, 'sha256': layers.file_digest(archive)}}
        body = canonical(value)
        with manifest_path.open('xb') as stream: stream.write(body)
        verify_code(archive, manifest_path, digest(body), commit)
        compiled_binding(receipt, dist, identity)
    except BaseException:
        shutil.rmtree(output)
        raise
    return {'archive': str(archive), 'manifest': str(manifest_path), 'manifestSha256': digest(body),
            'archiveSha256': value['archive']['sha256'], 'files': len(entries), 'productionReady': False, 'linuxRunnable': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    export = sub.add_parser('export')
    for name in ('source', 'dist', 'source-manifest', 'build-receipt', 'node', 'output'):
        export.add_argument('--' + name, type=Path, required=True)
    for name in ('source-manifest-sha256', 'build-receipt-sha256', 'commit'):
        export.add_argument('--' + name, required=True)
    verify = sub.add_parser('verify')
    verify.add_argument('--archive', type=Path, required=True); verify.add_argument('--manifest', type=Path, required=True)
    verify.add_argument('--manifest-sha256', required=True); verify.add_argument('--commit', required=True)
    args = parser.parse_args()
    if args.command == 'export':
        result = export_code(args.source, args.dist, args.source_manifest, args.source_manifest_sha256,
                             args.build_receipt, args.build_receipt_sha256, args.commit, args.node, args.output)
    else:
        result = verify_code(args.archive, args.manifest, args.manifest_sha256, args.commit)
        result.pop('manifest')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, KeyError, TypeError, UnicodeError, tarfile.TarError) as error:
        raise SystemExit('Business candidate failed: ' + str(error))
