"""Pure independently signed head observation checks for the shadow wire."""
import hashlib
import json
import re

from github_hosted_stage_shadow import FIELDS, JOBS_REQUIRED, PREDICATE, _require, _unique

KIND = 'protected-main-head-observation'
MAX_AGE = 120
RELEASE = FIELDS - {'signerWorkflow', 'signerSHA'}
PAIR_SOURCES = ('rollbackBackendSHA', 'rollbackFrontendSHA')
PAIR_PINS = ('rollbackBackendManifestSha256', 'rollbackFrontendArtifactSha256',
             'rollbackFrontendConfigFingerprint')
EXTRA = {'schemaVersion', 'kind', 'productionReady', 'protected', 'observedAt',
         'expiresAt', 'runStartedAt', 'jobs', 'node', 'nonce', 'generation',
         'callerWorkflowId'} | set(PAIR_SOURCES) | set(PAIR_PINS)


def observation(payload, *, verified, policy, expected, local, now, seen):
    """Adapt to wire observe callback only after separate cryptographic verification.

    verified is a single verified subject/certificate/predicate result, not runner
    JSON. policy pins the independent signer and its GitHub caller repo/workflow.
    expected is the locally measured pair and approved stage identity. local
    is the trusted current replacement challenge/control snapshot; no writes.
    """
    _require(type(payload) is bytes and 0 < len(payload) <= 16384)
    _require(verified['verified_subject_sha256'] == hashlib.sha256(payload).hexdigest()
             and verified['verified_predicate_type'] == PREDICATE)
    cert = verified['verified_certificate']
    _require(policy['stageSignerWorkflow'] == expected['signerWorkflow']
             and policy['stageSignerSHA'] == expected['signerSHA']
             and policy['observerSignerURI'] != policy['stageSignerURI']
             and policy['observerSignerSHA'] != policy['stageSignerSHA'])
    for typ, key in (
        ('sourceRepositoryIdentifier', 'observerRepositoryId'),
        ('sourceRepositoryURI', 'observerRepositoryURI'),
        ('sourceRepositoryRef', 'observerSourceRef'),
        ('buildConfigURI', 'observerCallerURI'),
        ('buildConfigDigest', 'observerCallerSHA'),
        ('buildSignerURI', 'observerSignerURI'),
        ('buildSignerDigest', 'observerSignerSHA'),
    ):
        _require(type(policy[key]) is str and policy[key] and cert.get(typ) == policy[key])
    _require(cert.get('issuer') == 'https://token.actions.githubusercontent.com'
             and cert.get('runnerEnvironment') == 'github-hosted')
    invocation = cert.get('runInvocationURI')
    _require(type(invocation) is str and re.fullmatch(
        re.escape(policy['observerRepositoryURI']) + r'/actions/runs/[1-9][0-9]*/attempts/[1-9][0-9]*',
        invocation))
    source = json.loads(payload, object_pairs_hook=_unique)
    _require(type(source) is dict and set(source) == RELEASE | EXTRA
             and type(source['schemaVersion']) is int and source['schemaVersion'] == 1
             and source['kind'] == KIND and source['protected'] is True and source['productionReady'] is False)
    _require(set(expected) == FIELDS and expected['repository'] == 'zhYAO/Image-web'
             and expected['sourceRef'] == 'refs/heads/main' and expected['event'] == 'push')
    for k in RELEASE:
        _require(type(source[k]) is type(expected[k]) and source[k] == expected[k])
    _require(type(source['callerWorkflowId']) is int and source['callerWorkflowId'] == policy['stageCallerWorkflowId'])
    for k in ('node', 'nonce', 'generation', *PAIR_SOURCES, *PAIR_PINS):
        _require(type(source[k]) is type(local[k]) and source[k] == local[k])
    _require(type(source['node']) is str and re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,63}', source['node'])
             and type(source['nonce']) is str and re.fullmatch(r'[a-f0-9]{64}', source['nonce'])
             and all(type(source[k]) is str and re.fullmatch(r'[a-f0-9]{40}', source[k])
                     for k in PAIR_SOURCES)
             and all(type(source[k]) is str and re.fullmatch(r'[a-f0-9]{64}', source[k])
                     for k in PAIR_PINS))
    generation = source['generation']
    _require(type(generation) is type(local['highestSeenGeneration']) is int
             and generation > local['highestSeenGeneration'] >= 0)
    started, observed, expiry, issued, challenge_expiry = (
        source['runStartedAt'], source['observedAt'], source['expiresAt'],
        local['challengeIssuedAt'], local['challengeExpiresAt'])
    _require(all(type(t) is int and t > 0 for t in (now, started, observed, expiry, issued, challenge_expiry))
             and started <= observed and issued <= observed <= now < expiry <= challenge_expiry
             and now - observed <= MAX_AGE and 0 < expiry - observed <= MAX_AGE)
    replay = (expected['repositoryId'], expected['runId'], expected['attempt'])
    _require(replay not in seen)
    # Exact qualified names are checked against policy, then normalized for v2.
    jobs = source['jobs']
    _require(type(jobs) is list and len(jobs) == len(JOBS_REQUIRED))
    normalized = []
    for name in JOBS_REQUIRED:
        actual = policy['stageJobNames'][name]
        matches = [job for job in jobs if type(job) is dict and job.get('name') == actual]
        _require(len(matches) == 1 and len(set(policy['stageJobNames'].values())) == len(JOBS_REQUIRED))
        job = matches[0]
        _require(job == dict(name=actual, runId=expected['runId'], attempt=expected['attempt'],
                             status='completed', conclusion='success')
                 and type(job['runId']) is type(job['attempt']) is int)
        normalized.append(dict(job, name=name))
    return dict(expected=expected, jobs=normalized, run_started_at=started, now=now, seen=seen)
