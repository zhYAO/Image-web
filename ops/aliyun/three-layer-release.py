"""Offline, versioned three-layer packaging. Never activates a release."""
import argparse
import errno
import importlib.util
import itertools
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import sys
import tarfile
import tempfile

_spec = importlib.util.spec_from_file_location('local_release_layer_tools', Path(__file__).with_name('release-layers.py'))
_tools = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_tools)
canonical, digest, file_digest = _tools.canonical, _tools.digest, _tools.file_digest
runtime_identity, make_archive, publish_bytes = _tools.runtime_identity, _tools.make_archive, _tools.publish_bytes
rename_no_replace = _tools.no_replace_directory
MAX_RAW, MAX_ENTRIES = _tools.MAX_RAW, _tools.MAX_ENTRIES
KINDS = ('code', 'runtime', 'assets')
PUBLIC, FONTS = 'apps/web/public/', 'apps/web/server/apparel/fonts/'
FONT_FILES = {'fonts/' + n for n in ('NotoSansCJKsc-Regular.otf', 'NotoSansCJKsc-Bold.otf', 'LICENSE.txt', 'README.md')}
SHA = re.compile(r'[a-f0-9]{64}')
CACHE_ROOT = '/opt/zimage/layer-cache'
PACKAGE_MANAGER = 'pnpm@11.19.0'
CONFIG_SOURCES = ('apps/web/next.config.ts', 'apps/web/build/static-assets-config.mjs')


def absolute(value):
    value = Path(value)
    if '..' in value.parts:
        raise ValueError('Unsafe root path containing ..')
    return Path(os.path.abspath(value))


def ancestors_safe(path):
    path = absolute(path)
    for current in reversed((path, *path.parents)):
        if current.is_symlink():
            raise ValueError('Symlink input or output ancestor: ' + str(current))
        if current.exists() and current != path and not current.is_dir():
            raise ValueError('Non-directory output ancestor: ' + str(current))
    return path


def root_path(path):
    path = ancestors_safe(path)
    if not path.is_dir():
        raise ValueError('Missing input directory: ' + str(path))
    return path


def disjoint(*paths):
    for left, right in itertools.combinations(paths, 2):
        _tools.disjoint(left, right, 'Input/output roots')


def directory(path):
    path = ancestors_safe(path)
    if path.exists():
        if not path.is_dir():
            raise ValueError('Output is not a directory: ' + str(path))
        return
    directory(path.parent)
    try:
        path.mkdir(mode=0o755)
        path.chmod(0o755)
    except FileExistsError:
        if path.is_symlink() or not path.is_dir():
            raise ValueError('Unsafe concurrent output directory')


def stat_identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode)


def read_regular(path):
    ancestors_safe(path)
    original = path.lstat()
    if not stat.S_ISREG(original.st_mode):
        raise ValueError('Expected regular input file: ' + str(path))
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        # Windows path stat and descriptor stat expose different ctime semantics.
        # Compare object identity here; compare complete descriptor snapshots below.
        object_fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_mode')
        if not stat.S_ISREG(before.st_mode) or any(getattr(original, key) != getattr(before, key) for key in object_fields):
            raise ValueError('Expected regular input file: ' + str(path))
        body = stream.read()
        after = os.fstat(stream.fileno())
        if stat_identity(before) != stat_identity(after) or len(body) != before.st_size:
            raise ValueError('Input changed during read: ' + str(path))
    return body


def parse(body):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(body, object_pairs_hook=unique)


def safe_name(name):
    _tools.safe_name(name)
    if name == '.three-layer-release.json' or '\x00' in name:
        raise ValueError('Reserved release path')
    return PurePosixPath(name)


def safe_link(name, target):
    if not isinstance(target, str) or not target or '\\' in target or '\x00' in target or posixpath.isabs(target):
        raise ValueError('Unsafe external symlink: ' + name)
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
    if resolved == '..' or resolved.startswith('../'):
        raise ValueError('Unsafe external symlink: ' + name)


def validate_entries(entries):
    names = set()
    if not isinstance(entries, list) or len(entries) > MAX_ENTRIES:
        raise ValueError('Too many layer entries')
    total = 0
    for entry in entries:
        name = entry['path']
        safe_name(name)
        if name in names:
            raise ValueError('Duplicate layer path')
        names.add(name)
        if entry['type'] == 'file':
            if entry['mode'] not in (0o644, 0o755) or type(entry['bytes']) is not int or entry['bytes'] < 0 or not SHA.fullmatch(entry['sha256']):
                raise ValueError('Invalid layer file metadata')
            total += entry['bytes']
        elif entry['type'] == 'symlink' and entry['mode'] == 0o777:
            safe_link(name, entry['target'])
        else:
            raise ValueError('Unsupported layer entry')
    if total > MAX_RAW:
        raise ValueError('Layer raw size exceeds limit')
    for name in names:
        if any(str(parent) in names for parent in PurePosixPath(name).parents):
            raise ValueError('Layer path traverses a file or symlink')


