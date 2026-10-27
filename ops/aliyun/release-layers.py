"""Opt-in LOCAL prototype. No network, package install, service or activation code.

pack consumes an already staged self-contained release; assemble restores its
original paths so Node/pnpm, Next public/static and font lookup need no changes.
"""
import argparse
import ctypes
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

KINDS = ('code', 'dependencies', 'static', 'fonts')
MAX_CODE = 10_000_000
MAX_RAW = 2_000_000_000
MAX_ENTRIES = 100_000
FONT_ROOT = 'apps/web/server/apparel/fonts/'
POLICY = json.loads(Path(__file__).with_name('release-public-policy.json').read_text())
EXCLUDED = {'apps/web/public/' + name for name in POLICY['excludedSourceFiles']}
GENERATED_MAP_ROOTS = tuple(POLICY['generatedSourcemapRoots'])
GENERATED_TRACE_ROOTS = tuple(POLICY['generatedBuildTraceRoots'])


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def runtime_identity():
    code = """const h=process.report.getReport().header;
console.log(JSON.stringify({node:process.versions.node,abi:process.versions.modules,
platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime?`glibc-${h.glibcVersionRuntime}`:'non-glibc'}));"""
    return json.loads(subprocess.check_output(['node', '-e', code], text=True))


def kind_for(name):
    if 'node_modules' in PurePosixPath(name).parts:
        return 'dependencies'
    if name.startswith(FONT_ROOT):
        return 'fonts'
    # Generated browser JS/CSS changes with application builds and belongs in
    # the daily code budget. Only public assets form the reusable static layer.
    if name.startswith('apps/web/public/'):
        return 'static'
    return 'code'


def installed_versions(root, name):
    candidates = [root / 'apps/web/node_modules' / name / 'package.json',
                  root / 'node_modules' / name / 'package.json']
    candidates.extend((root / 'node_modules/.pnpm').glob('*/node_modules/' + name + '/package.json'))
    versions = set()
    for candidate in candidates:
        if candidate.is_file():
            if not candidate.resolve().is_relative_to(root):
                raise ValueError('Dependency metadata escapes release input')
            versions.add(json.loads(candidate.read_text())['version'])
    if not versions:
        raise ValueError('Required traced dependency is absent: ' + name)
    return sorted(versions)


def disjoint(left, right, description):
    if left.is_relative_to(right) or right.is_relative_to(left):
        raise ValueError(description + ' must not overlap')


def validate_store(store):
    for name in ('layers', 'releases'):
        target = store / name
        if target.is_symlink() or not target.resolve().is_relative_to(store):
            raise ValueError('Unsafe layer store output directory: ' + str(target))
        if target.exists() and not target.is_dir():
            raise ValueError('Layer store output is not a directory')


def safe_name(name):
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or str(path) != name or '\\' in name
            or any(part in ('.', '..') or part.startswith('.env') for part in path.parts)
            or name == '.layer-release.json' or name in EXCLUDED):
        raise ValueError('Unsafe or excluded release path: ' + name)
    return path


def inventory(root):
    entries = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if relative.endswith('.map') and relative.startswith(GENERATED_MAP_ROOTS):
                continue  # Kept in the packager's separate debug archive/input.
            safe_name(relative)
            if path.is_symlink():
                target = os.readlink(path)
                # Standalone traces can retain unused pnpm aliases whose optional
                # targets were not traced. Preserve these; layers themselves are
                # checked independently, and required Next/Sharp metadata is read.
                resolved = path.resolve(strict=False)
                if os.path.isabs(target) or not resolved.is_relative_to(root):
                    raise ValueError('Unsafe external symlink: ' + relative)
                entries.append({'path': relative, 'type': 'symlink', 'target': target, 'mode': 0o777})
            elif path.is_file():
                if relative.endswith('.js.nft.json') and relative.startswith(GENERATED_TRACE_ROOTS):
                    continue  # Build-copy metadata retained in its separate archive/input.
                entries.append({'path': relative, 'type': 'file', 'bytes': path.stat().st_size,
                                'sha256': file_digest(path), 'mode': 0o755 if path.stat().st_mode & 0o111 else 0o644})
            elif not path.is_dir():
                raise ValueError('Unsupported file type: ' + relative)
    entries.sort(key=lambda entry: entry['path'])
    if len(entries) > MAX_ENTRIES or sum(e.get('bytes', 0) for e in entries) > MAX_RAW:
        raise ValueError('Release exceeds size budget')
    return entries


