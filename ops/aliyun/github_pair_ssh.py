"""Run the one fixed SSH publication command using a pinned ECS host key."""
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

from github_hosted_stage_shadow import _unique
from github_pair_handoff import (COMMAND, COMMIT, REPO, WORKFLOW, file_sha, rollback_pair, send,
                                 send_restoration, validate_restoration)
from github_pair_public import validate_failure
import ordinary_public_exchange as observer

SSH = '/usr/bin/ssh'
USER = 'zimage-release'
HOST = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?')
SHA = re.compile('[a-f0-9]{64}')
OPERATION = re.compile('[A-Za-z0-9][A-Za-z0-9._-]{6,79}')
RECEIPT_FIELDS = {'schemaVersion', 'kind', 'status', 'operationId', 'commit', 'runId', 'attempt',
                  'backendRelease', 'frontendRelease', 'backendManifestSha256', 'frontendSubjectSha256',
                  'stageSha256', 'rootApprovalSha256', 'rollbackPair', 'rollbackAcceptanceSha256'}


def write_private(path, body):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(body)


@contextmanager
def invocation(host, known_hosts, key):
    if not HOST.fullmatch(host) or len(known_hosts) > 1024 or not re.fullmatch(
            re.escape(host) + r' ssh-ed25519 [A-Za-z0-9+/]{68}\n?', known_hosts):
        raise ValueError('Exact ECS host key required')
    if not 0 < len(key) <= 8192 or not key.startswith('-----BEGIN OPENSSH PRIVATE KEY-----\n'):
        raise ValueError('Dedicated OpenSSH publication key required')
    with tempfile.TemporaryDirectory(prefix='zimage-publish-key-') as tmp:
        keys = Path(tmp)
        write_private(keys / 'known_hosts', (known_hosts.rstrip('\n') + '\n').encode('ascii'))
        write_private(keys / 'identity', (key.rstrip('\n') + '\n').encode('ascii'))
        yield [SSH, '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
               '-o', 'IdentityAgent=none', '-o', 'ClearAllForwardings=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UserKnownHostsFile=' + str(keys / 'known_hosts'),
               '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15',
               '-o', 'ServerAliveCountMax=2', '-i', str(keys / 'identity'), f'{USER}@{host}', COMMAND]


def validate_receipt(body, request, rollback):
    if not 0 < len(body) <= 16384:
        raise ValueError('Exact ECS publication receipt required')
    receipt = json.loads(body, object_pairs_hook=_unique)
    pins = json.loads((request / 'pins.json').read_bytes(), object_pairs_hook=_unique)
    commit = pins['commit']
    if not COMMIT.fullmatch(commit) or not COMMIT.fullmatch(rollback) or rollback == commit:
        raise ValueError('Exact distinct production and rollback releases required')
    expected = dict(schemaVersion=1, kind='zimage-ordinary-pair-v1', status='opened',
                    commit=commit, runId=pins['runId'], attempt=pins['attempt'], backendRelease=commit,
                    frontendRelease='release-' + commit[:12], stageSha256=file_sha(request / 'stage.json'),
                    backendManifestSha256=pins['backend']['manifestSha256'],
                    frontendSubjectSha256=pins['frontend']['subjectSha256'],
                    rollbackPair=dict(backend=rollback, frontend='release-' + rollback[:12]))
    if (type(receipt) is not dict or set(receipt) != RECEIPT_FIELDS
            or not all(type(receipt[k]) is type(value) and receipt[k] == value for k, value in expected.items())
            or not OPERATION.fullmatch(receipt['operationId'])
            or not all(SHA.fullmatch(receipt[k]) for k in ('rootApprovalSha256', 'rollbackAcceptanceSha256'))):
        raise ValueError('ECS receipt does not attest this opened pair and rollback target')
    return receipt


def read_bounded(path, limit):
    with path.open('rb') as stream:
        body = stream.read(limit + 1)
    if not 0 < len(body) <= limit:
        raise ValueError('Bounded local evidence required')
    return body


def measured_rollback(request, public_baseline):
    body = read_bounded(public_baseline, 4096)
    baseline = json.loads(body, object_pairs_hook=_unique)
    pins = json.loads((request / 'pins.json').read_bytes(), object_pairs_hook=_unique)
    if baseline['schemaVersion'] != 1 or baseline['health'] != 'ok':
        raise ValueError('Healthy public rollback evidence required')
    return rollback_pair(dict(backend=baseline['backendRelease'], frontend=baseline['frontendRelease']), pins['commit'])


def exchange(frame, payload, *, host, known_hosts, key):
    # Freeze one frame before calling the fixed endpoint. An uncertain exit
    # requires reconciliation through status before any further request.
    with tempfile.TemporaryFile() as packet, tempfile.TemporaryFile() as result:
        frame(payload, packet)
        packet.seek(0)
        with invocation(host, known_hosts, key) as argv:
            proc = subprocess.run(argv, stdin=packet, stdout=result, stderr=subprocess.DEVNULL,
                                  env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, timeout=900, check=False)
        result.seek(0)
        body = result.read(16385)
    if proc.returncode:
        raise ValueError('ECS did not return a successful receipt; inspect status before any further request')
    if not 0 < len(body) <= 16384:
        raise ValueError('Exact ECS receipt required')
    return body


def publish(request, receipt, *, host, known_hosts, key, public_baseline):
    rollback = measured_rollback(request, public_baseline)
    write_private(request / 'rollback.json', json.dumps(rollback, sort_keys=True).encode())
    body = exchange(send, request, host=host, known_hosts=known_hosts, key=key)
    validate_receipt(body, request, rollback['backend'])
    write_private(receipt, body)
    return hashlib.sha256(body).hexdigest()