def inspect_source(source, dist):
    entries, omitted = [], []
    generated = (f'apps/web/{dist}/server/', f'apps/web/{dist}/static/')
    for current, dirs, files in os.walk(source, followlinks=False):
        for name in sorted(dirs + files):
            target = Path(current) / name
            relative = target.relative_to(source).as_posix()
            safe_name(relative)
            info = target.lstat()
            if stat.S_ISLNK(info.st_mode):
                link = os.readlink(target)
                safe_link(relative, link)
                if not target.resolve(strict=False).is_relative_to(source):
                    raise ValueError('Unsafe chained symlink: ' + relative)
                entries.append({'path': relative, 'type': 'symlink', 'target': link, 'mode': 0o777})
            elif stat.S_ISREG(info.st_mode):
                body = read_regular(target)
                checksum = digest(body)
                after = target.lstat()
                if stat_identity(info) != stat_identity(after) or info.st_size != len(body):
                    raise ValueError('Input changed during inventory: ' + relative)
                entry = {'path': relative, 'type': 'file', 'bytes': len(body), 'sha256': checksum, 'mode': 0o755 if info.st_mode & 0o111 else 0o644}
                if (relative.endswith('.map') and relative.startswith(generated)) or (relative.endswith('.js.nft.json') and relative.startswith(generated[0])):
                    omitted.append(entry)  # Original staged debug evidence remains intact, outside runtime delivery.
                else:
                    entries.append(entry)
            elif not stat.S_ISDIR(info.st_mode):
                raise ValueError('Unsupported source file type')
    entries.sort(key=lambda entry: entry['path'])
    validate_entries(entries)
    return entries, omitted


def classify(name):
    if name in (PUBLIC.rstrip('/'), FONTS.rstrip('/')) or name.startswith(PUBLIC) or name.startswith(FONTS):
        return 'assets'
    return 'runtime' if 'node_modules' in PurePosixPath(name).parts else 'code'


def resource_entries(body):
    manifest = parse(body)
    if manifest.get('schema') != 1 or manifest.get('productionReady') is not False:
        raise ValueError('Unsupported asset manifest')
    entries, names = [], set()
    for item in manifest['files']:
        name = item['path']
        safe_name(name)
        if name == 'asset-manifest.json' or item['kind'] not in ('public', 'font') or (item['kind'] == 'font') != name.startswith('fonts/'):
            raise ValueError('Invalid asset kind/path')
        if item['kind'] == 'font' and name not in FONT_FILES:
            raise ValueError('Unknown asset font')
        if not isinstance(item.get('mime'), str):
            raise ValueError('Missing asset MIME')
        entries.append({'path': name, 'type': 'file', 'bytes': item['bytes'], 'sha256': item['sha256'], 'mode': 0o644})
        names.add(name)
    if not FONT_FILES.issubset(names):
        raise ValueError('Asset fonts/license/provenance are missing')
    validate_entries(entries)
    return entries, manifest


def tree_paths(entries):
    files = {e['path'] for e in entries}
    dirs = {str(parent) for name in files for parent in PurePosixPath(name).parents if str(parent) != '.'}
    return files, dirs


def verify_tree(root, entries, readonly=False, label='cache'):
    root_path(root)
    files, dirs = tree_paths(entries)
    expected = {e['path']: e for e in entries}
    actual_files, actual_dirs = set(), set()
    for current, subdirs, members in os.walk(root, followlinks=False):
        for name in subdirs + members:
            target = Path(current) / name
            relative, info = target.relative_to(root).as_posix(), target.lstat()
            if stat.S_ISDIR(info.st_mode):
                actual_dirs.add(relative)
                if readonly and stat.S_IMODE(info.st_mode) != 0o555:
                    raise ValueError(label + ' directory permission mismatch')
                continue
            actual_files.add(relative)
            if relative not in expected:
                raise ValueError(label + ' contains extra member')
            entry = expected[relative]
            if entry['type'] == 'symlink':
                if not stat.S_ISLNK(info.st_mode) or os.readlink(target) != entry['target']:
                    raise ValueError(label + ' symlink mismatch')
                safe_link(relative, entry['target'])
                if not target.resolve(strict=False).is_relative_to(root):
                    raise ValueError(label + ' symlink escapes root')
            elif not stat.S_ISREG(info.st_mode) or info.st_size != entry['bytes'] or file_digest(target) != entry['sha256']:
                raise ValueError(label + ' file hash/type mismatch: ' + relative)
            elif readonly and stat.S_IMODE(info.st_mode) != (0o555 if entry['mode'] & 0o111 else 0o444):
                raise ValueError(label + ' file permission mismatch')
    if actual_files != files or actual_dirs != dirs:
        raise ValueError(label + ' is missing or has extra paths')
    if readonly and stat.S_IMODE(root.stat().st_mode) != 0o555:
        raise ValueError(label + ' root permission mismatch')


def valid_runtime(value):
    if value.get('platform') != 'linux' or not re.fullmatch(r'glibc-[0-9]+(?:\.[0-9]+)+', value.get('libc', '')):
        raise ValueError('Runtime requires Linux glibc; non-glibc native samples are unsupported')
    if any(not isinstance(value.get(key), str) or not value[key] for key in ('node', 'abi', 'arch')):
        raise ValueError('Incomplete Runtime fingerprint')


