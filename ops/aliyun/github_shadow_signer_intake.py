"""Pure intake of independently fetched GitHub report artifact; never signs."""
import hashlib
import io
import re
import stat
import zipfile

from github_shadow_stage_build import build

REPO = 'zhYAO/Image-web'
REPO_ID = 1329578390
WORKFLOW = '.github/workflows/rehearsal-candidates.yml'


def require(condition):
    if not condition:
        raise ValueError('Untrusted stage report artifact')


def read_report(*, archive, artifact, run, jobs, ids, expected, artifact_sha256,
                workflow_id, stage_job_name, measured_artifacts):
    """All metadata except archive is independently read/pinned by trusted caller.

    This helper performs no HTTP or signing. Supported handoff is same-run only;
    caller must fetch real attempt metadata with a read-only token separately.
    """
    require(type(archive) is bytes and 0 < len(archive) <= 65536)
    require(expected['repository'] == REPO and expected['repositoryId'] == REPO_ID
            and expected['workflow'] == WORKFLOW and expected['sourceRef'] == 'refs/heads/main'
            and expected['event'] == 'push')
    sha, rid, attempt = (expected[k] for k in ('sourceSHA', 'runId', 'attempt'))
    require(re.fullmatch('[a-f0-9]{40}', sha) and all(type(n) is int and n > 0 for n in (rid, attempt, workflow_id)))
    require(set(ids) == {'report', 'backend', 'frontend'}
            and all(type(n) is int and n > 0 for n in ids.values()) and len(set(ids.values())) == 3)
    require(run['id'] == rid and run['run_attempt'] == attempt and run['head_sha'] == sha
            and run['event'] == 'push' and run['head_branch'] == 'main' and run['path'] == WORKFLOW
            and run['workflow_id'] == workflow_id and run['status'] == 'in_progress')
    for k in ('repository', 'head_repository'):
        require(run[k]['id'] == REPO_ID and run[k]['full_name'] == REPO)
    require(type(jobs['jobs']) is list and jobs['total_count'] == len(jobs['jobs']) <= 100)
    matched = [j for j in jobs['jobs'] if j['name'] == stage_job_name]
    require(len(matched) == 1)
    j = matched[0]
    require(j['run_id'] == rid and j['run_attempt'] == attempt and j['head_sha'] == sha
            and j['status'] == 'completed' and j['conclusion'] == 'success')
    binding = artifact['workflow_run']
    digest = hashlib.sha256(archive).hexdigest()
    require(digest == artifact_sha256 and artifact['digest'] == 'sha256:' + digest
            and artifact['id'] == ids['report'] and artifact['expired'] is False
            and artifact['name'] == f'shadow-stage-report-{sha}-{rid}-{attempt}'
            and binding['id'] == rid and binding['head_sha'] == sha and binding['head_branch'] == 'main'
            and binding['repository_id'] == REPO_ID and binding['head_repository_id'] == REPO_ID)
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        entries = z.infolist()
        require(len(entries) == 1)
        entry = entries[0]
        mode = (entry.external_attr >> 16) & 0xFFFF
        require(entry.filename == 'stage-report.json' and stat.S_IFMT(mode) in (0, stat.S_IFREG)
                and not entry.flag_bits & 1 and 0 < entry.file_size <= 8192)
        with z.open(entry) as f:
            report = f.read(8193)
            require(len(report) == entry.file_size <= 8192)
    return build(report, trusted_context=expected, measured_artifacts=measured_artifacts)
