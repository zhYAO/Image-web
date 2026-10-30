"""Missing-only static blob transport; inventory is advisory, never authority."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile

_spec = importlib.util.spec_from_file_location('frontend_transport_manifest', Path(__file__).with_name('manifest.py'))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def validate_objects(items):
    if type(items) is not list or not 1 <= len(items) <= m.MAX_FILES: raise ValueError('Invalid bounded object list')
    seen, total = set(), 0
    for item in items:
        m.keys(item, ['sha256', 'bytes'])
        m.checksum(item['sha256'])
        m.integer(item['bytes'], 0, m.MAX_FILE)
        if item['sha256'] in seen: raise ValueError('Duplicate object identity')
        seen.add(item['sha256'])
        total += item['bytes']
    if total > m.MAX_BYTES: raise ValueError('Object list exceeds byte budget')
    return items


def validate_request(value):
    m.keys(value, ['schemaVersion', 'assetNamespace', 'artifactId', 'manifestSha256', 'objects'])
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1: raise ValueError('Invalid inventory schema')
    m.identifier(value['assetNamespace'])
    m.checksum(value['artifactId'])
    m.checksum(value['manifestSha256'])
    validate_objects(value['objects'])
    return value


def objects_from_index(index):
    m.keys(index, ['schemaVersion', 'files'])
    if type(index['schemaVersion']) is not int or index['schemaVersion'] != 1 or type(index['files']) is not list or not 1 <= len(index['files']) <= m.MAX_FILES:
        raise ValueError('Invalid transport file index')
    objects, paths, total = {}, set(), 0
    for entry in index['files']:
        m.keys(entry, ['path', 'bytes', 'sha256'])
        m.payload_path(entry['path'])
        import unicodedata
        normalized = unicodedata.normalize('NFC', entry['path']).lower()
        if normalized in paths: raise ValueError('Duplicate portable index path')
        paths.add(normalized)
        m.checksum(entry['sha256'])
        m.integer(entry['bytes'], 0, m.MAX_FILE)
        total += entry['bytes']
        if entry['sha256'] in objects and objects[entry['sha256']] != entry['bytes']:
            raise ValueError('Conflicting object byte size')
        objects[entry['sha256']] = entry['bytes']
    if total > m.MAX_BYTES: raise ValueError('Indexed payload exceeds budget')
    return [{'sha256': checksum, 'bytes': size} for checksum, size in sorted(objects.items())]


def request(archive, manifest_sha):
    with tempfile.TemporaryDirectory(prefix='zimage-frontend-request-') as temporary:
        root = Path(temporary).resolve() / 'dist'
        manifest = m.unpack(archive, root, manifest_sha)
        index = m.parse(m.read_regular(root / '.release/file-index.json', m.MAX_JSON))
        return {'schemaVersion': 1, 'assetNamespace': manifest['assetNamespace'], 'artifactId': manifest['artifactId'],
                'manifestSha256': manifest_sha, 'objects': objects_from_index(index)}


def bundle(archive, output, manifest_sha, inventory):
    m.keys(inventory, ['schemaVersion', 'assetNamespace', 'artifactId', 'manifestSha256', 'objects', 'found'])
    validate_request({key: value for key, value in inventory.items() if key != 'found'})
    found = inventory['found']
    if found: validate_objects(found)
    if type(found) is not list: raise ValueError('Invalid inventory hints')
    output = Path(os.path.abspath(output))
    m.safe_directory(output.parent)
    if os.path.lexists(output): raise ValueError('Transport output already exists')
    with tempfile.TemporaryDirectory(prefix='zimage-frontend-bundle-') as temporary:
        root = Path(temporary).resolve() / 'dist'
        value = m.unpack(archive, root, manifest_sha)
        index = m.parse(m.read_regular(root / '.release/file-index.json', m.MAX_JSON))
        expected = {'schemaVersion': 1, 'assetNamespace': value['assetNamespace'], 'artifactId': value['artifactId'],
                    'manifestSha256': manifest_sha, 'objects': objects_from_index(index)}
        if any(inventory[key] != val for key, val in expected.items()): raise ValueError('Inventory subject differs from full verified artifact')
        if any(item not in expected['objects'] for item in found): raise ValueError('Inventory contains unrequested object')
        upload = [item for item in expected['objects'] if item not in found]
        descriptor = dict(expected, found=found)
        paths = {entry['sha256']: entry['path'] for entry in index['files']}
        try:
            with output.open('xb') as raw:
                with tarfile.open(fileobj=raw, mode='w:gz', format=tarfile.USTAR_FORMAT) as tar:
                    for name in sorted(m.INTERNAL):
                        body = m.read_regular(root / name, m.MAX_JSON)
                        info = tarfile.TarInfo(name)
                        info.size, info.mode = len(body), 0o644
                        tar.addfile(info, io.BytesIO(body))
                    body = m.canonical(descriptor)
                    info = tarfile.TarInfo('.transport.json')
                    info.size, info.mode = len(body), 0o644
                    tar.addfile(info, io.BytesIO(body))
                    for item in upload:
                        source = root / paths[item['sha256']]
                        if m.hash_regular(source) != (item['bytes'], item['sha256']): raise ValueError('Verified source object changed')
                        info = tarfile.TarInfo('blobs/' + item['sha256'])
                        info.size, info.mode = item['bytes'], 0o644
                        with source.open('rb') as stream: tar.addfile(info, stream)
                raw.flush()
                os.fsync(raw.fileno())
            checksum = hashlib.sha256()
            with output.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''): checksum.update(block)
            if output.stat().st_size > m.MAX_ARCHIVE: raise ValueError('Transport exceeds compressed budget')
        except BaseException:
            output.unlink(missing_ok=True)
            raise
        return {'schemaVersion': 1, 'archive': str(output), 'archiveSha256': checksum.hexdigest(), 'archiveBytes': output.stat().st_size,
                'manifestSha256': manifest_sha, 'assetNamespace': value['assetNamespace'], 'artifactId': value['artifactId'],
                'uploadBlobBytes': sum(x['bytes'] for x in upload), 'reusedBlobBytes': sum(x['bytes'] for x in found),
                'uploadBlobCount': len(upload), 'reusedBlobCount': len(found), 'productionReady': False}


def transport_path(name):
    if name == '.transport.json' or re.fullmatch(r'blobs/[a-f0-9]{64}', name): return name
    return m.payload_path(name, internal=True)


def copy_object(source, target, item):
    """Make independent regular files, never links into a shared mutable tree."""
    if m.hash_regular(source) != (item['bytes'], item['sha256']): raise ValueError('Source object checksum/size mismatch')
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    hasher, size = hashlib.sha256(), 0
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(source_fd, 'rb') as stream, target.open('xb') as out:
        before = os.fstat(stream.fileno())
        if before.st_nlink != 1: raise ValueError('Linked source object')
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            size += len(block)
            if size > item['bytes']: raise ValueError('Source object grew during copy')
            hasher.update(block)
            out.write(block)
        out.flush()
        os.fsync(out.fileno())
        if m.signature(before) != m.signature(os.fstat(stream.fileno())) or size != item['bytes'] or hasher.hexdigest() != item['sha256']:
            raise ValueError('Source object changed during copy')


def assemble(archive, destination, manifest_sha, cached_object):
    destination = Path(destination)
    temporary = Path(tempfile.mkdtemp(prefix='transport-', dir=destination.parent))
    extracted = temporary / 'incoming'
    try:
        m.extract_strict(archive, extracted, validator=transport_path)
        if not (extracted / '.transport.json').exists():
            os.rename(extracted, destination)
            return m.verify(destination, manifest_sha)
        descriptor = m.parse(m.read_regular(extracted / '.transport.json', m.MAX_JSON))
        m.keys(descriptor, ['schemaVersion', 'assetNamespace', 'artifactId', 'manifestSha256', 'objects', 'found'])
        validate_request({key: value for key, value in descriptor.items() if key != 'found'})
        found = descriptor['found']
        if type(found) is not list: raise ValueError('Invalid reused object list')
        if found: validate_objects(found)
        if any(item not in descriptor['objects'] for item in found): raise ValueError('Unexpected reused object')
        manifest_body = m.read_regular(extracted / '.release/manifest.json', m.MAX_JSON)
        if m.digest(manifest_body) != manifest_sha or descriptor['manifestSha256'] != manifest_sha: raise ValueError('Transport manifest checksum mismatch')
        manifest = m.validate_manifest(m.parse(manifest_body))
        index_body = m.read_regular(extracted / '.release/file-index.json', m.MAX_JSON)
        if m.digest(index_body) != manifest['fileIndex']['sha256']: raise ValueError('Transport index checksum mismatch')
        index = m.parse(index_body)
        if descriptor['objects'] != objects_from_index(index) or descriptor['artifactId'] != manifest['artifactId'] or descriptor['assetNamespace'] != manifest['assetNamespace']:
            raise ValueError('Transport closure differs from formal manifest')
        upload = [item for item in descriptor['objects'] if item not in found]
        expected_paths = {*m.INTERNAL, '.transport.json', *('blobs/' + item['sha256'] for item in upload)}
        actual_paths = {path.relative_to(extracted).as_posix() for path in extracted.rglob('*') if not path.is_dir()}
        if actual_paths != expected_paths: raise ValueError('Transport contains missing/extra blob files')
        destination.mkdir(mode=0o700)
        (destination / '.release').mkdir(mode=0o700)
        for name in m.INTERNAL:
            shutil.copyfile(extracted / name, destination / name)
        for entry in index['files']:
            item = {'sha256': entry['sha256'], 'bytes': entry['bytes']}
            source = cached_object(item) if item in found else extracted / 'blobs' / entry['sha256']
            copy_object(source, destination / entry['path'], item)
        return m.verify(destination, manifest_sha)
    finally: shutil.rmtree(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ['request', 'bundle']:
        child = sub.add_parser(command)
        child.add_argument('--archive', required=True)
        child.add_argument('--manifest-sha256', required=True)
        if command == 'bundle':
            child.add_argument('--inventory', required=True)
            child.add_argument('--output', required=True)
    args = parser.parse_args()
    if hasattr(os, 'geteuid') and os.geteuid() == 0: raise ValueError('Local transport must run without root')
    if args.command == 'request': result = request(Path(args.archive), args.manifest_sha256)
    else: result = bundle(Path(args.archive), Path(args.output), args.manifest_sha256, m.parse(m.read_regular(Path(args.inventory), m.MAX_JSON)))
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Frontend transport rejected: ' + str(error), file=sys.stderr)
        sys.exit(1)
