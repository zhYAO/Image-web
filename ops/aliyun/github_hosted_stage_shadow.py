"""Offline fail-closed comparison only. No network, signature checks, or promotion."""
import hashlib
import json
import re

FIELDS = {
    'repository', 'repositoryId', 'sourceRef', 'sourceSHA', 'event',
    'workflow', 'signerWorkflow', 'signerSHA', 'runId', 'attempt',
    'backendSha256', 'frontendSha256', 'baselineSHA', 'migrationLedgerSha256',
}
JOBS_REQUIRED = ('isolated-stage', 'attest-stage')
INT_FIELDS = {'repositoryId', 'runId', 'attempt'}
MAX_AGE = 7200
PREDICATE = "https://slsa.dev/provenance/v1"
KIND = "protected-main-stage-shadow"


def _require(ok):
    if not ok:
        raise ValueError("Hosted stage shadow evidence rejected")


def _unique(pairs):
    record = dict(pairs)
    _require(len(record) == len(pairs))
    return record


def shadow(payload, *, expected, verified_subject_sha256, verified_certificate, verified_predicate_type, jobs, run_started_at,
           now, seen):
    """Verified digest MUST come from external pinned gh verifier, not the statement.

    expected and jobs MUST come from server policy + independent GitHub run/attempt
    API reads; jobs are normalized as name/runId/attempt/status/conclusion.
    Pass observed run-attempt start epoch seconds, not a runner-supplied timestamp.
    seen represents durable replay records; this function does not consume replay.
    """
    _require(type(payload) is bytes and 0 < len(payload) <= 4096)
    _require(type(verified_subject_sha256) is str and
             hashlib.sha256(payload).hexdigest() == verified_subject_sha256)
    # All three verified values must be extracted from the SAME gh verification result.
    _require(verified_predicate_type == PREDICATE)
    _require(type(verified_certificate) is dict)
    stmt = json.loads(payload.decode('utf-8'), object_pairs_hook=_unique)
    _require(type(stmt) is dict and set(stmt) == FIELDS | {'schemaVersion', 'kind', 'productionReady'})
    _require(type(stmt['schemaVersion']) is int and stmt['schemaVersion'] == 1)
    _require(stmt['kind'] == KIND and stmt['productionReady'] is False)
    _require(type(expected) is dict and set(expected) == FIELDS)
    for name in FIELDS:
        value = stmt[name]
        if name in INT_FIELDS:
            _require(type(value) is int and 0 < value < 2**63)
        else:
            _require(type(value) is str and 0 < len(value) <= 256)
            if name.endswith('SHA') or name.endswith('Sha256'):
                size = 40 if name.endswith('SHA') else 64
                _require(re.fullmatch('[a-f0-9]{%d}' % size, value))
        _require(type(expected[name]) is type(value) and expected[name] == value)
    _require(stmt['sourceRef'] == 'refs/heads/main' and stmt['event'] == 'push')
    repo, run, attempt = (expected[k] for k in ('repository', 'runId', 'attempt'))
    invocation = f'https://github.com/{repo}/actions/runs/{run}/attempts/{attempt}'
    _require(verified_certificate.get('runInvocationURI') == invocation)
    _require(type(now) is type(run_started_at) is int and
             0 <= now - run_started_at <= MAX_AGE)
    _require(type(jobs) is list and all(type(job) is dict for job in jobs))
    for name in JOBS_REQUIRED:
        matches = [job for job in jobs if job.get('name') == name]
        _require(len(matches) == 1)
        job = matches[0]
        for key in ('runId', 'attempt'):
            _require(type(job.get(key)) is int and job[key] == stmt[key])
        _require(job.get('status') == 'completed' and job.get('conclusion') == 'success')
    replay_key = (stmt['repositoryId'], stmt['runId'], stmt['attempt'])
    _require(replay_key not in seen)
    return {'shadowVerified': True, 'productionReady': False, 'replayKey': replay_key}


def from_gh(result, *, payload, subject_path, expected):
    """Adapt a trusted subprocess result, not a deserialized process object.

    Caller runs a trusted, pinned gh binary with sanitized environment and the
    exact argv below. Independently obtain expected from server policy/API.
    The binary path (argv[0]) is selected and trusted by the caller.
    """
    _require(type(result.returncode) is int and result.returncode == 0)
    _require(type(result.args) in (list, tuple) and len(result.args) > 1)
    _require(all(type(expected.get(key)) is str and expected[key] for key in
                 ('repository', 'signerWorkflow', 'signerSHA', 'sourceRef', 'sourceSHA')))
    _require(expected['sourceRef'] == 'refs/heads/main')
    _require(list(result.args[1:]) == [
        'attestation', 'verify', str(subject_path), '--repo', expected['repository'],
        '--signer-workflow', expected['signerWorkflow'], '--signer-digest', expected['signerSHA'],
        '--source-ref', expected['sourceRef'], '--source-digest', expected['sourceSHA'],
        '--deny-self-hosted-runners', '--predicate-type', PREDICATE, '--format', 'json',
    ])
    verified = verified_subject(result.stdout, payload=payload, expected=expected, predicate=PREDICATE)
    # This is the attested FILE, not gh's workflow-controlled provenance predicate.
    content = json.loads(payload, object_pairs_hook=_unique)
    _require(type(content) is dict and set(content) == FIELDS | {'schemaVersion', 'kind', 'productionReady'})
    _require(type(content['schemaVersion']) is int and content['schemaVersion'] == 1
             and content['kind'] == KIND and content['productionReady'] is False)
    return verified


def verified_subject(stdout, *, payload, expected, predicate):
    """Check the verified file digest and invocation from an authenticated gh process."""
    _require(type(payload) is bytes and 0 < len(payload) <= 4096)
    _require(type(stdout) in (bytes, str) and 0 < len(stdout) <= 1024 * 1024)
    rows = json.loads(stdout, object_pairs_hook=_unique)
    _require(type(rows) is list and len(rows) == 1 and type(rows[0]) is dict)
    verification = rows[0].get('verificationResult')
    _require(type(verification) is dict)
    statement, signature = verification.get('statement'), verification.get('signature')
    _require(type(statement) is dict and type(signature) is dict)
    _require(statement.get('_type') == 'https://in-toto.io/Statement/v1'
             and statement.get('predicateType') == predicate and type(statement.get('predicate')) is dict)
    subjects = statement.get('subject')
    _require(type(subjects) is list and len(subjects) == 1 and type(subjects[0]) is dict)
    digest = hashlib.sha256(payload).hexdigest()
    _require(subjects[0].get('digest') == {'sha256': digest})
    certificate = signature.get('certificate')
    _require(type(certificate) is dict)
    invocation = 'https://github.com/{repository}/actions/runs/{runId}/attempts/{attempt}'.format(**expected)
    _require(certificate.get('runInvocationURI') == invocation)
    return dict(verified_subject_sha256=digest, verified_certificate=certificate,
                verified_predicate_type=predicate)