def validate_native_files(root, entries, runtime):
    """Check .node/.so[.numeric...] and forbid .dll/.dylib, case-insensitively.

    Metadata/backup suffixes are not shared-library names. Actual loading remains
    candidate preflight; this guard only checks declared native files' headers.
    """
    architectures = {'x64': (2, 1, 62), 'arm64': (2, 1, 183), 'arm': (1, 1, 40),
                     'ia32': (1, 1, 3), 'riscv64': (2, 1, 243), 'ppc64': (2, 1, 21), 's390x': (2, 2, 22)}
    for entry in entries:
        name = PurePosixPath(entry['path']).name.lower()
        if name.endswith(('.dll', '.dylib')):
            raise ValueError('Foreign native library is forbidden for Linux: ' + entry['path'])
        if not (name.endswith('.node') or re.search(r'\.so(?:\.[0-9]+)*\Z', name)):
            continue
        path = root / entry['path']
        if entry['type'] == 'symlink':
            path = path.resolve(strict=True)
            if not path.is_relative_to(root):
                raise ValueError('Native symlink escapes input')
        body = read_regular(path)
        expected = architectures.get(runtime['arch'])
        if len(body) < 52 or body[:4] != b'\x7fELF' or body[5] not in (1, 2):
            raise ValueError('Linux native payload requires an ELF header: ' + entry['path'])
        machine = int.from_bytes(body[18:20], 'little' if body[5] == 1 else 'big')
        if expected != (body[4], body[5], machine):
            raise ValueError('Linux native architecture differs from target: ' + entry['path'])


def validate_target_shape(target):
    if (not isinstance(target, dict) or set(target) != {'schema', 'runtime', 'toolchain', 'assemblyCacheRoot'} or
            type(target['schema']) is not int or target['schema'] != 1 or
            not isinstance(target['runtime'], dict) or set(target['runtime']) != {'node', 'abi', 'platform', 'arch', 'libc'} or
            target['toolchain'] != {'packageManager': PACKAGE_MANAGER} or target['assemblyCacheRoot'] != CACHE_ROOT):
        raise ValueError('Invalid target schema, toolchain or assembly cache root')
    valid_runtime(target['runtime'])


def dependency_resolution(config, roots=()):
    """Stable compiled resolution choices, without env/build IDs or input roots."""
    keys = ('output', 'serverExternalPackages', 'transpilePackages', 'outputFileTracingIncludes',
            'outputFileTracingExcludes', 'bundlePagesRouterDependencies')
    experimental = ('esmExternals', 'serverComponentsExternalPackages', 'externalDir', 'extensionAlias',
                    'optimizePackageImports', 'bundlePagesExternals')
    value = {key: config[key] for key in keys if key in config}
    value['experimental'] = {key: config.get('experimental', {})[key] for key in experimental if key in config.get('experimental', {})}
    value['turbopack'] = {key: config.get('turbopack', {})[key] for key in ('resolveAlias', 'resolveExtensions', 'rules') if key in config.get('turbopack', {})}
    def stable(item):
        if isinstance(item, str):
            for root in sorted({str(r) for r in roots}, key=len, reverse=True):
                if item == root or item.startswith(root + '/') or item.startswith(root + os.sep):
                    return '<input>' + item[len(root):].replace('\\', '/')
            return item
        if isinstance(item, dict):
            return {key: stable(member) for key, member in item.items()}
        if isinstance(item, list):
            return [stable(member) for member in item]
        return item
    return stable(value)


def layer_binding(manifest, kind):
    if kind == 'runtime':
        return (manifest['runtimeBinding'] if manifest['schema'] == 2 else
                {'lockSha256': manifest['lockSha256'], 'runtime': manifest['runtime']})
    binding = {'distDir': manifest['distDir'], 'assetsVersion': manifest['assetsVersion']}
    if manifest['schema'] == 2:
        binding.update(schema=2, assetDeliveryMode=manifest['assetDeliveryMode'], compiledAssetBaseUrl=manifest.get('compiledAssetBaseUrl'))
    return binding


def validate_manifest(manifest):
    """Validate versioned metadata without checking local native runtime or files."""
    if (type(manifest.get('schema')) is not int or manifest['schema'] not in (1, 2) or
            set(manifest.get('layers', {})) != set(KINDS) or manifest.get('productionReady') is not False or
            not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}', manifest.get('releaseId', '')) or
            not SHA.fullmatch(manifest.get('lockSha256', '')) or not SHA.fullmatch(manifest.get('assetsVersion', ''))):
        raise ValueError('Unsupported non-production release manifest')
    valid_runtime(manifest['runtime'])
    if manifest['distDir'] not in ('.next', '.next-build-qa'):
        raise ValueError('Unsupported build directory')
    if manifest['schema'] == 2:
        validate_target_shape(manifest['target'])
        fingerprint = manifest['configFingerprint']
        binding = {'schema': 2, 'lockSha256': manifest['lockSha256'], 'runtime': manifest['runtime'],
                   'toolchain': manifest['target']['toolchain'], 'configSha256': digest(canonical(fingerprint))}
        if (manifest['runtime'] != manifest['target']['runtime'] or manifest['assemblyCacheRoot'] != CACHE_ROOT or
                manifest['runtimeBinding'] != binding or set(fingerprint.get('sources', {})) != set(CONFIG_SOURCES) or
                any(not isinstance(sha, str) or not SHA.fullmatch(sha) for sha in fingerprint['sources'].values())):
            raise ValueError('Runtime/config/toolchain binding mismatch')
        mode, base = manifest.get('assetDeliveryMode'), manifest.get('compiledAssetBaseUrl')
        if mode not in ('same-origin-public', 'remote') or (mode == 'same-origin-public' and base is not None) or (mode == 'remote' and not isinstance(base, str)):
            raise ValueError('Invalid asset delivery mode/base binding')
        public_target = CACHE_ROOT + '/assets/' + manifest['assetsVersion']
        if manifest['generatedPublicLink'] != {'path': 'apps/web/public', 'target': public_target, 'bytes': len(public_target.encode())}:
            raise ValueError('Controlled public symlink binding mismatch')


