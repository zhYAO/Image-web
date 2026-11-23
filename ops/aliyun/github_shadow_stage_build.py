"""Build unsigned stage bytes in a trusted signer job, never from diagnostic output."""
import json
import re

from github_hosted_stage_shadow import FIELDS, KIND, _require, _unique

REPORT_KIND = 'protected-main-isolated-stage'
CHECKS = {'browserAuth', 'noM7', 'denyExternalEgress', 'reconstructedPairRecovery'}
IDS = {'repository', 'repositoryId', 'sourceRef', 'sourceSHA', 'event', 'workflow',
       'runId', 'attempt', 'baselineSHA', 'migrationLedgerSha256'}
ARTIFACTS = {'backendSha256', 'frontendSha256'}


def build(report, *, trusted_context, measured_artifacts):
    """trusted_context comes from signer policy + GitHub, not the report.

    measured_artifacts must be SHA-256 of exact, independently fetched and
    validated protected-workflow artifact bytes. The report must itself come
    from the completed isolated-stage job via a trusted job-bound channel;
    passing arbitrary artifact metadata here does not establish that channel.
    """
    _require(type(report) is bytes and 0 < len(report) <= 8192)
    _require(type(trusted_context) is dict and set(trusted_context) == FIELDS - ARTIFACTS)
    _require(type(measured_artifacts) is dict and set(measured_artifacts) == ARTIFACTS)
    context = dict(trusted_context, **measured_artifacts)
    _require(context['repository'] == 'zhYAO/Image-web' and context['sourceRef'] == 'refs/heads/main'
             and context['event'] == 'push')
    for key, value in context.items():
        if key in {'repositoryId', 'runId', 'attempt'}:
            _require(type(value) is int and value > 0)
        else:
            _require(type(value) is str and 0 < len(value) <= 256)
            if key.endswith(('SHA', 'Sha256')):
                _require(re.fullmatch('[a-f0-9]{%d}' % (40 if key.endswith('SHA') else 64), value))
    record = json.loads(report, object_pairs_hook=_unique)
    _require(type(record) is dict and set(record) == IDS | ARTIFACTS | {
        'schemaVersion', 'kind', 'productionReady', 'checks'})
    _require(type(record['schemaVersion']) is int and record['schemaVersion'] == 1
             and record['kind'] == REPORT_KIND and record['productionReady'] is False)
    for key in IDS | ARTIFACTS:
        _require(type(record[key]) is type(context[key]) and record[key] == context[key])
    _require(type(record['checks']) is dict and set(record['checks']) == CHECKS
             and all(record['checks'][key] is True for key in CHECKS))
    statement = dict(context, schemaVersion=1, kind=KIND, productionReady=False)
    return (json.dumps(statement, sort_keys=True, separators=(',', ':')) + '\n').encode()