def observe_restoration(frames, *, selector, rollback, sign, fetch):
    packet = selector['packet']
    expected = {k: packet[k] for k in ('commit', 'runId', 'attempt')}
    expected.update(rollbackPair=rollback, rootApprovalSha256=selector['approvalSha256'],
                    packetSha256=hashlib.sha256(observer.encode(packet) + b'\n').hexdigest())
    failed = None
    proofs = {}
    for phase in ('candidate', 'restored'):
        challenge = frames.read(observer.MAX_SUBJECT)
        observer.validate(challenge, int(time.time()))
        if (challenge['phase'] != phase or any(challenge[name] != value for name, value in expected.items())
                or (failed is not None and (challenge['nonce'] == failed['nonce']
                                            or challenge['snapshotSha256'] == failed['snapshotSha256']))):
            raise ValueError('Public challenge differs from the exact restoration session')
        measured = observer.observe(challenge, fetch=fetch)
        if phase == 'candidate':
            validate_failure(measured['public'], observer.target(challenge))
            failed = challenge
        subject = observer.encode(measured)
        deadline = min(frames.deadline, time.monotonic() + challenge['expiresAt'] - time.time())
        bundle = sign(subject, deadline=deadline)
        observer.validate(challenge, int(time.time()))
        response = observer.reply(measured, bundle)
        frames.write(response, observer.MAX_REPLY)
        name = 'publicFailureSha256' if phase == 'candidate' else 'publicRestorationSha256'
        proofs[name] = hashlib.sha256(observer.encode(response) + b'\n').hexdigest()
    receipt = frames.read(16384)
    if type(receipt) is not dict or any(receipt.get(name) != digest for name, digest in proofs.items()):
        raise ValueError('Restoration receipt differs from the signed observations')
    return observer.encode(receipt)


def exchange_restore(selector, *, rollback, sign, fetch, host, known_hosts, key):
    with invocation(host, known_hosts, key) as argv, subprocess.Popen(
            argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0,
            env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}) as peer:
        frames = observer.Frames(peer.stdout.fileno(), peer.stdin.fileno(), deadline=time.monotonic() + 900)
        try:
            request = io.BytesIO()
            send_restoration(selector, request, interactive=True)
            frames.write_bytes(request.getvalue())
            body = observe_restoration(frames, selector=selector, rollback=rollback, sign=sign, fetch=fetch)
            peer.stdin.close()
            if peer.wait(timeout=5):
                raise ValueError('Interactive ECS restoration did not return an exact successful receipt')
            frames.assert_eof()
            return body
        finally:
            if peer.poll() is None:
                peer.kill()


def request_restore(request, deployment, failure, receipt, *, host, known_hosts, key, public_baseline,
                    sign_observation=None, fetch_observation=observer.public.request):
    rollback = measured_rollback(request, public_baseline)
    deployed_bytes = read_bounded(deployment, 16384)
    released = validate_receipt(deployed_bytes, request, rollback['backend'])
    failure_hint = json.loads(read_bounded(failure, 16384), object_pairs_hook=_unique)
    # This local hint identifies a failed verification session. The receiver
    # independently validates its own failure evidence before any mutation.
    expected = dict(schemaVersion=1, operationId=released['operationId'], candidate=released['commit'],
                    rollbackTarget=rollback, recoveryVerified=False,
                    deploymentReceiptSha256=hashlib.sha256(deployed_bytes).hexdigest())
    if (type(failure_hint) is not dict or set(failure_hint) != expected.keys() | {'publicRollbackObservation',
                                                                              'publicContractFailure'}
            or any(type(failure_hint[key]) is not type(value) or failure_hint[key] != value
                   for key, value in expected.items())):
        raise ValueError('Public failure observation does not identify the original release')
    validate_failure(failure_hint['publicContractFailure'], dict(backend=released['backendRelease'],
                                                              frontend=released['frontendRelease']))
    packet = {name: released[name] for name in ('commit', 'runId', 'attempt', 'backendManifestSha256',
                                               'frontendSubjectSha256')}
    packet.update(repository=REPO, workflow=WORKFLOW)
    selector = dict(packet=packet, approvalSha256=released['rootApprovalSha256'])
    if sign_observation is None:
        body = exchange(send_restoration, selector, host=host, known_hosts=known_hosts, key=key)
    else:
        body = exchange_restore(selector, rollback=rollback, sign=sign_observation, fetch=fetch_observation,
                                host=host, known_hosts=known_hosts, key=key)
    validate_restoration(json.loads(body, object_pairs_hook=_unique), released)
    write_private(receipt, body)
    return hashlib.sha256(body).hexdigest()


if __name__ == '__main__':
    try:
        connection = dict(host=os.environ['ZIMAGE_PAIR_SSH_HOST'], known_hosts=os.environ['ZIMAGE_PAIR_SSH_KNOWN_HOSTS'],
                          key=os.environ.pop('ZIMAGE_PAIR_SSH_KEY'))
        if len(sys.argv) == 7 and sys.argv[1] == '--restore':
            request, deployment, failure, receipt, baseline = map(Path, sys.argv[2:])
            digest = request_restore(request, deployment, failure, receipt, public_baseline=baseline, **connection)
        elif len(sys.argv) == 4:
            request, receipt, baseline = map(Path, sys.argv[1:])
            digest = publish(request, receipt, public_baseline=baseline, **connection)
        else:
            raise ValueError('Fixed publication or restoration invocation required')
        print(digest)
    except (KeyError, TypeError, OSError, ValueError, subprocess.TimeoutExpired):
        sys.exit('Pair operation refused or returned uncertain status')