def asset_delivery(config, asset_sha, mode, schema):
    base = validate_compiled_assets(config, asset_sha)
    if schema == 2:
        if mode == 'same-origin-public' and base is not None:
            raise ValueError('same-origin-public requires absent compiled remote asset URL')
        if mode not in ('same-origin-public', 'remote') or (mode == 'remote' and base is None):
            raise ValueError('Explicit remote mode requires an exact compiled asset URL')
    return base


def validate_compiled_assets(config, asset_sha):
    """Bind compiled remote image paths to the exact resource manifest bytes."""
    images = config.get('images', {})
    if not isinstance(images, dict) or not isinstance(images.get('remotePatterns', []), list):
        raise ValueError('Invalid compiled asset remotePatterns configuration')
    bases = set()
    for pattern in images.get('remotePatterns', []):
        if not isinstance(pattern, dict):
            raise ValueError('Unsupported compiled asset remote pattern')
        pathname = pattern.get('pathname', '')
        if not isinstance(pathname, str) or not pathname.startswith('/static-assets/'):
            continue
        hostname, port = pattern.get('hostname'), pattern.get('port', '')
        exact_host = (isinstance(hostname, str) and len(hostname) <= 253 and
                      re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*', hostname))
        exact_port = isinstance(port, str) and (port == '' or (re.fullmatch(r'[0-9]{1,5}', port) and 0 < int(port) <= 65535))
        if (pattern.get('protocol') != 'https' or not exact_host or not exact_port or
                pattern.get('search') != '' or pathname != f'/static-assets/{asset_sha}/commerce/**'):
            raise ValueError('Invalid compiled asset version, HTTPS origin, path or query restriction')
        origin = 'https://' + hostname.lower() + (':' + port if port else '')
        bases.add(origin + '/static-assets/' + asset_sha)
    if len(bases) > 1:
        raise ValueError('Ambiguous compiled asset base URLs')
    return next(iter(bases)) if bases else None


def finish_manifest(manifest):
    layers = manifest['layers']
    raw = manifest.setdefault('raw', {})
    for _ in range(20):
        body = canonical(manifest)
        generated = manifest['generatedPublicLink']['bytes']
        code = layers['code']
        raw.update({'codeRegularFileBytes': code['rawBytes'], 'codeSymlinkTargetBytes': code['symlinkTargetBytes'],
                    'generatedPublicSymlinkBytes': generated, 'codeIndexBytes': code['indexBytes'],
                    'releaseManifestBytes': len(body), 'codeMetadataBytes': code['indexBytes'] + len(body),
                    'codeBytes': code['rawBytes'] + code['symlinkTargetBytes'] + generated + code['indexBytes'] + len(body),
                    'runtimeRegularFileBytes': layers['runtime']['rawBytes'], 'runtimeSymlinkTargetBytes': layers['runtime']['symlinkTargetBytes'],
                    'runtimeIndexBytes': layers['runtime']['indexBytes'], 'assetsRegularFileBytes': layers['assets']['rawBytes'],
                    'assetsManifestBytes': layers['assets']['indexBytes'],
                    'totalBytes': sum(layer['rawBytes'] + layer['symlinkTargetBytes'] + layer['indexBytes'] for layer in layers.values()) + generated + len(body)})
        if 'budgetBytes' in manifest:
            budget = manifest['budgetBytes']
            manifest['budgetPassed'] = None if budget is None else raw['codeBytes'] <= budget
        if canonical(manifest) == body:
            return body
    raise ValueError('Manifest raw accounting did not stabilize')


def pack(source, store, project, assets, release_id, budget=None, sample_label=None, source_commit=None, assembly_cache_root=None, *, target=None, schema=2, asset_delivery_mode='same-origin-public'):
    source, project, assets = map(root_path, (source, project, assets))
    store = ancestors_safe(store)
    if type(schema) is not int or schema not in (1, 2):
        raise ValueError('Unsupported release schema')
    if schema == 2:
        if target is None:
            raise ValueError('Explicit --target JSON is required for schema 2')
        validate_target_shape(target)
        runtime = runtime_identity()
        if runtime != target['runtime']:
            raise ValueError('Build host Runtime fingerprint differs from target')
        package_manager = parse(read_regular(project / 'package.json')).get('packageManager')
        if package_manager != target['toolchain']['packageManager']:
            raise ValueError('Project packageManager differs from target toolchain')
        if assembly_cache_root is not None and str(assembly_cache_root) != target['assemblyCacheRoot']:
            raise ValueError('Assembly cache root differs from target')
        assembly_cache_root = target['assemblyCacheRoot']
        disjoint(source, store, project, assets)
        if os.name == 'posix':
            disjoint(source, store, project, assets, ancestors_safe(assembly_cache_root))
    else:
        if target is not None:
            raise ValueError('Legacy schema 1 does not accept a schema 2 target')
        if assembly_cache_root is None:
            raise ValueError('--assembly-cache-root is required for exact generated-link raw accounting')
        assembly_cache_root = ancestors_safe(assembly_cache_root)
        disjoint(source, store, project, assets, assembly_cache_root)
        runtime = runtime_identity()
    valid_runtime(runtime)
    for child in ('layers', 'releases'):
        ancestors_safe(store / child)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}', release_id):
        raise ValueError('Invalid release ID')
    release_path = store / 'releases' / (release_id + '.json')
    if os.path.lexists(release_path):
        raise ValueError('Release ID already exists')
    if budget is not None and (type(budget) is not int or budget <= 0):
        raise ValueError('Invalid code raw budget')
    if source_commit is not None and not re.fullmatch(r'[a-f0-9]{40}', source_commit):
        raise ValueError('Invalid source commit SHA')
    lock_sha = digest(read_regular(project / 'pnpm-lock.yaml'))
    candidates = [(dist, source / f'apps/web/{dist}/required-server-files.json') for dist in ('.next', '.next-build-qa')]
    candidates = [(dist, name) for dist, name in candidates if name.exists() or name.is_symlink()]
    if len(candidates) != 1:
        raise ValueError('Expected exactly one actual .next or .next-build-qa config')
    dist, config_path = candidates[0]
    config = parse(read_regular(config_path))['config']
    if config.get('distDir', '').removeprefix('./') != dist:
        raise ValueError('Actual build directory and config.distDir mismatch')
    asset_body = read_regular(assets / 'asset-manifest.json')
    asset_sha = digest(asset_body)
    if assets.name != asset_sha:
        raise ValueError('Wrong asset version directory')
    compiled_asset_base = asset_delivery(config, asset_sha, asset_delivery_mode, schema)
    asset_entries, asset_manifest = resource_entries(asset_body)
    manifest_entry = {'path': 'asset-manifest.json', 'type': 'file', 'mode': 0o644, 'bytes': len(asset_body), 'sha256': asset_sha}
    verify_tree(assets, asset_entries + [manifest_entry], label='asset input')
    entries, omitted = inspect_source(source, dist)
    if schema == 2:
        validate_native_files(source, entries, runtime)
    indexed_assets = {e['path']: e for e in asset_entries}
    grouped = {'code': [], 'runtime': []}
    for entry in entries:
        kind, name = classify(entry['path']), entry['path']
        if kind == 'assets':
            relative = 'fonts/' + name[len(FONTS):] if name.startswith(FONTS) else name[len(PUBLIC):]
            expected = indexed_assets.get(relative)
            if entry['type'] != 'file' or expected is None or (entry['bytes'], entry['sha256']) != (expected['bytes'], expected['sha256']):
                raise ValueError('Staged asset differs from asset manifest: ' + name)
        else:
            grouped[kind].append(entry)
    files = {e['path'] for e in grouped['code'] if e['type'] == 'file'}
    for required in ('apps/web/server.js', f'apps/web/{dist}/BUILD_ID', f'apps/web/{dist}/required-server-files.json'):
        if required not in files:
            raise ValueError('Missing required business file: ' + required)
    for prefix in (f'apps/web/{dist}/server/', f'apps/web/{dist}/static/'):
        if not any(name.startswith(prefix) for name in files):
            raise ValueError('Missing server/client build chunks')
    if not grouped['runtime']:
        raise ValueError('Runtime layer is empty')
    marker = config.get('env', {}).get('ZIMAGE_BUILD_SHA')
    public_target = (assembly_cache_root + '/assets/' + asset_sha if schema == 2 else str(assembly_cache_root / 'assets' / asset_sha))
    manifest = {'schema': schema, 'releaseId': release_id, 'productionReady': False,
                'sampleLabel': sample_label or 'Local unactivated prototype', 'distDir': dist,
                'budgetBytes': budget, 'budgetPassed': None,
                'runtime': runtime, 'lockSha256': lock_sha, 'assetsVersion': asset_sha,
                'compiledAssetBaseUrl': compiled_asset_base,
                'assemblyCacheRoot': str(assembly_cache_root),
                'generatedPublicLink': {'path': 'apps/web/public', 'target': public_target, 'bytes': len(os.fsencode(public_target))},
                'build': {'marker': marker, 'buildId': read_regular(source / f'apps/web/{dist}/BUILD_ID').decode().strip(),
                          'sourceCommit': source_commit, 'markerMatchesSourceCommit': bool(source_commit and marker == source_commit)},
                'inputRoots': {'source': str(source), 'project': str(project), 'assets': str(assets)},
                'retainedBuildMetadata': {'files': len(omitted), 'rawBytes': sum(e['bytes'] for e in omitted), 'location': 'Original staged input, unchanged; excluded from runtime delivery'}, 'layers': {}}
    if schema == 2:
        fingerprint = {'sources': {name: digest(read_regular(project / name)) for name in CONFIG_SOURCES},
                       'dependencyResolution': dependency_resolution(config, (project, source))}
        manifest.update(target=target, assetDeliveryMode=asset_delivery_mode, configFingerprint=fingerprint)
        manifest['runtimeBinding'] = {'schema': 2, 'lockSha256': lock_sha, 'runtime': runtime,
                                     'toolchain': {'packageManager': package_manager}, 'configSha256': digest(canonical(fingerprint))}
    directory(store / 'layers')
    for kind in KINDS:
        members = asset_entries if kind == 'assets' else grouped[kind]
        binding = layer_binding(manifest, kind)
        index_body = asset_body if kind == 'assets' else canonical({'schema': schema, 'kind': kind, 'binding': binding, 'entries': members})
        identity = digest(index_body)
        base = f'layers/{kind}-{identity}'
        archive_name, index_name = base + '.tgz', base + '.json'
        ancestors_safe(store / archive_name)
        ancestors_safe(store / index_name)
        archive_sha, archive_bytes = make_archive(assets if kind == 'assets' else source, store / archive_name, members)
        publish_bytes(store / index_name, index_body, reuse=True)
        manifest['layers'][kind] = {'identity': identity, 'archive': archive_name, 'archiveSha256': archive_sha, 'archiveBytes': archive_bytes,
                                    'index': index_name, 'indexBytes': len(index_body), 'rawBytes': sum(e.get('bytes', 0) for e in members),
                                    'symlinkTargetBytes': sum(len(os.fsencode(e['target'])) for e in members if e['type'] == 'symlink')}
    body = finish_manifest(manifest)
    if budget is not None and manifest['raw']['codeBytes'] > budget:
        raise ValueError(f'Code raw budget exceeded: {manifest["raw"]["codeBytes"]} > {budget}; no release manifest published')
    directory(store / 'releases')
    ancestors_safe(release_path)
    publish_bytes(release_path, body)
    return {'manifest': str(release_path), 'manifestSha256': digest(body), 'productionReady': False,
            'budgetBytes': budget, 'budgetPassed': manifest['budgetPassed'], 'raw': manifest['raw'], 'layers': manifest['layers'],
            'transferBytes': len(body) + sum(e['archiveBytes'] + e['indexBytes'] for e in manifest['layers'].values())}


