"""Fixed SSH handoff for the exact protected-main pair and its stage proof."""
import hashlib
import json
from pathlib import Path
import re
import stat
import struct
import sys

import github_hosted_stage_shadow as stage
import github_shadow_pins as policy_pins
from github_shadow_signer_intake import REPO, REPO_ID, WORKFLOW

MAGIC = b'ZIMAGE-CI-PAIR\x02'
RESTORE_MAGIC = b'ZIMAGE-CI-PAIR\x03'
INTERACTIVE_MAGIC = b'ZIMAGE-CI-PAIR\x04'
INTERACTIVE_RESTORE_MAGIC = b'ZIMAGE-CI-PAIR\x05'
REQUEST_END = b'ZIMAGE-CI-END\x01'
RESTORE_CAP = 2048
LENGTH = struct.Struct('!Q')
MEMBERS = (('stage.json', 4096), ('stage.bundle.jsonl', 1024 * 1024),
           ('pins.json', 65536), ('config.json', 65536),
           ('backend.zip', 100_000_000), ('frontend.zip', 100_000_000))
WIRE_MEMBERS = (*MEMBERS, ('rollback.json', 4096))
COMMAND = 'zimage-publish-pair-v1'
API = '/repos/' + REPO
COMMIT = re.compile('[a-f0-9]{40}')
DIGEST = re.compile('[a-f0-9]{64}')
BLOCK = 1024 * 1024


def exact(stream, count):
    data = stream.read(count)
    if len(data) != count:
        raise ValueError('Truncated pair handoff')
    return data


def receive(stream, request, *, interactive=False):
    """Use the caller's protocol version. Interactive framing leaves stdin open."""
    magic = exact(stream, len(MAGIC))
    if magic == (INTERACTIVE_RESTORE_MAGIC if interactive else RESTORE_MAGIC):
        size, = LENGTH.unpack(exact(stream, LENGTH.size))
        if not 0 < size <= RESTORE_CAP:
            raise ValueError('Invalid restoration selector size')
        selector = json.loads(exact(stream, size), object_pairs_hook=stage._unique)
        if type(selector) is not dict:
            raise ValueError('Invalid restoration selector')
        finish_request(stream, interactive)
        return selector
    if magic != (INTERACTIVE_MAGIC if interactive else MAGIC):
        raise ValueError('Unknown pair handoff protocol')
    for name, cap in WIRE_MEMBERS:
        remaining, = LENGTH.unpack(exact(stream, LENGTH.size))
        if not 0 < remaining <= cap:
            raise ValueError('Invalid pair handoff member size')
        with (request / name).open('xb') as out:
            while remaining:
                data = exact(stream, min(remaining, BLOCK))
                out.write(data)
                remaining -= len(data)
    finish_request(stream, interactive)


def finish_request(stream, interactive):
    if interactive:
        if exact(stream, len(REQUEST_END)) != REQUEST_END:
            raise ValueError('Interactive pair handoff missing its end marker')
    elif stream.read(1):
        raise ValueError('Trailing pair handoff bytes')


def send(request, out, *, interactive=False):
    out.write(INTERACTIVE_MAGIC if interactive else MAGIC)
    for name, cap in WIRE_MEMBERS:
        path = request / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= cap:
            raise ValueError('Invalid local pair handoff input')
        out.write(LENGTH.pack(info.st_size))
        with path.open('rb') as stream:
            remaining = info.st_size
            while remaining:
                data = exact(stream, min(remaining, BLOCK))
                out.write(data)
                remaining -= len(data)
            if stream.read(1):
                raise ValueError('Local pair handoff input changed')
    if interactive:
        out.write(REQUEST_END)


