"""Fail-closed, read-only GitHub candidate selection and verified local extraction."""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta
import zipfile

WORKFLOW = '.github/workflows/ci.yml'
FILES = {'transport.tgz', 'release-result.json', 'dist-size-report.json', 'candidate.json'}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def validate(repo, run, jobs, artifact, workflow, sha, run_id, attempt, now):
    require(repo['full_name'] == 'zhYAO/Image-web', 'Unexpected repository')
    require(workflow['path'] == WORKFLOW and run['workflow_id'] == workflow['id'], 'Untrusted workflow')
    require(run['path'] == WORKFLOW and run['repository']['id'] == repo['id']
            and run['head_repository']['id'] == repo['id'], 'Untrusted run source')
    require(run['id'] == run_id and run['run_attempt'] == attempt, 'Run/attempt mismatch')
    require(run['event'] == 'workflow_dispatch' and run['head_branch'] == 'main'
            and run['head_sha'] == sha and run['status'] == 'completed'
            and run['conclusion'] == 'success', 'Candidate must be successful current-main manual run')
    candidate = [j for j in jobs if j['name'] == 'candidate-build']
    require(len(candidate) == 1 and candidate[0]['conclusion'] == 'success'
            and candidate[0]['run_id'] == run_id, 'Candidate build job did not succeed')
    require(not any(j['name'] in ('deploy', 'rollback') and j['conclusion'] != 'skipped' for j in jobs),
            'Run is not build-only')
    require(artifact['name'] == f'candidate-{sha}-{run_id}-{attempt}' and not artifact['expired'], 'Wrong/expired artifact')
    binding = artifact['workflow_run']
    require(binding['id'] == run_id and binding['head_sha'] == sha
            and binding['head_branch'] == 'main' and binding['repository_id'] == repo['id']
            and binding['head_repository_id'] == repo['id'], 'Artifact source mismatch')
    created = datetime.fromisoformat(artifact['created_at'].replace('Z', '+00:00'))
    expires = datetime.fromisoformat(artifact['expires_at'].replace('Z', '+00:00'))
    require(created <= now < expires and now - created < timedelta(days=1), 'Artifact expired or older than one day')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', artifact.get('digest') or '') is not None, 'Missing artifact SHA256')

def unpack(data, artifact, sha, run_id, attempt, destination):
    require('sha256:' + hashlib.sha256(data).hexdigest() == artifact['digest'], 'Artifact SHA256 mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        require(len(names) == len(FILES) and set(names) == FILES, 'Unexpected archive entries')
        for info in archive.infolist():
            require(info.file_size <= 4 * 1024**3 and not info.is_dir()
                    and (info.external_attr >> 16) & 0o170000 in (0, 0o100000), 'Unsafe artifact member')
        provenance = json.loads(archive.read('candidate.json'))
        require(provenance == {'schema': 1, 'repository': 'zhYAO/Image-web', 'workflow': WORKFLOW,
                              'action': 'candidate', 'sha': sha, 'run_id': run_id, 'attempt': attempt,
                              'transport_sha256': hashlib.sha256(archive.read('transport.tgz')).hexdigest()},
                'Candidate provenance mismatch')
        report = json.loads(archive.read('release-result.json'))
        require(report['schema'] == 1 and report['releaseSha'] == sha
                and report['format'] in ('layers', 'full') and report['productionReady'] is False,
                'Invalid release report')
        destination.mkdir(parents=True, exist_ok=False)
        for name in names:
            (destination / name).write_bytes(archive.read(name))

def api(path, binary=False):
    data = subprocess.check_output(['gh', 'api', f'repos/zhYAO/Image-web{path}'])
    return data if binary else json.loads(data)

def main():
    require(len(sys.argv) == 5, 'Expected run ID, attempt, SHA and new destination')
    run_text, attempt_text, sha, destination = sys.argv[1:]
    require(re.fullmatch(r'[1-9][0-9]*', run_text) and re.fullmatch(r'[1-9][0-9]*', attempt_text), 'Invalid run/attempt')
    require(re.fullmatch(r'[a-f0-9]{40}', sha), 'Invalid SHA')
    run_id, attempt = int(run_text), int(attempt_text)
    repo = api('')
    require(api('/commits/main')['sha'] == sha, 'Main moved')
    workflow = api('/actions/workflows/ci.yml')
    run = api(f'/actions/runs/{run_id}')
    jobs_response = api(f'/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    require(jobs_response['total_count'] <= 100, 'Too many jobs')
    artifacts = api(f'/actions/runs/{run_id}/artifacts?per_page=100')
    require(artifacts['total_count'] <= 100, 'Too many artifacts')
    selected = [a for a in artifacts['artifacts'] if a['name'] == f'candidate-{sha}-{run_id}-{attempt}']
    require(len(selected) == 1, 'Expected exactly one candidate artifact')
    artifact = selected[0]
    validate(repo, run, jobs_response['jobs'], artifact, workflow, sha, run_id, attempt, datetime.now(timezone.utc))
    data = api(f'/actions/artifacts/{int(artifact["id"])}/zip', binary=True)
    require(api('/commits/main')['sha'] == sha, 'Main moved during download')
    # Recheck expiry/attempt after transfer; never accept a rerun or artifact change.
    fresh = api(f'/actions/artifacts/{int(artifact["id"])}')
    require(fresh == artifact, 'Artifact metadata changed during download')
    validate(repo, api(f'/actions/runs/{run_id}'), jobs_response['jobs'], fresh, workflow,
             sha, run_id, attempt, datetime.now(timezone.utc))
    unpack(data, artifact, sha, run_id, attempt, Path(destination))
    print(json.dumps({'artifact_id': artifact['id'], 'digest': artifact['digest'], 'run_id': run_id, 'attempt': attempt}))

if __name__ == '__main__':
    main()