def publish_bytes(path, data, reuse=False):
    """Publish a fully written sibling with an exclusive hard link; never replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
    pending = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            if not reuse or path.is_symlink() or path.read_bytes() != data:
                raise ValueError('Existing immutable file differs or release ID is already used: ' + str(path))
    finally:
        pending.unlink()


def make_archive(root, target, entries, compression_level=6):
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.pending-', dir=target.parent)
    pending = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            with gzip.GzipFile(fileobj=stream, filename='', mode='wb', mtime=0, compresslevel=compression_level) as compressed:
                with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
                    for entry in entries:
                        item = tarfile.TarInfo(entry['path'])
                        item.mode = entry['mode']
                        if entry['type'] == 'symlink':
                            item.type, item.linkname = tarfile.SYMTYPE, entry['target']
                            archive.addfile(item)
                        else:
                            source = root / entry['path']
                            item.size = entry['bytes']
                            before = source.stat()
                            if before.st_size != entry['bytes']:
                                raise ValueError('Input size changed since inventory: ' + entry['path'])
                            with source.open('rb') as content:
                                archive.addfile(item, content)
                            after = source.stat()
                            if (before.st_ino, before.st_mtime_ns, before.st_ctime_ns, before.st_size) != (after.st_ino, after.st_mtime_ns, after.st_ctime_ns, after.st_size):
                                raise ValueError('Input changed during packaging: ' + entry['path'])
                            if file_digest(source) != entry['sha256']:
                                raise ValueError('Input changed since inventory: ' + entry['path'])
            stream.flush()
            os.fsync(stream.fileno())
        archive_sha = file_digest(pending)
        try:
            os.link(pending, target)
        except FileExistsError:
            if target.is_symlink() or file_digest(target) != archive_sha:
                raise ValueError('Existing immutable archive differs: ' + str(target))
        return archive_sha, pending.stat().st_size
    finally:
        pending.unlink()


def pack(source, store, project, release_id, expected_sha, sample_label, budget):
    source, store, project = source.resolve(), store.resolve(), project.resolve()
    disjoint(source, store, 'Input release and layer store')
    disjoint(project, store, 'Project and layer store')
    validate_store(store)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}', release_id):
        raise ValueError('Invalid release ID')
    if not re.fullmatch(r'[a-f0-9]{40}', expected_sha):
        raise ValueError('Expected build SHA must be a full commit SHA')
    if not 0 < budget <= MAX_CODE:
        raise ValueError('Invalid code budget')
    release_path = store / 'releases' / (release_id + '.json')
    if os.path.lexists(release_path):
        raise ValueError('Release ID is already used')
    runtime = runtime_identity()
    if runtime['platform'] != 'linux':
        raise ValueError('This local prototype supports Linux only')
    config = json.loads((source / 'apps/web/.next/required-server-files.json').read_text())['config']
    actual_sha = config.get('env', {}).get('ZIMAGE_BUILD_SHA')
    expected_versions = json.loads((project / 'apps/web/package.json').read_text())['dependencies']
    actual_versions = {name: installed_versions(source, name) for name in ('next', 'sharp')}
    matches = actual_sha == expected_sha and all(actual_versions[n] == [expected_versions[n]] for n in actual_versions)
    if not matches and not sample_label:
        raise ValueError('Build SHA or dependency version mismatch; a non-production sample requires --sample-label')
    entries = inventory(source)
    files = {entry['path'] for entry in entries if entry['type'] == 'file'}
    for required in ('apps/web/.next/BUILD_ID', 'apps/web/.next/required-server-files.json'):
        if required not in files:
            raise ValueError('Required build output is missing: ' + required)
    for prefix in ('apps/web/.next/static/', 'apps/web/.next/server/'):
        if not any(name.startswith(prefix) for name in files):
            raise ValueError('Required build output is missing: ' + prefix)
    for required in ('apps/web/server.js', FONT_ROOT + 'NotoSansCJKsc-Regular.otf', FONT_ROOT + 'NotoSansCJKsc-Bold.otf'):
        if required not in files:
            raise ValueError('Required runtime file is missing: ' + required)
    # Matching marker/version strings establish provenance checks, not a working
    # production application. Every output of this local prototype stays gated.
    manifest = {'schema': 1, 'releaseId': release_id, 'productionReady': False,
                'sampleLabel': sample_label or 'Local layered packaging prototype; not a production artifact',
                'expectedBuildSha': expected_sha, 'actualBuildSha': actual_sha,
                'actualVersions': actual_versions, 'expectedVersions': {n: expected_versions[n] for n in actual_versions},
                'runtime': runtime, 'lockSha256': file_digest(project / 'pnpm-lock.yaml'), 'layers': {}}
    for kind in KINDS:
        members = [entry for entry in entries if kind_for(entry['path']) == kind]
        if not members:
            raise ValueError('Required layer is empty: ' + kind)
        binding = {'lockSha256': manifest['lockSha256'], 'runtime': runtime} if kind == 'dependencies' else {}
        index = {'schema': 1, 'kind': kind, 'binding': binding, 'entries': members}
        compression_level = 9 if kind == 'code' else 6
        if kind == 'code':
            index['encoding'] = {'archive': 'tar-pax', 'compression': 'gzip', 'level': compression_level}
        index_bytes = canonical(index)
        identity = digest(index_bytes)
        base = f'layers/{kind}-{identity}'
        archive_path, index_path = base + '.tgz', base + '.json'
        archive_sha, archive_bytes = make_archive(source, store / archive_path, members, compression_level)
        publish_bytes(store / index_path, index_bytes, reuse=True)
        manifest['layers'][kind] = {'identity': identity, 'archive': archive_path, 'archiveSha256': archive_sha,
                                   'archiveBytes': archive_bytes, 'index': index_path, 'indexBytes': len(index_bytes),
                                   'rawBytes': sum(entry.get('bytes', 0) for entry in members)}
    body = canonical(manifest)
    code = manifest['layers']['code']
    daily = len(body) + code['archiveBytes'] + code['indexBytes']
    if daily > budget:
        raise ValueError(f'Daily code budget exceeded: {daily} > {budget} bytes; no release manifest published')
    publish_bytes(release_path, body)
    first = len(body) + sum(layer['archiveBytes'] + layer['indexBytes'] for layer in manifest['layers'].values())
    return {'manifest': str(release_path), 'manifestSha256': digest(body), 'productionReady': manifest['productionReady'],
            'dailyCodeBytes': daily, 'dailyCodeMiB': daily / 1048576, 'firstInstallBytes': first,
            'firstInstallMiB': first / 1048576, 'layers': manifest['layers']}


def checked_file(store, name, sha, size):
    safe_name(name)
    path = store / name
    if path.is_symlink() or not path.resolve().is_relative_to(store):
        raise ValueError('Unsafe layer store path')
    if path.stat().st_size != size or file_digest(path) != sha:
        raise ValueError('Layer size or checksum mismatch: ' + name)
    return path


def no_replace_directory(source, destination):
    """Linux atomic directory publication, including non-cooperating contenders."""
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1):
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number), str(destination))


def assemble(manifest_path, store, destination, expected_digest, allow_sample):
    manifest_path, store = manifest_path.resolve(), store.resolve()
    destination = destination.absolute()
    disjoint(destination.resolve(), store, 'Assembly destination and layer store')
    validate_store(store)
    body = manifest_path.read_bytes()
    if digest(body) != expected_digest:
        raise ValueError('Release manifest checksum mismatch')
    manifest = json.loads(body)
    if manifest['schema'] != 1 or set(manifest['layers']) != set(KINDS):
        raise ValueError('Unsupported release manifest')
    if not allow_sample:
        raise ValueError('Local prototype assembly requires --allow-sample')
    if manifest['productionReady'] is not False:
        raise ValueError('Local prototype manifest must remain non-production')
    if manifest['runtime'] != runtime_identity():
        raise ValueError('Runtime fingerprint mismatch')
    if os.path.lexists(destination):
        raise ValueError('Assembly destination already exists')
    indexes, archives, all_entries = {}, {}, {}
    for kind in KINDS:
        layer = manifest['layers'][kind]
        base = f'layers/{kind}-{layer["identity"]}'
        if layer['index'] != base + '.json' or layer['archive'] != base + '.tgz':
            raise ValueError('Layer path does not match its identity')
        index_file = checked_file(store, layer['index'], layer['identity'], layer['indexBytes'])
        index = json.loads(index_file.read_bytes())
        binding = {'lockSha256': manifest['lockSha256'], 'runtime': manifest['runtime']} if kind == 'dependencies' else {}
        if index['schema'] != 1 or index['kind'] != kind or index['binding'] != binding:
            raise ValueError('Layer binding mismatch')
        indexes[kind] = index
        archives[kind] = checked_file(store, layer['archive'], layer['archiveSha256'], layer['archiveBytes'])
        for entry in index['entries']:
            name = entry['path']
            safe_name(name)
            if name in all_entries or kind_for(name) != kind or entry['type'] not in ('file', 'symlink'):
                raise ValueError('Duplicate, misclassified or unsupported layer entry')
            if entry['mode'] not in (0o644, 0o755, 0o777) or entry.get('bytes', 0) < 0:
                raise ValueError('Invalid layer entry metadata')
            all_entries[name] = entry
    if len(all_entries) > MAX_ENTRIES or sum(entry.get('bytes', 0) for entry in all_entries.values()) > MAX_RAW:
        raise ValueError('Assembled release exceeds size budget')
    for name in all_entries:
        for parent in PurePosixPath(name).parents:
            if str(parent) in all_entries:
                raise ValueError('Entry traverses another file or symlink')
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.' + destination.name + '.pending-', dir=destination.parent))
    try:
        links = []
        for kind in KINDS:
            expected = {entry['path']: entry for entry in indexes[kind]['entries']}
            with tarfile.open(archives[kind], 'r:gz') as archive:
                for item in archive:
                    if item.name not in expected:
                        raise ValueError('Unexpected or repeated archive entry')
                    entry = expected.pop(item.name)
                    target = staging / item.name
                    if item.mode != entry['mode']:
                        raise ValueError('Archive permission mismatch')
                    if entry['type'] == 'symlink':
                        if not item.issym() or item.linkname != entry['target'] or os.path.isabs(item.linkname):
                            raise ValueError('Archive symlink mismatch')
                        links.append((target, item.linkname))
                    else:
                        if not item.isfile() or item.size != entry['bytes']:
                            raise ValueError('Archive file metadata mismatch')
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.extractfile(item) as source, target.open('xb') as output:
                            shutil.copyfileobj(source, output)
                        if file_digest(target) != entry['sha256']:
                            raise ValueError('Extracted file checksum mismatch')
                        target.chmod(entry['mode'])
            if expected:
                raise ValueError('Archive is missing indexed entries')
        for target, link in links:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(link)
        for target, _ in links:
            if not target.resolve(strict=False).is_relative_to(staging):
                raise ValueError('Assembled symlink escapes release')
        for required in ('apps/web/server.js', FONT_ROOT + 'NotoSansCJKsc-Regular.otf', FONT_ROOT + 'NotoSansCJKsc-Bold.otf'):
            target = staging / required
            if target.is_symlink() or not target.is_file():
                raise ValueError('Assembled runtime file is missing')
        (staging / '.layer-release.json').write_bytes(body)
        no_replace_directory(staging, destination)
    finally:
        if staging.exists():
            shutil.rmtree(staging)  # Only this invocation's new, unpublished scratch.
    return {'destination': str(destination), 'releaseId': manifest['releaseId'], 'manifestSha256': expected_digest,
            'activated': False, 'productionReady': manifest['productionReady']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('pack')
    build.add_argument('source', type=Path)
    build.add_argument('store', type=Path)
    build.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[2])
    build.add_argument('--release-id', required=True)
    build.add_argument('--expected-build-sha', required=True)
    build.add_argument('--sample-label')
    build.add_argument('--code-budget', type=int, default=MAX_CODE)
    restore = commands.add_parser('assemble')
    restore.add_argument('manifest', type=Path)
    restore.add_argument('store', type=Path)
    restore.add_argument('destination', type=Path)
    restore.add_argument('--manifest-sha256', required=True)
    restore.add_argument('--allow-sample', action='store_true')
    args = parser.parse_args()
    if args.command == 'pack':
        result = pack(args.source, args.store, args.project, args.release_id, args.expected_build_sha, args.sample_label, args.code_budget)
    else:
        result = assemble(args.manifest, args.store, args.destination, args.manifest_sha256, args.allow_sample)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, tarfile.TarError, RuntimeError) as error:
        print('Local layer operation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