def checked_store_file(store, name, expected, size):
    safe_name(name)
    if type(size) is not int or not 0 <= size <= MAX_RAW or not SHA.fullmatch(expected):
        raise ValueError('Invalid layer checksum metadata')
    target = ancestors_safe(store / name)
    body_size = target.stat().st_size
    if not target.is_file() or body_size != size or file_digest(target) != expected:
        raise ValueError('Layer hash/size mismatch: ' + name)
    return target


def extract(archive_path, entries, root):
    expected = {entry['path']: entry for entry in entries}
    links = []
    with tarfile.open(archive_path, 'r:gz') as archive:
        for item in archive:
            if item.name not in expected:
                raise ValueError('Unexpected, escaping or duplicate archive member')
            entry = expected.pop(item.name)
            if item.mode != entry['mode']:
                raise ValueError('Archive permission mismatch')
            target = root / item.name
            if entry['type'] == 'symlink':
                if not item.issym() or item.linkname != entry['target']:
                    raise ValueError('Archive symlink mismatch')
                safe_link(item.name, item.linkname)
                links.append((target, item.linkname))
            else:
                if not item.isfile() or item.size != entry['bytes']:
                    raise ValueError('Archive regular file mismatch')
                directory(target.parent)
                with archive.extractfile(item) as content, target.open('xb') as output:
                    shutil.copyfileobj(content, output)
                if file_digest(target) != entry['sha256']:
                    raise ValueError('Extracted archive file hash mismatch')
                target.chmod(entry['mode'])
    if expected:
        raise ValueError('Archive is missing indexed members')
    create_links(root, links)


