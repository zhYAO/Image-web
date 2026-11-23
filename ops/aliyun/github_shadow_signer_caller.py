"""Read-only policy caller. Transport is injected and must be one-hop no-auth HTTPS redirect."""
import re
from github_shadow_signer_intake import REPO, REPO_ID, require, read_report


def statement(get, get_zip, *, ids, expected, workflow_id, stage_job_name):
    sha, run, attempt = (expected[k] for k in ('sourceSHA', 'runId', 'attempt'))
    require(re.fullmatch('[a-f0-9]{40}', sha) and all(type(i) is int and i > 0 for i in (run, attempt)))
    require(set(ids) == {'backend', 'frontend', 'report'} and len(set(ids.values())) == 3
            and all(type(i) is int and i > 0 for i in ids.values()))
    base = '/repos/' + REPO
    path = f'{base}/actions/runs/{run}/attempts/{attempt}'
    metadata, jobs = get(path), get(path+'/jobs?per_page=100')
    require(type(jobs['jobs']) is list and type(jobs['total_count']) is int
            and jobs['total_count'] == len(jobs['jobs']) <= 100)
    outer, digests = {}, {}
    for label, aid in ids.items():
        a = get(f'{base}/actions/artifacts/{aid}')
        w = a['workflow_run']
        name = 'shadow-stage-report' if label == 'report' else 'shadow-rehearsal-'+label
        require(a['id'] == aid and a['name'] == f'{name}-{sha}-{run}-{attempt}'
                and a['expired'] is False and w['id'] == run and w['head_sha'] == sha
                and w['head_branch'] == 'main' and w['repository_id'] == w['head_repository_id'] == REPO_ID
                and re.fullmatch('sha256:[a-f0-9]{64}', a['digest']))
        outer[label], digests[label] = a, a['digest'][7:]
    report = outer['report']
    size = report['size_in_bytes']
    require(type(size) is int and 0 < size <= 65536)
    def main():
        b = get(base+'/branches/main')
        require(b['name'] == 'main' and b['protected'] is True and b['commit']['sha'] == sha)
    main()
    raw = get_zip(f'{base}/actions/artifacts/{ids["report"]}/zip', 65536)
    require(type(raw) is bytes and len(raw) == size)
    value = read_report(archive=raw, artifact=report, run=metadata, jobs=jobs, ids=ids,
                        expected=expected, artifact_sha256=digests['report'], workflow_id=workflow_id,
                        stage_job_name=stage_job_name,
                        measured_artifacts={'backendSha256':digests['backend'],'frontendSha256':digests['frontend']})
    main()
    return value
