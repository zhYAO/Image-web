"""One-shot public observation frames for the paired receiver's SSH streams.

The receiver supplies an already authenticated batch. This module neither
authorizes a release nor observes the database. Only the observer makes HTTPS
requests. The receiver accepts observations after independent attestation.
"""
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import secrets
import select
import struct
import subprocess
import tempfile
import time

import github_pair_public as public
from github_hosted_stage_shadow import _unique
from github_pair_handoff import COMMAND, COMMIT, DIGEST, REPO, rollback_pair


LIFETIME = 120
MAX_SUBJECT = 4096
MAX_BUNDLE = 65536
MAX_REPLY = 90000
LENGTH = struct.Struct('!I')
CHALLENGE = 'zimage-ordinary-public-challenge-v1'
OBSERVATION = 'zimage-ordinary-public-observation-v1'
BATCH = {'commit', 'runId', 'attempt', 'packetSha256', 'rootApprovalSha256', 'rollbackPair', 'snapshotSha256'}
FIELDS = BATCH | {'schemaVersion', 'kind', 'command', 'phase', 'nonce', 'expiresAt'}
SIGNER = '.github/workflows/review-ordinary-public.yml'
PREDICATE = 'https://zimage.store/attestations/rehearsal-public-observation/v1'
REPO_ID = '1329578390'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('ascii')


def decode(body):
    value = json.loads(body, object_pairs_hook=_unique)
    require(body == encode(value), 'Noncanonical observer frame')
    return value


def match(pattern, value):
    return type(value) is str and pattern.fullmatch(value) is not None


def validate(challenge, now):
    require(type(challenge) is dict and challenge.keys() == FIELDS
            and type(challenge['schemaVersion']) is int and challenge['schemaVersion'] == 1
            and challenge['kind'] == CHALLENGE and challenge['command'] == COMMAND
            and challenge['phase'] in ('candidate', 'restored')
            and match(COMMIT, challenge['commit'])
            and all(match(DIGEST, challenge[k]) for k in ('nonce', 'packetSha256', 'rootApprovalSha256', 'snapshotSha256'))
            and all(type(challenge[k]) is int and 0 < challenge[k] < 2**63 for k in ('runId', 'attempt'))
            and type(challenge['expiresAt']) is int and now < challenge['expiresAt'] <= now + LIFETIME,
            'Invalid or expired public observation challenge')
    rollback_pair(challenge['rollbackPair'], challenge['commit'])


class Frames:
    """Bound both directions by one monotonic deadline, including backpressure."""

    def __init__(self, reader, writer, *, deadline):
        self.reader, self.writer, self.deadline = reader, writer, deadline
        os.set_blocking(writer, False)

    def _ready(self, *, write=False):
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, 'Public observer channel timed out')
        readers, writers, _ = select.select([] if write else [self.reader], [self.writer] if write else [], [], remaining)
        require(readers or writers, 'Public observer channel timed out')

    def read_bytes(self, size):
        result = bytearray()
        while len(result) < size:
            self._ready()
            body = os.read(self.reader, size - len(result))
            require(body, 'Truncated observer frame')
            result.extend(body)
        return bytes(result)

    def read(self, cap):
        size, = LENGTH.unpack(self.read_bytes(LENGTH.size))
        require(0 < size <= cap, 'Observer frame exceeds bound')
        return decode(self.read_bytes(size))

    def write(self, value, cap):
        body = encode(value)
        require(0 < len(body) <= cap, 'Observer frame exceeds bound')
        self.write_bytes(LENGTH.pack(len(body)) + body)

    def write_bytes(self, body):
        frame = memoryview(body)
        while frame:
            self._ready(write=True)
            try:
                count = os.write(self.writer, frame[:4096])
            except BlockingIOError:
                continue
            require(count > 0, 'Observer frame write failed')
            frame = frame[count:]

    def assert_eof(self):
        self._ready()
        require(os.read(self.reader, 1) == b'', 'Unframed bytes after observer receipt')


def target(challenge):
    if challenge['phase'] == 'restored':
        return challenge['rollbackPair']
    commit = challenge['commit']
    return dict(backend=commit, frontend='release-' + commit[:12])


def observe(challenge, *, fetch=public.request):
    validate(challenge, int(time.time()))
    commit = target(challenge)['backend']
    try:
        result = public.verify(commit, fetch=fetch)
    except public.ContractFailure as error:
        if challenge['phase'] == 'restored':
            raise
        result = public.failure_witness(commit, error)
    return dict(schemaVersion=1, kind=OBSERVATION, challenge=challenge, public=result)