def create_links(root, links):
    for target, link in links:
        directory(target.parent)
        target.symlink_to(link)
    for target, _ in links:
        if not target.resolve(strict=False).is_relative_to(root):
            raise ValueError('Assembled symlink escapes root')


def readonly(root):
    for current, dirs, files in os.walk(root, followlinks=False):
        for name in files:
            target = Path(current) / name
            if not target.is_symlink():
                target.chmod(0o555 if target.stat().st_mode & 0o111 else 0o444)
    for current, _, _ in os.walk(root, topdown=False, followlinks=False):
        Path(current).chmod(0o555)


def remove_owned(root):
    if root is not None and root.exists():
        for current, _, _ in os.walk(root, followlinks=False):
            Path(current).chmod(0o700)
        shutil.rmtree(root)


def ensure_cache(cache, kind, identity, archive_path, entries, asset_body=None):
    directory(cache / kind)
    target = ancestors_safe(cache / kind / identity)
    check_entries = list(entries)
    if asset_body is not None:
        check_entries.append({'path': 'asset-manifest.json', 'type': 'file', 'mode': 0o644, 'bytes': len(asset_body), 'sha256': identity})
    if os.path.lexists(target):
        verify_tree(target, check_entries, readonly=True)
        return {'directory': str(target), 'reused': True}
    staging = Path(tempfile.mkdtemp(prefix='.pending-', dir=target.parent))
    try:
        extract(archive_path, entries, staging)
        if asset_body is not None:
            (staging / 'asset-manifest.json').write_bytes(asset_body)
        readonly(staging)
        verify_tree(staging, check_entries, readonly=True)
        try:
            rename_no_replace(staging, target)
        except FileExistsError:
            verify_tree(target, check_entries, readonly=True)
            return {'directory': str(target), 'reused': True}
        return {'directory': str(target), 'reused': False}
    finally:
        remove_owned(staging)


