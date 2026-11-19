"""Offline release-side prototype. Requires independently verified frozen candidate pins."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('derive_transport', HERE / 'release-transport.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
layers = transport.layers
MAX_SNAPSHOT_AGE = 300


def checked_archive(path, pin):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise ValueError('Candidate must be a regular single-link archive')
    if before.st_size != pin['transportBytes'] or layers.file_digest(path) != pin['transportSha256']:
        raise ValueError('Frozen candidate digest/size mismatch')
    if layers.stat_identity(before) != layers.stat_identity(path.lstat()):
        raise ValueError('Frozen candidate changed during validation')



def metadata_bytes(path):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= 1000000:
        raise ValueError('Metadata must be a bounded regular file')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_BINARY', 0))
    with os.fdopen(fd, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        # Windows pathname stat and descriptor stat can expose different ctime
        # semantics. Compare shared identity here, and retain the full ctime
        # change check separately within each stat API below.
        def common(info):
            return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_mode)
        if common(before) != common(opened):
            raise ValueError('Metadata changed while opening')
        body = stream.read(1000001)
        if len(body) != before.st_size or layers.stat_identity(opened) != layers.stat_identity(os.fstat(stream.fileno())):
            raise ValueError('Metadata changed while reading')
    if layers.stat_identity(before) != layers.stat_identity(path.lstat()):
        raise ValueError('Metadata path changed while reading')
    return body

def validate_pin(pin):
    expected = {'schema', 'releaseSha', 'manifestSha256', 'transportSha256', 'transportBytes',
                'candidateArtifactSha256', 'runId', 'attempt', 'artifactId'}
    if not isinstance(pin, dict) or set(pin) != expected or type(pin['schema']) is not int or pin['schema'] != 1:
        raise ValueError('Invalid independent candidate pin')
    transport._sha(pin['releaseSha'], transport.HEX40)
    for key in ('manifestSha256', 'transportSha256', 'candidateArtifactSha256'):
        transport._sha(pin[key])
    transport._metadata(pin['transportSha256'], pin['transportBytes'])
    if pin['transportBytes'] == 0 or any(type(pin[k]) is not int or pin[k] <= 0 for k in ('runId','attempt','artifactId')):
        raise ValueError('Invalid independent artifact identity')


def pin_digest(pin):
    return hashlib.sha256(json.dumps(pin, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def snapshot(cache, request, pin, destination_id, now):
    """Read at most seven exact objects. This never creates or writes the cache."""
    validate_pin(pin)
    transport._sha(destination_id)
    return dict(schema=1, destinationId=destination_id, pinSha256=pin_digest(pin),
                capturedAt=now, inventory=transport.inventory(cache, request))


def validate_snapshot(value, expected_sha, pin, destination_id, now):
    transport._sha(expected_sha)
    transport._sha(destination_id)
    if not isinstance(value, dict) or set(value) != {'schema','destinationId','pinSha256','capturedAt','inventory'}:
        raise ValueError('Missing or malformed inventory snapshot')
    body = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    if hashlib.sha256(body).hexdigest() != expected_sha:
        raise ValueError('Independent inventory digest mismatch')
    if type(value['schema']) is not int or value['schema'] != 1 or value['destinationId'] != destination_id or value['pinSha256'] != pin_digest(pin):
        raise ValueError('Inventory belongs to another candidate or destination')
    if type(value['capturedAt']) is not int or not 0 <= now-value['capturedAt'] <= MAX_SNAPSHOT_AGE:
        raise ValueError('Inventory snapshot is stale or from the future')
    inventory = transport._validated_request(value['inventory'])
    if inventory['releaseSha'] != pin['releaseSha']:
        raise ValueError('Inventory release mismatch')
    return inventory


def derive(archive, output, pin, inventory_snapshot, inventory_sha, destination_id, cache, now=None):
    """Preserve the full candidate, verify all objects, derive an immutable subset."""
    now = int(time.time()) if now is None else now
    validate_pin(pin)
    hints = validate_snapshot(inventory_snapshot, inventory_sha, pin, destination_id, now)
    archive, output = layers.ancestors_safe(archive), layers.ancestors_safe(output)
    cache = layers.ancestors_safe(cache)
    if os.path.lexists(output) or output == archive or output.is_relative_to(cache):
        raise ValueError('Derived output must be new and outside candidate/cache')
    checked_archive(archive, pin)
    work = transport._pending(output.parent, '.derive-')
    try:
        store = work / 'full'
        manifest, body, provided = transport.unpack_bundle(archive, store, pin['releaseSha'], pin['manifestSha256'])
        required = transport.required_files(manifest, pin['releaseSha'], body)
        if set(provided) != set(required):
            raise ValueError('Derivation requires every object of the frozen candidate')
        manifest_path = store / 'releases' / (pin['releaseSha']+'.json')
        _, _, _, verified = transport._release(store, manifest_path, pin['manifestSha256'])
        if verified != required:
            raise ValueError('Candidate closure differs from original manifest')
        # Validate original inner archives using the existing bounded extractor.
        # No application or native module is executed.
        for kind in layers.KINDS:
            layer = manifest['layers'][kind]
            index = layers.read_regular(store / layer['index'])
            entries = layers.resource_entries(index)[0] if kind == 'assets' else layers.parse(index)['entries']
            destination = work / ('verify-'+kind)
            destination.mkdir(mode=0o755)
            layers.extract(store / layer['archive'], entries, destination)
        request = transport.request(store, manifest_path, pin['manifestSha256'])
        for name, record in hints['files'].items():
            if request['files'].get(name) != record:
                raise ValueError('Inventory hit metadata differs from verified candidate')
        if transport.inventory(cache, request) != hints:
            raise ValueError('Inventory cache changed or a claimed object is missing')
        staged = work / 'derived.tgz'
        result = transport.bundle(store, manifest_path, staged, pin['manifestSha256'], inventory=hints)
        restored, restored_body, transferred = transport.unpack_bundle(staged, work/'derived-check', pin['releaseSha'], pin['manifestSha256'])
        if restored != manifest or restored_body != body or set(transferred) != {row['path'] for row in result['upload']}:
            raise ValueError('Derived object set or original manifest differs')
        # Reconstruct the destination closure read-only. Missing cached objects
        # or mismatched bytes abort before the derived file is published.
        for name, (checksum, size) in required.items():
            source = work/'derived-check' if name in transferred else cache
            layers.checked_store_file(source, name, checksum, size)
        if transport.inventory(cache, request) != hints:
            raise ValueError('Inventory changed during derivation')
        checked_archive(archive, pin)
        if layers.file_digest(staged) != result['outerSha256'] or staged.stat().st_size != result['bytes']:
            raise ValueError('Derived transport changed after validation')
        report = dict(schema=1, originalCandidate=pin, originalManifestSha256=pin['manifestSha256'],
                      inventorySha256=inventory_sha, destinationId=destination_id,
                      derivedTransportSha256=result['outerSha256'], derivedTransportBytes=result['bytes'],
                      upload=result['upload'], reuse=result['reuse'], rebuild=False,
                      upstreamGithubVerificationRequired=True, destinationActivationVerified=False,
                      productionReady=False)
        os.link(staged, output)  # Exclusive publication, never overwrite another release.
        return report
    finally:
        shutil.rmtree(work)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate','output','pin','snapshot','cache'):
        parser.add_argument('--'+name, type=Path, required=True)
    for name in ('pin-sha256','snapshot-sha256','destination-id'):
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args()
    try:
        raw = metadata_bytes(args.pin)
        if hashlib.sha256(raw).hexdigest() != args.pin_sha256:
            raise ValueError('Independent candidate pin bytes mismatch')
        snapshot_raw = metadata_bytes(args.snapshot)
        result = derive(args.candidate,args.output,layers.parse(raw),layers.parse(snapshot_raw),
                        args.snapshot_sha256,args.destination_id,args.cache)
        print(json.dumps(result))
    except (OSError,ValueError):
        raise SystemExit('Offline derivation failed closed; no activation attempted')
