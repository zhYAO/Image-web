"""Run the one fixed SSH publication command using a pinned ECS host key."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from github_hosted_stage_shadow import _unique
from github_pair_handoff import COMMAND, COMMIT, file_sha, send

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


def publish(request, receipt, *, host, known_hosts, key, rollback):
    # Freeze the bounded stream before attempting the one remote operation.
    # An uncertain SSH exit requires reading status, never automatic replay.
    if not COMMIT.fullmatch(rollback):
        raise ValueError('Exact approved rollback SHA required before publication')
    with tempfile.TemporaryFile() as packet, tempfile.TemporaryFile() as result:
        send(request, packet)
        packet.seek(0)
        with invocation(host, known_hosts, key) as argv:
            proc = subprocess.run(argv, stdin=packet, stdout=result, stderr=subprocess.DEVNULL,
                                  env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, timeout=900, check=False)
        result.seek(0)
        body = result.read(16385)
    if proc.returncode:
        raise ValueError('ECS publication returned no bounded successful receipt; inspect status before retry')
    validate_receipt(body, request, rollback)
    write_private(receipt, body)
    return hashlib.sha256(body).hexdigest()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('One local handoff directory and receipt path required')
        secret = os.environ.pop('ZIMAGE_PAIR_SSH_KEY')
        digest = publish(Path(sys.argv[1]), Path(sys.argv[2]), host=os.environ['ZIMAGE_PAIR_SSH_HOST'],
                         known_hosts=os.environ['ZIMAGE_PAIR_SSH_KNOWN_HOSTS'], key=secret,
                         rollback=os.environ['ZIMAGE_PAIR_ROLLBACK_SHA'])
        print(digest)
    except (KeyError, TypeError, OSError, ValueError, subprocess.TimeoutExpired):
        sys.exit('Pair publication refused or returned uncertain status')