def send_restoration(selector, out, *, interactive=False):
    body = json.dumps(selector, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('ascii')
    if not 0 < len(body) <= RESTORE_CAP:
        raise ValueError('Invalid restoration selector size')
    magic = INTERACTIVE_RESTORE_MAGIC if interactive else RESTORE_MAGIC
    out.write(magic + LENGTH.pack(len(body)) + body)
    if interactive:
        out.write(REQUEST_END)


def validate_restoration(receipt, release):
    """Check the completed restoration against the original opened release."""
    operation, approval = release['operationId'], release['rootApprovalSha256']
    identity = json.dumps(dict(operation=operation, approval=approval), sort_keys=True, separators=(',', ':')) + '\n'
    expected = {name: release[name] for name in ('operationId', 'commit', 'runId', 'attempt', 'rootApprovalSha256',
                                                'rollbackAcceptanceSha256')}
    expected.update(schemaVersion=1, kind='zimage-ordinary-restoration-v1', status='restored',
                    restorationOperationId='restore-' + hashlib.sha256(identity.encode()).hexdigest()[:48],
                    restoredPair=release['rollbackPair'])
    digests = {'publicFailureSha256', 'publicRestorationSha256'}
    if (type(receipt) is not dict or set(receipt) != expected.keys() | digests
            or any(type(receipt[key]) is not type(value) or receipt[key] != value for key, value in expected.items())
            or any(type(receipt[key]) is not str or not DIGEST.fullmatch(receipt[key]) for key in digests)):
        raise ValueError('Restoration did not return the exact completed receipt')
    return receipt


def assert_main(get, commit):
    branch = get(API + '/branches/main')
    if not (branch['name'] == 'main' and branch['protected'] is True and branch['commit']['sha'] == commit):
        raise ValueError('Candidate is no longer current protected main')


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(BLOCK), b''):
            digest.update(data)
    return digest.hexdigest()


def rollback_pair(value, candidate):
    if type(value) is not dict or set(value) != {'backend', 'frontend'}:
        raise ValueError('Exact rollback pair required')
    backend = value['backend']
    if (type(backend) is not str or not COMMIT.fullmatch(backend) or backend == candidate
            or value['frontend'] != 'release-' + backend[:12]):
        raise ValueError('Rollback must be a distinct same-commit pair')
    return dict(value)


def admit(request, *, policy, get, verify, intake, now, seen):
    """Verify bytes under independently installed policy; grant no switch authority.

    The root caller supplies the pinned offline verifier, real HTTPS metadata,
    clock, and replay state. The ordinary coordinator must separately verify
    root approval, restored baseline and the real backend/frontend candidate.
    """
    if policy['repositoryId'] != REPO_ID or policy['workflow'] != WORKFLOW:
        raise ValueError('Unexpected installed release policy')
    candidate = intake.read_json(request / 'pins.json')
    commit, run_id, attempt = (candidate[k] for k in ('commit', 'runId', 'attempt'))
    if (not COMMIT.fullmatch(commit) or not intake.hosted_namespace(candidate, 'hosted-shadow')
            or any(type(n) is not int or not 0 < n < 2**63 for n in (run_id, attempt))):
        raise ValueError('Protected same-run candidate required')
    rollback = rollback_pair(intake.read_json(request / 'rollback.json'), commit)
    release = dict(sourceSHA=commit, runId=run_id, attempt=attempt)
    for name in ('backend', 'frontend'):
        digest = file_sha(request / (name + '.zip'))
        if candidate[name]['artifactSha256'] != digest:
            raise ValueError('Candidate archive differs from handoff pins')
        release[name + 'Sha256'] = digest

    assert_main(get, commit)
    run_path = f'{API}/actions/runs/{run_id}/attempts/{attempt}'
    context = policy_pins.pins(policy=policy, release=release, run=get(run_path),
                               jobs=get(run_path + '/jobs?per_page=100'), publishing=True)
    subject = (request / 'stage.json').read_bytes()
    bundle = (request / 'stage.bundle.jsonl').read_bytes()
    verified = verify(payload=subject, bundle=bundle, expected=context['expected'])
    proof = stage.shadow(subject, **context, **verified, now=now, seen=seen)

    report = intake.evaluate(candidate, request / 'backend.zip', request / 'frontend.zip',
                             intake.read_json(request / 'config.json'))
    if (report['immutablePairVerified'] is not True or report['productionReady'] is not False
            or (report['commit'], report['runId'], report['attempt']) != (commit, run_id, attempt)):
        raise ValueError('Exact candidate intake failed')
    assert_main(get, commit)
    return {'packet': dict(repository=REPO, workflow=WORKFLOW, commit=commit, runId=run_id, attempt=attempt,
                           backendManifestSha256=candidate['backend']['manifestSha256'],
                           frontendSubjectSha256=candidate['frontend']['subjectSha256']),
            'stageSha256': hashlib.sha256(subject).hexdigest(), 'replayKey': proof['replayKey'],
            'rollbackPair': rollback,
            'artifactDigests': {'backend': release['backendSha256'], 'frontend': release['frontendSha256']}}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('One private handoff directory required')
        send(Path(sys.argv[1]), sys.stdout.buffer)
    except (OSError, ValueError):
        sys.exit('Pair handoff could not be sent')
