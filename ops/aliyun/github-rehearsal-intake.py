"""Offline immutable pair verification. This cannot approve or deploy a release."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import stat
import tarfile
import tempfile
import zipfile

from sys import exit as failure

HERE = Path(__file__).resolve().parent
WORKFLOW = '.github/workflows/rehearsal-candidates.yml'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def exact_dir(path, allowed):
    if path.is_symlink() or not path.is_dir() or {f.name for f in path.iterdir()} != set(allowed):
        raise ValueError('Mismatched rehearsal file set')
    for file in path.iterdir():
        info = file.lstat()
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= (100_000_000 if file.name.endswith('.tgz') else 1_000_000):
            raise ValueError('Unsafe rehearsal file size or type')


def checked(path, expected):
    if digest(path) != expected:
        raise ValueError('Rehearsal file SHA-256 differs from trusted pin')


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1_000_000:
        raise ValueError('Expected a bounded regular JSON file')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=unique)


def closure_receipt(directory, component, expected, sha, run, attempt, *, shadow=False):
    files = {'backend': (('transport.tgz', 'archiveSha256'),),
             'frontend': (('frontend-rehearsal.tgz', 'archiveSha256'), ('frontend-subject.json', 'subjectSha256'))}[component]
    exact_dir(directory, [name for name, _ in files] + ['rehearsal-receipt.json'])
    checked(directory / 'rehearsal-receipt.json', expected['receiptSha256'])
    rec = dict(schema=1, kind=('isolated-github-browser-shadow' if shadow else 'isolated-github-rehearsal'), productionReady=False, repository='zhYAO/Image-web',
               workflow=WORKFLOW, commit=sha, runId=run, attempt=attempt, component=component)
    if component == 'frontend':
        rec['backendToEvaluate'] = sha
    rec['files'] = []
    for name, field in files:
        path = directory / name
        checked(path, expected[field])
        rec['files'].append(dict(name=name, bytes=path.stat().st_size, sha256=expected[field]))
    if rec != read_json(directory / 'rehearsal-receipt.json'):
        raise ValueError('Rehearsal receipt does not bind exact same run and payload')


def extract_github_zip(source, destination, expected, names):
    if source.is_symlink() or not source.is_file() or not 0 < source.stat().st_size <= 100_000_000:
        raise ValueError('Expected bounded and immutable GitHub artifact ZIP')
    checked(source, expected)
    destination.mkdir()
    with zipfile.ZipFile(source) as archive:
        items = archive.infolist()
        if len(items) != len(names) or {m.filename for m in items} != set(names):
            raise ValueError('Unexpected ZIP member set')
        for item in items:
            mode = stat.S_IFMT(item.external_attr >> 16)
            size = item.file_size
            if (item.is_dir() or mode not in (0, stat.S_IFREG) or item.flag_bits & 1 or
                    not 0 < size <= (100_000_000 if item.filename.endswith('.tgz') else 1_000_000)):
                raise ValueError('Unsafe GitHub ZIP member size or type')
            with archive.open(item) as stream, (destination / item.filename).open('xb') as out:
                remaining = size
                while remaining:
                    block = stream.read(min(1024 * 1024, remaining))
                    if not block:
                        raise ValueError('Truncated GitHub ZIP member')
                    out.write(block)
                    remaining -= len(block)
                if stream.read(1):
                    raise ValueError('Oversized GitHub ZIP member')

def evaluate(pins, backend, frontend, public_config):
    fields = {'commit', 'runId', 'attempt', 'treeFingerprint', 'lockfileSha256', 'backend', 'frontend'}
    shadow = pins.get('lane') == 'browser-shadow'
    if (set(pins) != fields | {'frontendNamespace', 'lane'} if shadow else
            set(pins) not in (fields, fields | {'frontendNamespace'})):
        raise ValueError('Missing independently supplied same-run pins')
    sha, run, attempt = (pins[k] for k in ('commit', 'runId', 'attempt'))
    if not isinstance(sha, str) or not re.fullmatch(r'[a-f0-9]{40}', sha) or any(type(n) is not int or n <= 0 for n in (run, attempt)):
        raise ValueError('Invalid frozen GitHub identity')
    if any(not isinstance(pins[k], str) or not re.fullmatch(r'[a-f0-9]{64}', pins[k]) for k in ('treeFingerprint', 'lockfileSha256')):
        raise ValueError('Expected clean source identity')
    rehearsal = f'rehearsal-{sha}-{run}-{attempt}'
    namespace = pins.get('frontendNamespace', rehearsal)
    if (namespace != 'release-' + sha[:12] if shadow else namespace not in (rehearsal, 'release-' + sha[:12])):
        raise ValueError('Unexpected exact frontend namespace')
    for component, extra in (('backend', 'manifestSha256'), ('frontend', 'subjectSha256')):
        pin = pins[component]
        if set(pin) != {'artifactSha256', 'archiveSha256', 'receiptSha256', extra} or any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{64}', v) for v in pin.values()):
            raise ValueError('Missing independently supplied digest')
    transport = load('intake_transport', HERE / 'release-transport.py')
    fm = load('intake_frontend', HERE / 'frontend/manifest.py')
    with tempfile.TemporaryDirectory(prefix='zimage-offline-intake-') as tmp:
        root = Path(tmp).resolve()
        output = {}
        for component, archive, names in (
            ('backend', backend, ['transport.tgz', 'rehearsal-receipt.json']),
            ('frontend', frontend, ['frontend-rehearsal.tgz', 'frontend-subject.json', 'rehearsal-receipt.json']),
        ):
            output[component] = root / component
            extract_github_zip(archive, output[component], pins[component]['artifactSha256'], names)
            closure_receipt(output[component], component, pins[component], sha, run, attempt, shadow=shadow)
        store = root / 'store'
        ms = pins['backend']['manifestSha256']
        manifest, body, provided = transport.unpack_bundle(output['backend'] / 'transport.tgz', store, sha, ms)
        if (manifest['schema'] != 3 or manifest.get('runtimeProfile') != 'model-only-jsquash'
                or manifest.get('productionReady') is not False
                or any(manifest['build'].get(k) != sha for k in ('sourceCommit', 'marker', 'buildId'))
                or provided != transport.required_files(manifest, sha, body)):
            raise ValueError('Backend must be a complete frozen same-run model-only transport')
        transport.request(store, store / 'releases' / f'{sha}.json', ms)
        fm.extract_strict(output['frontend'] / 'frontend-rehearsal.tgz', root / 'frontend-dist',
                          validator=lambda name: None if name == '.release/candidate.json' else fm.payload_path(name),
                          max_bytes=100_000_000)
        _, candidate, computed = fm.candidate_files(root / 'frontend-dist', public_config)
        expected_subject = dict(computed, **candidate, acceptanceRequired=True)
        if (expected_subject != read_json(output['frontend'] / 'frontend-subject.json')
                or candidate['namespace'] != namespace
                or candidate['sourceIdentity']['sourceSHA'] != sha or candidate['sourceIdentity']['dirty']
                or any(candidate['sourceIdentity'][k] != pins[k] for k in ('treeFingerprint', 'lockfileSha256'))
                or candidate['allowedBackendReleases'] != [sha]):
            raise ValueError('Frontend exact current candidate/subject/config mismatch')
    return {'commit': sha, 'runId': run, 'attempt': attempt, 'immutablePairVerified': True, 'productionReady': False,
            'status': 'blocked', 'requiredIndependentEvidence': ['authenticated-staging-acceptance-bound-to-frontend-subject-and-backend-receipt',
            'root-managed-frontend-approval', 'reviewed-schema-3-production-lifecycle-provenance', 'protected-production-approval']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for flag in ('pins', 'backend', 'frontend', 'public-config'):
        p.add_argument('--' + flag, type=Path, required=True)
    args = p.parse_args()
    try:
        print(json.dumps(evaluate(read_json(args.pins), args.backend, args.frontend, read_json(args.public_config)), sort_keys=True))
    except (ValueError, OSError, tarfile.TarError, zipfile.BadZipFile, KeyError, TypeError) as exc:
        failure(f'Rehearsal intake rejected: {type(exc).__name__}')
    failure(2)  # Even a valid pair cannot be a green deployment gate.


if __name__ == '__main__':
    main()