def filesystem_accounting(roots):
    logical, unique, links, inodes = 0, 0, 0, set()
    for root in roots:
        for current, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                target = Path(current) / name
                info = target.lstat()
                if stat.S_ISLNK(info.st_mode):
                    links += len(os.fsencode(os.readlink(target)))
                elif stat.S_ISREG(info.st_mode):
                    logical += info.st_size
                    key = info.st_dev, info.st_ino
                    if key not in inodes:
                        unique += info.st_size
                        inodes.add(key)
    return {'scope': [str(root) for root in roots], 'logicalRegularBytes': logical,
            'uniqueInodeRegularBytes': unique, 'symlinkTargetBytes': links,
            'excludes': 'Store archives/indices and other releases; these are logical bytes, not filesystem block usage.'}


def assemble(manifest_path, store, destination, cache, expected_digest, allow_sample):
    store = root_path(store)
    destination, cache = ancestors_safe(destination), ancestors_safe(cache)
    disjoint(store, destination, cache)
    body = read_regular(ancestors_safe(manifest_path))
    if digest(body) != expected_digest:
        raise ValueError('Release manifest checksum mismatch')
    manifest = parse(body)
    validate_manifest(manifest)
    if not allow_sample:
        raise ValueError('Local assembly requires --allow-sample')
    if str(cache) != manifest['assemblyCacheRoot']:
        raise ValueError('Assembly cache root differs from manifest binding')
    public_target = str(cache / 'assets' / manifest['assetsVersion'])
    public_entry = {'path': 'apps/web/public', 'target': public_target, 'bytes': len(os.fsencode(public_target))}
    if manifest['generatedPublicLink'] != public_entry:
        raise ValueError('Controlled public symlink binding mismatch')
    if absolute(manifest_path) != store / 'releases' / (manifest['releaseId'] + '.json'):
        raise ValueError('Release manifest must be selected from this store')
    inputs = [absolute(value) for value in manifest['inputRoots'].values()]
    disjoint(store, cache, destination, *inputs)
    valid_runtime(manifest['runtime'])
    if manifest['runtime'] != runtime_identity():
        raise ValueError('Runtime fingerprint mismatch')
    if os.path.lexists(destination):
        raise ValueError('Assembly destination already exists')
    for child in ('layers', 'releases'):
        ancestors_safe(store / child)
    for child in ('runtime', 'assets'):
        ancestors_safe(cache / child)
    indexes, archives, raw_assets = {}, {}, None
    for kind in KINDS:
        layer = manifest['layers'][kind]
        identity = layer['identity']
        if not SHA.fullmatch(identity):
            raise ValueError('Invalid layer identity')
        base = f'layers/{kind}-{identity}'
        if layer['index'] != base + '.json' or layer['archive'] != base + '.tgz':
            raise ValueError('Layer path/identity mismatch')
        index_file = checked_store_file(store, layer['index'], identity, layer['indexBytes'])
        index_body = read_regular(index_file)
        if kind == 'assets':
            entries, _ = resource_entries(index_body)
            if identity != manifest['assetsVersion']:
                raise ValueError('Wrong asset version')
            raw_assets = index_body
        else:
            index = parse(index_body)
            binding = layer_binding(manifest, kind)
            if index['schema'] != manifest['schema'] or index['kind'] != kind or index['binding'] != binding:
                raise ValueError('Layer binding mismatch')
            entries = index['entries']
            validate_entries(entries)
            if any(classify(e['path']) != kind for e in entries):
                raise ValueError('Business/runtime layer misclassification')
        if sum(e.get('bytes', 0) for e in entries) != layer['rawBytes']:
            raise ValueError('Layer raw accounting mismatch')
        if sum(len(os.fsencode(e['target'])) for e in entries if e['type'] == 'symlink') != layer['symlinkTargetBytes']:
            raise ValueError('Layer symlink accounting mismatch')
        indexes[kind] = entries
        archives[kind] = checked_store_file(store, layer['archive'], layer['archiveSha256'], layer['archiveBytes'])
    combined = indexes['code'] + indexes['runtime']
    validate_entries(combined)
    if sum(e.get('bytes', 0) for e in combined + indexes['assets']) > MAX_RAW:
        raise ValueError('Assembled raw size exceeds limit')
    # Historical manifests retain their explicit cap as recorded; historical
    # goalBytes/goalMet are informational and never create a new implicit gate.
    budget = manifest.get('budgetBytes', manifest.get('codeRawBudget'))
    if budget is not None and (type(budget) is not int or budget <= 0):
        raise ValueError('Invalid manifest raw budget')
    if finish_manifest(parse(body)) != body or (budget is not None and manifest['raw']['codeBytes'] > budget):
        raise ValueError('Manifest raw metadata/budget mismatch')
    cached = {kind: ensure_cache(cache, kind, manifest['layers'][kind]['identity'], archives[kind], indexes[kind], raw_assets if kind == 'assets' else None) for kind in ('runtime', 'assets')}
    directory(destination.parent)
    staging = Path(tempfile.mkdtemp(prefix='.' + destination.name + '.pending-', dir=destination.parent))
    reused = {'hardlinkedBytes': 0, 'copiedBytes': 0, 'hardlinkedFiles': 0, 'copiedFiles': 0}
    try:
        extract(archives['code'], indexes['code'], staging)
        links = []
        for entry in indexes['runtime']:
            target = staging / entry['path']
            if entry['type'] == 'symlink':
                links.append((target, entry['target']))
                continue
            directory(target.parent)
            original = Path(cached['runtime']['directory']) / entry['path']
            try:
                os.link(original, target)
                reused['hardlinkedBytes'] += entry['bytes']
                reused['hardlinkedFiles'] += 1
            except OSError as error:
                if error.errno != errno.EXDEV:
                    raise
                with original.open('rb') as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o555 if entry['mode'] & 0o111 else 0o444)
                reused['copiedBytes'] += entry['bytes']
                reused['copiedFiles'] += 1
        create_links(staging, links)
        verify_tree(staging, combined, label='assembled app')
        if manifest['schema'] == 2:
            validate_native_files(staging, combined, manifest['runtime'])
        for name in ('apps/web/server.js', f'apps/web/{manifest["distDir"]}/BUILD_ID', f'apps/web/{manifest["distDir"]}/required-server-files.json'):
            if not (staging / name).is_file() or (staging / name).is_symlink():
                raise ValueError('Missing assembled required business file')
        restored_config = parse(read_regular(staging / f'apps/web/{manifest["distDir"]}/required-server-files.json'))['config']
        if restored_config.get('distDir', '').removeprefix('./') != manifest['distDir']:
            raise ValueError('Assembled config.distDir mismatch')
        compiled_base = asset_delivery(restored_config, manifest['assetsVersion'], manifest.get('assetDeliveryMode'), manifest['schema'])
        # Older local manifests lack this metadata field; actual config is still
        # checked independently. New manifests must also agree with their record.
        if 'compiledAssetBaseUrl' in manifest and manifest['compiledAssetBaseUrl'] != compiled_base:
            raise ValueError('Assembled compiled asset base metadata mismatch')
        if manifest['schema'] == 2 and dependency_resolution(restored_config, manifest['inputRoots'].values()) != manifest['configFingerprint']['dependencyResolution']:
            raise ValueError('Assembled compiled dependency resolution mismatch')
        # This one external link is generated solely from the trusted, fully
        # verified asset cache binding. No archive may supply an external link.
        public = staging / public_entry['path']
        directory(public.parent)
        public.symlink_to(public_target, target_is_directory=True)
        # Adding the controlled external link changes resolution of other paths.
        # Recheck the FINAL graph on every assembly, including cache reuse: only
        # the generated public link itself may cross the application boundary.
        for entry in combined:
            if entry['type'] == 'symlink' and not (staging / entry['path']).resolve(strict=False).is_relative_to(staging):
                raise ValueError('Assembled archive symlink escapes after controlled public link: ' + entry['path'])
        marker = staging / '.three-layer-release.json'
        marker.write_bytes(body)
        marker.chmod(0o644)
        staging.chmod(0o755)
        rename_no_replace(staging, destination)
    finally:
        remove_owned(staging)
    return {'destination': str(destination), 'manifestSha256': expected_digest, 'releaseId': manifest['releaseId'], 'activated': False, 'productionReady': False,
            'raw': manifest['raw'], 'budgetBytes': budget, 'budgetPassed': None if budget is None else True, 'cache': cached, 'runtimeReuse': reused,
            'filesystemAccounting': filesystem_accounting([destination, Path(cached['runtime']['directory']), Path(cached['assets']['directory'])]),
            'environment': {'ZIMAGE_SHARED_FONT_DIR': str(Path(cached['assets']['directory']) / 'fonts'), 'ZIMAGE_STATIC_ASSET_SHA256': manifest['assetsVersion']}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('pack')
    build.add_argument('source', type=Path)
    build.add_argument('store', type=Path)
    build.add_argument('--assets', required=True, type=Path)
    build.add_argument('--project', required=True, type=Path)
    build.add_argument('--release-id', required=True)
    build.add_argument('--code-raw-budget', type=int, default=None)
    build.add_argument('--sample-label')
    build.add_argument('--source-commit')
    build.add_argument('--assembly-cache-root')
    build.add_argument('--target', type=Path, help='Explicit JSON target runtime/toolchain/cache contract (required for schema 2)')
    build.add_argument('--schema', type=int, choices=(1, 2), default=2, help='Schema 1 is an explicit legacy compatibility mode')
    build.add_argument('--asset-delivery-mode', choices=('same-origin-public', 'remote'), default='same-origin-public')
    restore = commands.add_parser('assemble')
    restore.add_argument('manifest', type=Path)
    restore.add_argument('store', type=Path)
    restore.add_argument('destination', type=Path)
    restore.add_argument('--cache', required=True, type=Path)
    restore.add_argument('--manifest-sha256', required=True)
    restore.add_argument('--allow-sample', action='store_true')
    args = parser.parse_args()
    if args.command == 'pack':
        target = parse(read_regular(args.target)) if args.target else None
        result = pack(args.source, args.store, args.project, args.assets, args.release_id, args.code_raw_budget, args.sample_label, args.source_commit, args.assembly_cache_root,
                      target=target, schema=args.schema, asset_delivery_mode=args.asset_delivery_mode)
    else:
        result = assemble(args.manifest, args.store, args.destination, args.cache, args.manifest_sha256, args.allow_sample)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, RuntimeError) as error:
        print('Local three-layer operation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
