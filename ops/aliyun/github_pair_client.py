"""Prepare the SSH payload from artifact IDs bound to the current Actions attempt."""
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from github_pair_handoff import API, COMMIT, MEMBERS, REPO, assert_main, file_sha
from github_shadow_signer_intake import REPO_ID, WORKFLOW

ARTIFACTS = {
    'backend': ('shadow-rehearsal-backend', 100_000_000, ()),
    'frontend': ('shadow-rehearsal-frontend', 100_000_000, ()),
    'stage': ('stage-attestation', 2_000_000, ('stage.json', 'stage.bundle.jsonl')),
    'descriptor': ('shadow-pair-descriptor', 150_000, ('pins.json', 'config.json')),
}
NUMBER = re.compile('[1-9][0-9]{0,18}')
DIGEST = re.compile('sha256:[a-f0-9]{64}')


def check(value):
    if not value:
        raise ValueError('Unexpected same-attempt publish handoff')


def collect(target, *, commit, run, attempt, ids, get, download, intake):
    check(COMMIT.fullmatch(commit) and all(type(n) is int and 0 < n < 2**63 for n in (run, attempt)))
    check(set(ids) == set(ARTIFACTS) and len(set(ids.values())) == len(ids)
          and all(type(n) is int and 0 < n < 2**63 for n in ids.values()))
    assert_main(get, commit)
    target.mkdir(mode=0o700)
    digests = {}
    with tempfile.TemporaryDirectory(prefix='zimage-publish-download-', dir=target.parent) as temp:
        tmp = Path(temp)
        for label, (prefix, maximum, names) in ARTIFACTS.items():
            path = f'{API}/actions/artifacts/{ids[label]}'
            artifact = get(path)
            binding, size, digest = (artifact[k] for k in ('workflow_run', 'size_in_bytes', 'digest'))
            check(artifact['id'] == ids[label] and artifact['expired'] is False
                  and artifact['name'] == f'{prefix}-{commit}-{run}-{attempt}' and DIGEST.fullmatch(digest)
                  and type(size) is int and 0 < size <= maximum
                  and binding['id'] == run and binding['head_sha'] == commit and binding['head_branch'] == 'main'
                  and binding['repository_id'] == binding['head_repository_id'] == REPO_ID)
            zip_path = (tmp if names else target) / (label + '.zip')
            download(path + '/zip', zip_path, size)
            check(zip_path.stat().st_size == size and file_sha(zip_path) == digest[7:])
            digests[label] = digest[7:]
            if names:
                intake.extract_github_zip(zip_path, tmp / label, digests[label], names)
                for name in names:
                    (tmp / label / name).rename(target / name)

    for name, cap in MEMBERS:
        check(0 < (target / name).stat().st_size <= cap)
    pins = intake.read_json(target / 'pins.json')
    statement = intake.read_json(target / 'stage.json')
    check(intake.hosted_namespace(pins, 'hosted-shadow')
          and (pins['commit'], pins['runId'], pins['attempt']) == (commit, run, attempt)
          and (statement['sourceSHA'], statement['runId'], statement['attempt']) == (commit, run, attempt))
    for label in ('backend', 'frontend'):
        check(pins[label]['artifactSha256'] == statement[label + 'Sha256'] == digests[label])
    assert_main(get, commit)


def main():
    import json
    env = os.environ
    check(len(sys.argv) == 2 and env['GITHUB_REPOSITORY'] == REPO
          and env['GITHUB_EVENT_NAME'] == 'push' and env['GITHUB_REF'] == 'refs/heads/main'
          and env['GITHUB_REF_PROTECTED'] == 'true' and env['RUNNER_ENVIRONMENT'] == 'github-hosted'
          and env['GITHUB_WORKFLOW_REF'] == REPO + '/' + WORKFLOW + '@refs/heads/main')

    def number(value):
        check(NUMBER.fullmatch(value))
        return int(value)

    def get(path):
        result = subprocess.run(['gh', 'api', path], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=20, check=True)
        check(0 < len(result.stdout) <= 1_000_000)
        return json.loads(result.stdout)

    def download(path, destination, size):
        with destination.open('xb') as out:
            gh = subprocess.Popen(['gh', 'api', path], stdin=subprocess.DEVNULL,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                remaining = size + 1
                while remaining:
                    data = gh.stdout.read(min(remaining, 1024 * 1024))
                    if not data:
                        break
                    out.write(data)
                    remaining -= len(data)
                check(remaining == 1 and gh.wait(timeout=10) == 0)
            finally:
                if gh.poll() is None:
                    gh.kill()
                    gh.wait()
                gh.stdout.close()

    spec = importlib.util.spec_from_file_location('intake', Path(__file__).with_name('github-rehearsal-intake.py'))
    intake = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(intake)
    collect(Path(sys.argv[1]), commit=env['GITHUB_SHA'], run=number(env['GITHUB_RUN_ID']),
            attempt=number(env['GITHUB_RUN_ATTEMPT']), ids={k: number(env[k.upper() + '_ID']) for k in ARTIFACTS},
            get=get, download=download, intake=intake)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception:
        sys.exit('Same-attempt publication handoff refused')
