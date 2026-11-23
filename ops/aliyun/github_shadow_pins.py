"""Derive independent shadow pins from trusted policy and GitHub REST snapshots.

No network, disk I/O, privilege or dispatch. The caller must fetch REST data
using trusted GitHub transport; never load these objects from release artifacts.
Current deployed host lacks reviewed gh, so no host CLI fallback is provided.
"""
from datetime import datetime
import re


def require(value):
    if not value:
        raise ValueError("Independent GitHub shadow policy rejected")


def pins(*, policy, release, run, jobs, publishing=False):
    """release is locally measured digests + admitted SHA, never statement data."""
    repo = 'zhYAO/Image-web'
    require(type(policy['repositoryId']) is type(policy['workflowId']) is int
            and policy['repositoryId'] > 0 and policy['workflowId'] > 0)
    require(type(release['runId']) is type(release['attempt']) is int
            and release['runId'] > 0 and release['attempt'] > 0)
    for source, fields, size in (
        (release, ('sourceSHA',), 40),
        (policy, ('signerSHA', 'baselineSHA'), 40),
        (release, ('backendSha256', 'frontendSha256'), 64),
        (policy, ('migrationLedgerSha256',), 64),
    ):
        for field in fields:
            require(type(source[field]) is str and re.fullmatch('[a-f0-9]{%d}' % size, source[field]))
    require(re.fullmatch(r'\.github/workflows/[a-zA-Z0-9_-]+\.ya?ml', policy['workflow']))
    require(re.fullmatch(r'[\w.-]+/[\w.-]+/\.github/workflows/[a-zA-Z0-9_-]+\.ya?ml',
                         policy['signerWorkflow']))
    require(run['id'] == release['runId'] and run['run_attempt'] == release['attempt']
            and run['workflow_id'] == policy['workflowId'] and run['path'] == policy['workflow']
            and run['event'] == 'push' and run['head_branch'] == 'main'
            and run['head_sha'] == release['sourceSHA'])
    for source in (run['repository'], run['head_repository']):
        require(source['id'] == policy['repositoryId'] and source['full_name'] == repo)
    if publishing:
        require(run['status'] == 'in_progress' and run['conclusion'] is None)
    else:
        require(run['status'] == 'completed' and run['conclusion'] == 'success')
    started = run['run_started_at']
    require(type(started) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', started))
    epoch = int(datetime.fromisoformat(started[:-1] + '+00:00').timestamp())
    # The exact attempt's authenticated jobs endpoint must be fetched in full.
    require(type(jobs['jobs']) is list and jobs['total_count'] == len(jobs['jobs']))
    normal = []
    for canonical in ('isolated-stage', 'attest-stage'):
        expected_name = policy['jobNames'][canonical]
        require(type(expected_name) is str and expected_name and
                policy['jobNames']['isolated-stage'] != policy['jobNames']['attest-stage'])
        matches = [item for item in jobs['jobs'] if item['name'] == expected_name]
        require(len(matches) == 1)
        j = matches[0]
        require(j['run_id'] == release['runId'] and j['run_attempt'] == release['attempt']
                and j['head_sha'] == release['sourceSHA'] and j['status'] == 'completed'
                and j['conclusion'] == 'success')
        normal.append(dict(name=canonical, runId=j['run_id'], attempt=j['run_attempt'],
                           status=j['status'], conclusion=j['conclusion']))
    expected = dict(repository=repo, sourceRef='refs/heads/main', event='push')
    expected.update({k: policy[k] for k in ('repositoryId', 'workflow', 'signerWorkflow',
                                             'signerSHA', 'baselineSHA', 'migrationLedgerSha256')})
    expected.update({k: release[k] for k in ('sourceSHA', 'runId', 'attempt',
                                              'backendSha256', 'frontendSha256')})
    return dict(expected=expected, jobs=normal, run_started_at=epoch)
