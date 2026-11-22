"""Build an unsigned canonical observation from trusted observations, not caller claims."""
import json
import re

from github_hosted_stage_shadow import _require
from github_shadow_head import KIND, MAX_AGE, PAIR_PINS, PAIR_SOURCES, RELEASE
from github_shadow_pins import pins


def build(*, policy, measured, run, jobs, challenge, observe_main, clock):
    """Only trusted bootstrap supplies callbacks and typed evidence.

    measured contains independently hashed eligible packages and admitted exact
    run/attempt/source, not dispatch input by itself. run/jobs are fetched from
    the exact GitHub attempt using trusted transport. challenge must already be
    authenticated as the addressed host's current no-secrets challenge.
    """
    _require(set(measured) == {'runId', 'attempt', 'sourceSHA', 'backendSha256', 'frontendSha256'})
    keys = ('node', 'nonce', 'generation', *PAIR_SOURCES, *PAIR_PINS)
    _require(set(challenge) == set(keys) | {'challengeIssuedAt', 'challengeExpiresAt'})
    for name, pattern in [('node', r'[a-z0-9][a-z0-9.-]{0,63}'), ('nonce', r'[a-f0-9]{64}'),
                          *((k, r'[a-f0-9]{40}') for k in PAIR_SOURCES),
                          *((k, r'[a-f0-9]{64}') for k in PAIR_PINS)]:
        _require(type(challenge[name]) is str and re.fullmatch(pattern, challenge[name]))
    gen, issued, deadline = (challenge[k] for k in ('generation', 'challengeIssuedAt', 'challengeExpiresAt'))
    _require(all(type(n) is int and n > 0 for n in (gen, issued, deadline)) and issued < deadline)
    pinned = pins(policy=policy, release=measured, run=run, jobs=jobs)
    expected = pinned['expected']
    before = clock()
    _require(type(before) is int and max(issued, pinned['run_started_at']) <= before < deadline)
    snapshot = observe_main()  # fixed trusted endpoint; receives no caller-controlled locator
    after = clock()
    _require(type(after) is int and before <= after < min(deadline, before + MAX_AGE)
             and snapshot['name'] == 'main' and snapshot['protected'] is True
             and snapshot['commit']['sha'] == expected['sourceSHA'])
    # Use pre-fetch clock conservatively; time spent fetching reduces usable TTL.
    claim = {k: expected[k] for k in RELEASE}
    claim.update({k: challenge[k] for k in keys})
    claim.update(schemaVersion=1, kind=KIND, productionReady=False, protected=True,
                 observedAt=after, expiresAt=min(deadline, before + MAX_AGE),
                 runStartedAt=pinned['run_started_at'], callerWorkflowId=policy['workflowId'],
                 jobs=[dict(job, name=policy['jobNames'][job['name']]) for job in pinned['jobs']])
    return (json.dumps(claim, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
