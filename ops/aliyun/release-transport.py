"""Offline bounded delta transport. Inventory is a hint, never an activation proof."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import sys
import tarfile

_spec = importlib.util.spec_from_file_location('transport_layers', Path(__file__).with_name('three-layer-release.py'))
layers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(layers)
MAX_OUTER = 2_000_000_000
MAX_MANIFEST = 1_000_000
HEX40 = re.compile(r'[a-f0-9]{40}')
HEX64 = re.compile(r'[a-f0-9]{64}')
OBJECT = re.compile(r'layers/(code|runtime|assets)-([a-f0-9]{64})\.(json|tgz)')


def _sha(value, pattern=HEX64):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError('Invalid trusted SHA')


def _metadata(checksum, size):
    _sha(checksum)
    if type(size) is not int or not 0 <= size <= MAX_OUTER:
        raise ValueError('Invalid object size')


def required_files(manifest, release_sha, manifest_body=None):
    """Return seven exact path -> (sha256, bytes); manifest is None without bytes."""
    _sha(release_sha, HEX40)
    layers.validate_manifest(manifest)
    if manifest['releaseId'] != release_sha:
        raise ValueError('Release SHA differs from manifest identity')
    manifest_name = f'releases/{release_sha}.json'
    expected = {manifest_name: None}
    if manifest_body is not None:
        if not isinstance(manifest_body, bytes) or len(manifest_body) > MAX_MANIFEST or layers.parse(manifest_body) != manifest:
            raise ValueError('Invalid trusted manifest bytes')
        expected[manifest_name] = (layers.digest(manifest_body), len(manifest_body))
    for kind in layers.KINDS:
        layer = manifest['layers'][kind]
        _sha(layer['identity'])
        base = f'layers/{kind}-{layer["identity"]}'
        if layer['index'] != base + '.json' or layer['archive'] != base + '.tgz':
            raise ValueError('Invalid required object path/identity')
        for name, checksum, size in ((layer['index'], layer['identity'], layer['indexBytes']),
                                     (layer['archive'], layer['archiveSha256'], layer['archiveBytes'])):
            _metadata(checksum, size)
            expected[name] = (checksum, size)
    if len(expected) != 7 or sum(value[1] for value in expected.values() if value is not None) > MAX_OUTER:
        raise ValueError('Required closure exceeds transport bound')
    return expected


def _validated_request(value):
    if not isinstance(value, dict) or set(value) != {'schema', 'releaseSha', 'files'} or type(value['schema']) is not int or value['schema'] != 1:
        raise ValueError('Invalid inventory/request schema')
    _sha(value['releaseSha'], HEX40)
    files = value['files']
    if not isinstance(files, dict) or len(files) > 7:
        raise ValueError('Inventory request exceeds seven objects')
    slots = set()
    total = 0
    for name, item in files.items():
        if not isinstance(name, str):
            raise ValueError('Invalid inventory path')
        match = OBJECT.fullmatch(name)
        if name == f'releases/{value["releaseSha"]}.json':
            slot = 'manifest'
        elif match:
            slot = match[1], match[3]
        else:
            raise ValueError('Invalid bounded inventory path')
        if slot in slots or not isinstance(item, dict) or set(item) != {'sha256', 'bytes'}:
            raise ValueError('Duplicate inventory slot or invalid object metadata')
        slots.add(slot)
        _metadata(item['sha256'], item['bytes'])
        total += item['bytes']
    if total > MAX_OUTER:
        raise ValueError('Inventory request exceeds byte bound')
    return value


def _records(files):
    return [{'path': name, 'sha256': value[0], 'bytes': value[1]} for name, value in sorted(files.items())]


def _release(store, manifest_path, manifest_sha):
    _sha(manifest_sha)
    store = layers.root_path(store)
    manifest_path = layers.ancestors_safe(manifest_path)
    if manifest_path.stat().st_size > MAX_MANIFEST:
        raise ValueError('Release manifest exceeds size bound')
    body = layers.read_regular(manifest_path)
    if layers.digest(body) != manifest_sha:
        raise ValueError('Release manifest checksum mismatch')
    manifest = layers.parse(body)
    required = required_files(manifest, manifest.get('releaseId'), body)
    if manifest_path != store / 'releases' / (manifest['releaseId'] + '.json'):
        raise ValueError('Release manifest must be selected from source store')
    if layers.finish_manifest(layers.parse(body)) != body:
        raise ValueError('Release manifest accounting mismatch')
    all_entries = []
    # Validate the ENTIRE source closure, even for objects inventory calls hits.
    for name, (checksum, size) in required.items():
        layers.checked_store_file(store, name, checksum, size)
    for kind in layers.KINDS:
        layer = manifest['layers'][kind]
        index_body = layers.read_regular(store / layer['index'])
        if kind == 'assets':
            entries, _ = layers.resource_entries(index_body)
            if layer['identity'] != manifest['assetsVersion']:
                raise ValueError('Asset identity mismatch')
        else:
            index = layers.parse(index_body)
            if index['schema'] != manifest['schema'] or index['kind'] != kind or index['binding'] != layers.layer_binding(manifest, kind):
                raise ValueError('Layer binding mismatch')
            entries = index['entries']
            layers.validate_entries(entries)
            if any(layers.classify(entry['path']) != kind for entry in entries):
                raise ValueError('Layer path classification mismatch')
            all_entries.extend(entries)
        if (sum(entry.get('bytes', 0) for entry in entries) != layer['rawBytes'] or
                sum(len(os.fsencode(entry['target'])) for entry in entries if entry['type'] == 'symlink') != layer['symlinkTargetBytes']):
            raise ValueError('Layer raw accounting mismatch')
    layers.validate_entries(all_entries)
    if sum(layer['rawBytes'] for layer in manifest['layers'].values()) > layers.MAX_RAW:
        raise ValueError('Layer raw payload exceeds bound')
    return store, manifest, body, required


def request(store, manifest_path, manifest_sha):
    """Create the bounded inventory request from a fully verified source store."""
    _, manifest, _, required = _release(store, manifest_path, manifest_sha)
    return {'schema': 1, 'releaseSha': manifest['releaseId'],
            'files': {name: {'sha256': checksum, 'bytes': size} for name, (checksum, size) in sorted(required.items())}}


def inventory(store, request):
    """Hash at most seven requested fixed-format files; corruption is a miss."""
    request = _validated_request(request)
    store = layers.ancestors_safe(store)
    found = {}
    if not store.exists():
        return {'schema': 1, 'releaseSha': request['releaseSha'], 'files': found}
    layers.root_path(store)
    for name, item in request['files'].items():
        try:
            layers.checked_store_file(store, name, item['sha256'], item['bytes'])
        except (OSError, ValueError):
            continue
        found[name] = dict(item)
    return {'schema': 1, 'releaseSha': request['releaseSha'], 'files': found}


def _plan(manifest, required, hints):
    if hints is None:
        hints = {'schema': 1, 'releaseSha': manifest['releaseId'], 'files': {}}
    hints = _validated_request(hints)
    if hints['releaseSha'] != manifest['releaseId']:
        raise ValueError('Inventory release SHA mismatch')
    upload, reuse = {}, {}
    for name, value in required.items():
        hint = hints['files'].get(name)
        hit = hint == {'sha256': value[0], 'bytes': value[1]}
        (reuse if hit and not name.startswith('releases/') else upload)[name] = value
    archives = {layer['archive']: layer for layer in manifest['layers'].values()}
    def raw(files):
        return sum(archives[name]['rawBytes'] + archives[name]['symlinkTargetBytes'] if name in archives else value[1] for name, value in files.items())
    return {'schema': 1, 'releaseSha': manifest['releaseId'], 'manifestSha256': required[f'releases/{manifest["releaseId"]}.json'][0],
            'required': _records(required), 'upload': _records(upload), 'reuse': _records(reuse),
            'requiredRawBytes': raw(required), 'requiredCompressedBytes': sum(value[1] for value in required.values()),
            'rawTransferBytes': raw(upload), 'compressedTransferBytes': sum(value[1] for value in upload.values()),
            'reuseRawBytes': raw(reuse), 'reuseCompressedBytes': sum(value[1] for value in reuse.values()),
            'inventoryIsAdvisory': True, 'productionReady': False}


def plan(store, manifest_path, manifest_sha, inventory=None):
    """Plan local file transfer using optional advisory remote inventory JSON."""
    _, manifest, _, required = _release(store, manifest_path, manifest_sha)
    return _plan(manifest, required, inventory)


def _pending(parent, prefix):
    layers.directory(parent)
    for _ in range(10):
        path = parent / (prefix + secrets.token_hex(12))
        try:
            path.mkdir(mode=0o755)
            return path
        except FileExistsError:
            continue
    raise ValueError('Cannot create exclusive transport staging directory')


def bundle(store, manifest_path, output, manifest_sha, inventory=None):
    """Publish a new subset bundle; manifest always travels, full source verified."""
    store, manifest, _, required = _release(store, manifest_path, manifest_sha)
    output = layers.ancestors_safe(output)
    if output.is_relative_to(store) or os.path.lexists(output):
        raise ValueError('Bundle output must be new and outside the source store')
    planned = _plan(manifest, required, inventory)
    entries = [{'path': item['path'], 'type': 'file', 'mode': 0o644, 'bytes': item['bytes'], 'sha256': item['sha256']} for item in planned['upload']]
    staging = _pending(output.parent, '.bundle-')
    try:
        archive = staging / 'transport.tgz'
        checksum, size = layers.make_archive(store, archive, entries)
        try:
            os.link(archive, output)
        except FileExistsError as error:
            raise ValueError('Immutable bundle output already exists') from error
    finally:
        shutil.rmtree(staging)
    return {**planned, 'bundle': str(output), 'outerSha256': checksum, 'bytes': size}


def unpack_bundle(archive, destination, release_sha, manifest_sha):
    """Validate subset transport, atomically publish its files; return manifest/body/files.

    Omitted files MUST be checked against the trusted store by the server adapter.
    """
    _sha(release_sha, HEX40)
    _sha(manifest_sha)
    archive = layers.ancestors_safe(archive)
    destination = layers.ancestors_safe(destination)
    if os.path.lexists(destination) or archive.is_relative_to(destination):
        raise ValueError('Unpack destination must be new and outside the archive')
    archive_stat = archive.lstat()
    if not stat.S_ISREG(archive_stat.st_mode) or not 0 < archive_stat.st_size <= MAX_OUTER:
        raise ValueError('Outer archive must be a bounded regular file')
    staging = None
    try:
        with tarfile.open(archive, 'r:gz') as tar:
            members, names, total = [], set(), 0
            for item in tar:
                total += item.size
                if item.name in names or len(members) >= 7 or item.size < 0 or total > MAX_OUTER:
                    raise ValueError('Outer duplicate/member count/size bound')
                if item.type not in (tarfile.REGTYPE, tarfile.AREGTYPE):
                    raise ValueError('Outer transport permits regular files only')
                names.add(item.name)
                members.append(item)
            manifest_name = f'releases/{release_sha}.json'
            matches = [item for item in members if item.name == manifest_name]
            if len(matches) != 1 or matches[0].size > MAX_MANIFEST:
                raise ValueError('Outer manifest is missing or oversized')
            with tar.extractfile(matches[0]) as stream:
                body = stream.read(MAX_MANIFEST + 1)
            if layers.digest(body) != manifest_sha:
                raise ValueError('Release manifest checksum mismatch')
            manifest = layers.parse(body)
            required = required_files(manifest, release_sha, body)
            if layers.finish_manifest(layers.parse(body)) != body:
                raise ValueError('Release manifest accounting mismatch')
            if not names.issubset(required):
                raise ValueError('Outer escaping or extra object path')
            provided = {name: required[name] for name in names}
            # Check every body before creating output, including hashes and sizes.
            for item in members:
                checksum, size = provided[item.name]
                if item.size != size:
                    raise ValueError('Outer member size mismatch')
                with tar.extractfile(item) as stream:
                    digest = hashlib.sha256()
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(block)
                    actual = digest.hexdigest()
                if actual != checksum:
                    raise ValueError('Outer member checksum mismatch')
            staging = _pending(destination.parent, '.unpack-')
            for item in members:
                target = staging / item.name
                layers.directory(target.parent)
                with tar.extractfile(item) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o600)
                # Recheck the bytes actually written (archive may have raced).
                if target.stat().st_size != provided[item.name][1] or layers.file_digest(target) != provided[item.name][0]:
                    raise ValueError('Written outer member hash/size mismatch')
        if layers.stat_identity(archive_stat) != layers.stat_identity(archive.lstat()):
            raise ValueError('Outer archive changed during validation')
        if os.name == 'posix':
            layers.rename_no_replace(staging, destination)
        else:
            os.rename(staging, destination)  # Windows rename refuses existing targets.
        return manifest, body, provided
    except (tarfile.TarError, EOFError) as error:
        raise ValueError('Invalid outer archive') from error
    finally:
        if staging is not None and staging.exists():
            shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('request', 'plan', 'bundle'):
        sub = commands.add_parser(name)
        sub.add_argument('store', type=Path)
        sub.add_argument('manifest', type=Path)
        if name == 'bundle':
            sub.add_argument('output', type=Path)
        sub.add_argument('--manifest-sha256', required=True)
        if name != 'request':
            sub.add_argument('--inventory', type=Path)
    inv = commands.add_parser('inventory')
    inv.add_argument('store', type=Path)
    inv.add_argument('request', type=Path)
    unpack = commands.add_parser('unpack')
    unpack.add_argument('archive', type=Path)
    unpack.add_argument('destination', type=Path)
    unpack.add_argument('--release-sha', required=True)
    unpack.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args()
    if args.command == 'inventory':
        result = inventory(args.store, layers.parse(layers.read_regular(args.request)))
    elif args.command == 'unpack':
        manifest, _, provided = unpack_bundle(args.archive, args.destination, args.release_sha, args.manifest_sha256)
        result = {'manifest': manifest, 'provided': _records(provided), 'destination': str(layers.absolute(args.destination)), 'productionReady': False}
    else:
        hints = layers.parse(layers.read_regular(args.inventory)) if getattr(args, 'inventory', None) else None
        if args.command == 'request':
            result = request(args.store, args.manifest, args.manifest_sha256)
        elif args.command == 'plan':
            result = plan(args.store, args.manifest, args.manifest_sha256, hints)
        else:
            result = bundle(args.store, args.manifest, args.output, args.manifest_sha256, hints)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, RuntimeError) as error:
        print('Local release transport failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