def verify_subject(subject, challenge):
    require(type(subject) is dict and subject.keys() == {'schemaVersion', 'kind', 'challenge', 'public'}
            and type(subject['schemaVersion']) is int and subject['schemaVersion'] == 1
            and subject['kind'] == OBSERVATION and encode(subject['challenge']) == encode(challenge),
            'Attested observation differs from the exact observer challenge')
    pair = target(challenge)
    evidence = subject['public']
    acceptance = dict(schemaVersion=1, backendRelease=pair['backend'], frontendRelease=pair['frontend'],
                      health='ok', routes=list(public.ROUTES), anonymousSessionStatus=401)
    if encode(evidence) == encode(acceptance):
        return evidence
    require(challenge['phase'] == 'candidate', 'Restored pair must pass HTTPS acceptance')
    public.validate_failure(evidence, pair)
    return evidence


def reply(subject, bundle):
    require(type(bundle) is bytes and 0 < len(bundle) <= MAX_BUNDLE, 'Exact bounded GitHub bundle required')
    return dict(subject=subject, bundle=base64.b64encode(bundle).decode('ascii'))


def receive_observation(frames, *, batch, phase, verify):
    proof = receive_signed_observation(frames, batch=batch, phase=phase, verify=verify)
    return proof['subject']['public']


def receive_signed_observation(frames, *, batch, phase, verify):
    """Finish one live challenge. A new call generates a new unpredictable nonce."""
    require(type(batch) is dict and batch.keys() == BATCH, 'Exact authorized batch required')
    challenge = dict(batch, schemaVersion=1, kind=CHALLENGE, command=COMMAND, phase=phase,
                     nonce=secrets.token_hex(32), expiresAt=int(time.time()) + LIFETIME)
    validate(challenge, int(time.time()))
    frames.write(challenge, MAX_SUBJECT)
    response = frames.read(MAX_REPLY)
    require(type(response) is dict and response.keys() == {'subject', 'bundle'}
            and type(response['bundle']) is str, 'Exact signed observer response required')
    subject = encode(response['subject'])
    try:
        bundle = base64.b64decode(response['bundle'], validate=True)
    except (binascii.Error, ValueError):
        raise ValueError('Invalid GitHub bundle encoding') from None
    require(0 < len(subject) <= MAX_SUBJECT and 0 < len(bundle) <= MAX_BUNDLE,
            'Observer response exceeds signed evidence bounds')
    verify_subject(response['subject'], challenge)
    verify(subject, bundle)
    validate(challenge, int(time.time()))
    return response


def verify_github(subject, bundle, *, gh, roots, signer_sha, source_ref, source_sha, run, attempt):
    """Verify with caller-pinned local tools and independent workflow coordinates."""
    require(match(COMMIT, signer_sha) and match(COMMIT, source_sha)
            and source_ref == 'refs/heads/codex/zimage-attestation-shadow-20261122'
            and all(type(n) is int and 0 < n < 2**63 for n in (run, attempt)), 'Invalid observer workflow policy')
    workflow = f'{REPO}/{SIGNER}'
    with tempfile.TemporaryDirectory(prefix='zimage-public-observation-') as tmp:
        home = Path(tmp)
        file, attestation = home / 'observation.json', home / 'bundle.jsonl'
        file.write_bytes(subject)
        attestation.write_bytes(bundle)
        argv = [str(gh), 'attestation', 'verify', str(file), '--repo', REPO,
                '--signer-workflow', workflow, '--signer-digest', signer_sha, '--source-ref', source_ref,
                '--source-digest', source_sha, '--deny-self-hosted-runners', '--predicate-type', PREDICATE,
                '--bundle', str(attestation), '--custom-trusted-root', str(roots), '--format', 'json']
        proxy = 'http://127.0.0.1:9'
        env = dict(HOME=tmp, GH_CONFIG_DIR=tmp, LANG='C', GH_PROMPT_DISABLED='1',
                   HTTP_PROXY=proxy, HTTPS_PROXY=proxy, ALL_PROXY=proxy, NO_PROXY='')
        completed = subprocess.run(argv, cwd=tmp, env=env, stdin=subprocess.DEVNULL,
                                   capture_output=True, timeout=15, check=False)
    require(completed.returncode == 0 and 0 < len(completed.stdout) <= 1_048_576,
            'GitHub public observer signature refused')
    rows = json.loads(completed.stdout, object_pairs_hook=_unique)
    require(type(rows) is list and len(rows) == 1, 'Exact verified public observer statement required')
    verified = rows[0]['verificationResult']
    cert = verified['signature']['certificate']
    statement = verified['statement']
    subjects = statement.get('subject', [])
    require(statement.get('_type') == 'https://in-toto.io/Statement/v1' and statement.get('predicateType') == PREDICATE
            and type(subjects) is list and len(subjects) == 1
            and subjects[0].get('digest') == {'sha256': hashlib.sha256(subject).hexdigest()}
            and cert.get('sourceRepositoryIdentifier') == REPO_ID
            and cert.get('runInvocationURI') == f'https://github.com/{REPO}/actions/runs/{run}/attempts/{attempt}',
            'Attested subject or GitHub observer identity differs')
