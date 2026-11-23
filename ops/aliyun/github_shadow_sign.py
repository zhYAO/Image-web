"""Build the exact attestation subject in the isolated GitHub signer job."""
import os
from pathlib import Path
import re
import sys

from github_shadow_measure_report import BASELINE, LEDGER
from github_shadow_signer_caller import statement
from github_shadow_signer_intake import REPO, REPO_ID, WORKFLOW, require
from github_shadow_signer_transport import N, Transport

SIGNER_WORKFLOW = REPO + '/.github/workflows/attest-stage.yml'


def number(value):
    require(re.fullmatch(N, value))
    return int(value)


def prepare(env, transport=Transport):
    require(env['GITHUB_REPOSITORY'] == REPO and number(env['GITHUB_REPOSITORY_ID']) == REPO_ID
            and env['GITHUB_EVENT_NAME'] == 'push' and env['GITHUB_REF'] == 'refs/heads/main'
            and env['GITHUB_REF_PROTECTED'] == 'true' and env['RUNNER_ENVIRONMENT'] == 'github-hosted'
            and env['GITHUB_WORKFLOW_REF'] == REPO + '/' + WORKFLOW + '@refs/heads/main'
            and env['GITHUB_WORKFLOW_SHA'] == env['GITHUB_SHA'])
    run, attempt = (number(env[k]) for k in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
    ids = {key: number(env[key.upper() + '_ID']) for key in ('backend', 'frontend', 'report')}
    signer = env['SIGNER_SHA']
    require(re.fullmatch('[0-9a-f]{40}', signer))
    expected = dict(repository=REPO, repositoryId=REPO_ID, sourceRef='refs/heads/main',
                    sourceSHA=env['GITHUB_SHA'], event='push', workflow=WORKFLOW,
                    signerWorkflow=SIGNER_WORKFLOW, signerSHA=signer, runId=run, attempt=attempt,
                    baselineSHA=BASELINE, migrationLedgerSha256=LEDGER)
    api = transport(token=env['GH_TOKEN'], run=run, attempt=attempt, ids=ids,
                    object_hosts=frozenset(env['OBJECT_HOSTS'].split()))
    workflow = api.get('/repos/' + REPO + '/actions/workflows/rehearsal-candidates.yml')
    require(workflow['path'] == WORKFLOW and workflow['state'] == 'active'
            and type(workflow['id']) is int and workflow['id'] > 0)
    return statement(api.get, api.download_report, ids=ids, expected=expected,
                     workflow_id=workflow['id'], stage_job_name='hosted-shadow')


def main():
    subject = prepare(os.environ)
    directory = Path(os.environ['RUNNER_TEMP']) / 'zimage-attestation'
    directory.mkdir(mode=0o700)
    with (directory / 'stage.json').open('xb') as stream:
        stream.write(subject)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception:
        sys.exit('Protected stage attestation refused before signing')
