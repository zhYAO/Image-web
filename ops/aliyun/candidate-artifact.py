"""Fail-closed, read-only GitHub candidate selection and verified local extraction."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from datetime import datetime, timezone, timedelta
import zipfile

WORKFLOW = '.github/workflows/ci.yml'
FILES = {'transport.tgz', 'release-result.json', 'dist-size-report.json', 'candidate.json'}
# Match release-transport.py's existing outer transport bound. ZIP metadata
# has its own small allowance; metadata members never inherit the transport cap.
MAX_TRANSPORT = 2_000_000_000
MAX_METADATA = 1_000_000
MAX_ARCHIVE = MAX_TRANSPORT + 20_000_000
RECEIPT = '.candidate-selection.json'

def file_hash(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()

def local_file(destination, name):
    require(name in FILES | {RECEIPT} and not destination.is_symlink(), 'Unsafe local candidate path')
    path = destination / name
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'Unsafe local candidate file')
    limit = MAX_TRANSPORT if name == 'transport.tgz' else MAX_METADATA
    require(0 < before.st_size <= limit, 'Local candidate size limit exceeded')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    stream = os.fdopen(fd, 'rb')
    after = os.fstat(stream.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        stream.close()
        raise ValueError('Local candidate changed while opening')
    return stream

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
    require(type(artifact['id']) is int and artifact['id'] > 0
            and type(artifact['size_in_bytes']) is int and 0 < artifact['size_in_bytes'] <= MAX_ARCHIVE,
            'Invalid artifact ID or archive size')

def unpack(data, artifact, sha, run_id, attempt, destination):
    require(len(data) <= MAX_ARCHIVE and len(data) == artifact['size_in_bytes'], 'Archive download size mismatch')
    require('sha256:' + hashlib.sha256(data).hexdigest() == artifact['digest'], 'Artifact SHA256 mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        require(len(names) == len(FILES) and set(names) == FILES, 'Unexpected archive entries')
        for info in archive.infolist():
            limit = MAX_TRANSPORT if info.filename == 'transport.tgz' else MAX_METADATA
            require(0 < info.file_size <= limit and not info.is_dir() and not info.flag_bits & 1
                    and (info.external_attr >> 16) & 0o170000 in (0, 0o100000), 'Unsafe artifact member')
        require(sum(i.file_size for i in archive.infolist()) <= MAX_TRANSPORT + 3 * MAX_METADATA,
                'Expanded archive size limit exceeded')
        provenance = json.loads(archive.read('candidate.json'))
        with archive.open('transport.tgz') as transport:
            transport_digest = file_hash(transport)
        require(provenance == {'schema': 1, 'repository': 'zhYAO/Image-web', 'workflow': WORKFLOW,
                              'action': 'candidate', 'sha': sha, 'run_id': run_id, 'attempt': attempt,
                              'transport_sha256': transport_digest},
                'Candidate provenance mismatch')
        report = json.loads(archive.read('release-result.json'))
        require(report['schema'] == 1 and report['releaseSha'] == sha
                and report['format'] in ('layers', 'full') and report['productionReady'] is False,
                'Invalid release report')
        destination.mkdir(mode=0o700, parents=True, exist_ok=False)
        for name in names:
            with archive.open(name) as source, (destination / name).open('xb') as target:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    target.write(chunk)

def api(path, binary=False):
    limit = MAX_ARCHIVE if binary else 10 * MAX_METADATA
    with subprocess.Popen(['gh', 'api', f'repos/zhYAO/Image-web{path}'], stdout=subprocess.PIPE) as process:
        chunks, size = [], 0
        try:
            while chunk := process.stdout.read(1024 * 1024):
                size += len(chunk)
                require(size <= limit, 'GitHub response size limit exceeded')
                chunks.append(chunk)
            require(process.wait() == 0, 'GitHub read failed')
        except BaseException:
            process.kill()
            process.wait()
            raise
    data = b''.join(chunks)
    return data if binary else json.loads(data)

def recheck(destination, sha, run_id, attempt):
    with local_file(destination, RECEIPT) as stream:
        receipt = json.load(stream)
    require(receipt['sha'] == sha and receipt['run_id'] == run_id and receipt['attempt'] == attempt,
            'Local selection mismatch')
    require(set(receipt['files']) == FILES, 'Invalid local selection files')
    for name, digest in receipt['files'].items():
        with local_file(destination, name) as stream:
            require(file_hash(stream) == digest, 'Candidate file changed before upload')
    artifact = receipt['artifact']
    fresh = api(f'/actions/artifacts/{int(artifact["id"])}')
    require(fresh == artifact, 'Selected artifact changed before upload')
    jobs = api(f'/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    require(jobs['total_count'] <= 100, 'Too many jobs')
    validate(api(''), api(f'/actions/runs/{run_id}'), jobs['jobs'], fresh,
             api('/actions/workflows/ci.yml'), sha, run_id, attempt, datetime.now(timezone.utc))
    # Last network observation immediately before the caller's upload command.
    require(api('/commits/main')['sha'] == sha, 'Main moved before upload')

def main():
    args = sys.argv[1:]
    check_only = bool(args and args[0] == '--recheck')
    if check_only: args = args[1:]
    require(len(args) == 4, 'Expected run ID, attempt, SHA and destination')
    run_text, attempt_text, sha, destination = args
    require(re.fullmatch(r'[1-9][0-9]*', run_text) and re.fullmatch(r'[1-9][0-9]*', attempt_text), 'Invalid run/attempt')
    require(re.fullmatch(r'[a-f0-9]{40}', sha), 'Invalid SHA')
    run_id, attempt = int(run_text), int(attempt_text)
    if check_only:
        recheck(Path(destination), sha, run_id, attempt)
        return
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
    files = {}
    for name in FILES:
        with local_file(Path(destination), name) as stream:
            files[name] = file_hash(stream)
    with (Path(destination) / RECEIPT).open('x', encoding='utf-8') as stream:
        json.dump(dict(sha=sha, run_id=run_id, attempt=attempt, artifact=artifact, files=files), stream)
    print(json.dumps({'artifact_id': artifact['id'], 'digest': artifact['digest'], 'run_id': run_id, 'attempt': attempt}))

if __name__ == '__main__':
    main()
