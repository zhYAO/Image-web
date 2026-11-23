"""Validate authenticated exact attempt metadata supplied by the trusted caller."""
import json
from pathlib import Path
import sys

WORKFLOW = '.github/workflows/rehearsal-candidates.yml'


def require(ok):
    if not ok:
        raise ValueError('Unverified exact-attempt producer metadata')


def verify(workflow, run, jobs, sha, run_id, attempt, repo_id):
    require(workflow['path'] == run['path'] == WORKFLOW and workflow['id'] == run['workflow_id']
            and workflow['state'] == 'active')
    require(run['id'] == run_id and run['run_attempt'] == attempt and run['head_sha'] == sha
            and run['head_branch'] == 'main' and run['status'] == 'in_progress' and run['event'] == 'push')
    for key in ('repository', 'head_repository'):
        require(run[key]['id'] == repo_id and run[key]['full_name'] == 'zhYAO/Image-web')
    batch = jobs['jobs']
    require(type(batch) is list and jobs['total_count'] == len(batch) and 2 <= len(batch) <= 100)
    ids = set()
    for name in ('backend', 'frontend'):
        found = [j for j in batch if j['name'] == name]
        require(len(found) == 1)
        job = found[0]
        require(type(job['id']) is int and job['id'] > 0 and job['id'] not in ids
                and job['run_id'] == run_id and job['run_attempt'] == attempt and job['head_sha'] == sha
                and job['status'] == 'completed' and job['conclusion'] == 'success')
        ids.add(job['id'])


def read(folder, name):
    with (folder / name).open('rb') as f:
        data = f.read(1_000_001)
    require(0 < len(data) <= 1_000_000)
    return json.loads(data)


if __name__ == '__main__':
    try:
        root, sha, run, attempt, repo = sys.argv[1:]
        verify(*(read(Path(root), n) for n in ('workflow.json', 'run.json', 'jobs.json')),
               sha, int(run), int(attempt), int(repo))
    except (ValueError, KeyError, TypeError, OSError):
        sys.exit('Unverified exact-attempt producer metadata')
