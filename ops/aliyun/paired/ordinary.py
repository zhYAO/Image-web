"""Local kernel for a no-migration pair. No server transport or authority.

An installed counterpart must independently authenticate root approval and
evidence bytes before calling this kernel. The supplied adapter owns the common
deploy lock, fsynced journal, exact snapshots and verified privileged primitives.
An unresolved operation blocks all ordinary, legacy and paired writers.
"""
import hashlib
import hmac
import json
import re

IMAGE = 'zhYAO/Image-web'
WORKFLOW = '.github/workflows/rehearsal-candidates.yml'
PACKET = {'repository', 'workflow', 'commit', 'runId', 'attempt',
          'backendManifestSha256', 'frontendSubjectSha256'}
ROOT_APPROVAL = {'schema', 'operation', 'expiresAt', 'packetSha256',
                 'oldPair', 'newPair', 'databaseSha256',
                 'backendArchiveSha256', 'frontendArchiveSha256', 'frontendManifestSha256',
                 'baselineAcceptanceSha256', 'stagingAcceptanceSha256'}
PAIR = {'backend', 'frontend'}
SNAPSHOT = PAIR | {'databaseSha256', 'sealed'}


def valid(condition, message):
    if not condition:
        raise ValueError(message)


def exact(obj, keys):
    valid(type(obj) is dict and set(obj) == keys, 'Exact record required')


def hexid(value, count=64):
    valid(type(value) is str and re.fullmatch('[0-9a-f]{' + str(count) + '}', value) is not None,
          'Exact digest required')


def canonical(obj):
    return (json.dumps(obj, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def sha(obj):
    return hashlib.sha256(canonical(obj)).hexdigest()


def pair(value):
    exact(value, PAIR)
    hexid(value['backend'], 40)
    valid(value['frontend'] == 'release-' + value['backend'][:12], 'Frontend namespace differs from backend')


def inputs(packet, approval, expected_approval_sha256, now):
    """Trusted operator supplies independent digest of exact canonical approval."""
    exact(packet, PACKET)
    valid(packet['repository'] == IMAGE and packet['workflow'] == WORKFLOW, 'Unexpected candidate producer')
    hexid(packet['commit'], 40)
    for key in ('backendManifestSha256', 'frontendSubjectSha256'):
        hexid(packet[key])
    for key in ('runId', 'attempt'):
        valid(type(packet[key]) is int and 0 < packet[key] < 2**63, 'Exact run and attempt required')
    exact(approval, ROOT_APPROVAL)
    hexid(expected_approval_sha256)
    valid(hmac.compare_digest(sha(approval), expected_approval_sha256), 'Independent root approval digest differs')
    valid(type(approval['schema']) is int and approval['schema'] == 1, 'Unsupported approval schema')
    valid(type(approval['operation']) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{6,79}', approval['operation']) is not None,
          'Invalid operation')
    expiry = approval['expiresAt']
    valid(type(now) is int and type(expiry) is int and 0 < now < expiry <= now + 86400, 'Expired or unbounded authorization')
    for key in ROOT_APPROVAL - {'schema', 'operation', 'expiresAt', 'oldPair', 'newPair'}:
        hexid(approval[key])
    valid(approval['packetSha256'] == sha(packet), 'Approval and exact candidate packet differ')
    old, new = approval['oldPair'], approval['newPair']
    pair(old)
    pair(new)
    valid(new['backend'] == packet['commit'] and new['backend'] != old['backend'] and new['frontend'] != old['frontend'],
          'Not an exact new production pair')
    valid(approval['baselineAcceptanceSha256'] != approval['stagingAcceptanceSha256'],
          'Baseline and staging acceptance must be distinct')


def transition(packet, approval, expected_approval_sha256, ops, *, clock):
    """Run one ordinary no-DDL release, under a single shared deployment lock.

    Interface: lock() context, assert_clear(operation)/journal(event) durable operation record,
    verify_inputs(packet,approval) for immutable artifacts plus independent
    baseline/live and staging checks, assert_main(commit) from trusted provenance,
    snapshot() for current pair/protected DB contract and seal truth,
    seal_and_drain(), select_backend(packet,approval), select_frontend(...),
    verify_sealed_pair(...) for candidate PID-bound authentication, open_pair().
    They must throw on undefined state. No recovery by automatic retry.
    """
    with ops.lock():
        # Snapshot all input bytes before any untrusted/mutable adapter interface.
        packet = json.loads(canonical(packet))
        approval = json.loads(canonical(approval))
        inputs(packet, approval, expected_approval_sha256, clock())
        old, new = approval['oldPair'], approval['newPair']
        db = approval['databaseSha256']
        operation = approval['operation']

        def expect(selected, sealed):
            state = ops.snapshot()
            exact(state, SNAPSHOT)
            valid(type(state['sealed']) is bool and state == dict(selected, databaseSha256=db, sealed=sealed),
                  'Unexpected current pair, seal, or database contract')

        def fixed_inputs():
            return json.loads(canonical(packet)), json.loads(canonical(approval))

        def journal(phase):
            ops.journal(dict(operation=operation, rootApprovalSha256=expected_approval_sha256, phase=phase))

        ops.assert_clear(operation)  # Reject unresolved writers and reused ID.
        ops.assert_main(packet['commit'])
        expect(old, False)
        ops.verify_inputs(*fixed_inputs())
        expect(old, False)
        ops.assert_main(packet['commit'])
        inputs(packet, approval, expected_approval_sha256, clock())
        journal('seal-intent')
        ops.seal_and_drain()
        expect(old, True)
        journal('backend-intent')
        ops.select_backend(*fixed_inputs())
        mixed = {'backend': new['backend'], 'frontend': old['frontend']}
        expect(mixed, True)
        journal('frontend-intent')
        ops.select_frontend(*fixed_inputs())
        expect(new, True)
        ops.verify_sealed_pair(*fixed_inputs())
        inputs(packet, approval, expected_approval_sha256, clock())
        ops.assert_main(packet['commit'])
        expect(new, True)
        # If the following call is interrupted or fails, never claim rollback
        # or assume the seal persisted. Reconcile independently under the lock.
        journal('writes-may-open')
        ops.open_pair()
        expect(new, False)
        journal('opened')
        return {'operation': operation, 'phase': 'opened', 'pair': dict(new)}
