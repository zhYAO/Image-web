"""Produce rehearsal-only receipts, never a production receipt or approval."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile


def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
    return {'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha.hexdigest()}


def write_receipt(component, delivery, source, env):
    if component not in ('backend', 'frontend'):
        raise ValueError('Unexpected rehearsal component')
    sha = env['GITHUB_SHA']
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('Expected exact source SHA')
    receipt = {'schema': 1, 'kind': 'isolated-github-rehearsal', 'productionReady': False,
               'repository': 'zhYAO/Image-web', 'workflow': '.github/workflows/rehearsal-candidates.yml',
               'commit': sha, 'runId': int(env['GITHUB_RUN_ID']), 'attempt': int(env['GITHUB_RUN_ATTEMPT']),
               'component': component}
    if env.get('ZIMAGE_PROTECTED_MAIN_BROWSER_SHADOW') == 'true':
        receipt['kind'] = 'isolated-github-browser-shadow'
    if component == 'backend':
        result = json.loads(source.read_text())
        manifest = result['manifest']
        if (manifest['schema'] != 3 or manifest.get('runtimeProfile') != 'model-only-jsquash'
                or manifest.get('releaseId') != sha or manifest.get('productionReady') is not False
                or len(result['provided']) != 7):
            raise ValueError('Expected full new-model-only backend transport')
        receipt['files'] = [digest(delivery / 'transport.tgz')]
    else:
        source = source.resolve(strict=True)
        candidate = json.loads((source / '.release/candidate.json').read_text())
        match = env['MATCH_BACKEND_SHA']
        if (candidate['sourceIdentity'].get('dirty') is not False
                or candidate['sourceIdentity'].get('sourceSHA') != sha
                or candidate.get('allowedBackendReleases') != [match]):
            raise ValueError('Frontend source/backend binding differs')
        output = delivery / 'frontend-rehearsal.tgz'
        paths = []
        for base, dirs, files in os.walk(source, followlinks=False):
            for name in dirs + files:
                file = Path(base) / name
                info = file.lstat()
                name = file.relative_to(source).as_posix()
                if (any(part.startswith('.') for part in name.split('/'))
                        and name not in ('.release', '.release/candidate.json')):
                    raise ValueError('Unexpected hidden frontend member')
                if stat.S_ISDIR(info.st_mode):
                    continue
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or name.endswith('.map') or 'playwright-report' in name.split('/'):
                    raise ValueError('Unexpected frontend release file')
                paths.append((name, file))
        if not 0 < len(paths) < 10000 or sum(p.stat().st_size for _, p in paths) > 100_000_000:
            raise ValueError('Unexpected frontend closure size')
        with tarfile.open(output, 'x:gz', format=tarfile.USTAR_FORMAT) as tar:
            for name, file in sorted(paths):
                info = tarfile.TarInfo(name)
                info.size, info.mode = file.stat().st_size, 0o644
                with file.open('rb') as member:
                    tar.addfile(info, member)
        receipt['files'] = [digest(output), digest(delivery / 'frontend-subject.json')]
        receipt['backendToEvaluate'] = match
    with (delivery / 'rehearsal-receipt.json').open('x') as out:
        json.dump(receipt, out, sort_keys=True, indent=2)
        out.write('\n')


if __name__ == '__main__':
    write_receipt(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), os.environ)
