#!/usr/bin/python3 -I
"""Apply a single root-approved Flow frontend operation through the existing publisher."""
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import time


TOOLS = Path(__file__).absolute().parent
INSTALLED_TOOLS = Path('/opt/zimage/frontend-flow-tools')
ETC = Path('/etc/zimage')
APPROVALS = ETC / 'frontend-flow-approvals'
TOOL_FILES = ('flow_release.py', 'release.py', 'manifest.py', 'transport.py')
HEADER_LIMIT = 2048
MAX_APPROVAL_SECONDS = 1800
APPLY_SCOPE = ('action', 'namespace', 'sourceSHA', 'expectedBackend', 'archiveSha256')


def load_publisher():
    if os.geteuid() == 0:
        if not sys.flags.isolated or TOOLS != INSTALLED_TOOLS:
            raise ValueError('Use the fixed isolated frontend Flow helper')
        for directory in (*reversed(TOOLS.parents), TOOLS):
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('Untrusted frontend tool directory')
        if os.path.lexists(TOOLS / '__pycache__'):
            raise ValueError('Frontend Flow tool directory must contain reviewed sources only')
        for name in TOOL_FILES:
            info = (TOOLS / name).lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('Untrusted frontend tool file')
    spec = importlib.util.spec_from_file_location('frontend_release', TOOLS / 'release.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load_publisher()
m = release.m


class GateError(ValueError):
    """Only fixed, non-sensitive error messages may cross the SSH boundary."""


def validate_request(request):
    if type(request) is not dict:
        raise GateError('Invalid Flow operation request')
    scope = APPLY_SCOPE if request.get('mode') == 'apply' else ()
    m.keys(request, ['schemaVersion', 'operationId', 'mode', 'approvalSha256', *scope])
    operation = m.identifier(request['operationId'])
    m.checksum(request['approvalSha256'])
    if (type(request['schemaVersion']) is not int or request['schemaVersion'] != 1
            or not operation.startswith('flow-front-') or request['mode'] not in ('apply', 'query')):
        raise GateError('Invalid Flow operation request')
    return operation


def validate_approval(body, request):
    if not isinstance(body, bytes) or len(body) > m.MAX_JSON or m.digest(body) != request['approvalSha256']:
        raise GateError('Root approval digest does not match')
    approval = m.parse(body)
    m.keys(approval, ['schemaVersion', 'operationId', 'action', 'namespace', 'artifactId', 'sourceSHA',
                      'manifestSha256', 'archiveSha256', 'archiveBytes', 'expectedCurrent', 'expectedBackend',
                      'expectedSequence', 'policySha256', 'issuedAt', 'expiresAt'])
    if (type(approval['schemaVersion']) is not int or approval['schemaVersion'] != 1
            or approval['operationId'] != request['operationId'] or body != m.canonical(approval)
            or approval['action'] not in ('deploy', 'rollback')):
        raise GateError('Root approval does not identify this operation')
    if any(request[key] != approval[key] for key in APPLY_SCOPE):
        raise GateError('Flow request scope differs from root approval')
    for key in ('namespace', 'expectedCurrent', 'expectedBackend'):
        if m.identifier(approval[key]) == 'none':
            raise GateError('Flow requires an existing frontend and backend')
    for key in ('artifactId', 'manifestSha256', 'policySha256'):
        m.checksum(approval[key])
    if not isinstance(approval['sourceSHA'], str) or not re.fullmatch(r'[a-f0-9]{40}', approval['sourceSHA']):
        raise GateError('Invalid approved source SHA')
    for key in ('expectedSequence', 'issuedAt', 'expiresAt'):
        m.integer(approval[key])
    if approval['action'] == 'deploy':
        m.checksum(approval['archiveSha256'])
        m.integer(approval['archiveBytes'], 1, m.MAX_ARCHIVE)
    elif approval['archiveSha256'] is not None or type(approval['archiveBytes']) is not int or approval['archiveBytes'] != 0:
        raise GateError('Rollback cannot authorize an archive')
    return approval


def verify_baseline(publisher, approval, policy_digest, require_open, clock, expected_sequence):
    now = clock()
    if (not approval['issuedAt'] <= now < approval['expiresAt']
            or approval['expiresAt'] - approval['issuedAt'] > MAX_APPROVAL_SECONDS):
        raise GateError('Root approval is outside its validity window')
    require_open()
    if policy_digest() != approval['policySha256']:
        raise GateError('Release policy changed since approval')
    sequence = publisher.read_json(publisher.base / 'sequence.json')
    m.keys(sequence, ['sequence'])
    m.integer(sequence['sequence'])
    if (sequence['sequence'] != expected_sequence
            or publisher.current() != approval['expectedCurrent']):
        raise GateError('Frontend release baseline changed since approval')
    meta = m.validate_api_meta(publisher.meta())
    if meta['backendRelease'] != approval['expectedBackend']:
        raise GateError('Backend release changed since approval')
    return meta


@contextmanager
def input_deadline(seconds):
    def timeout(_signum, _frame):
        raise GateError('Flow input timed out')

    previous = signal.signal(signal.SIGALRM, timeout)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def receive_archive(publisher, stream, target, approval):
    remaining = approval['archiveBytes']
    if publisher.free_bytes() < remaining + m.MAX_BYTES * 2 + publisher.reserve_bytes:
        raise GateError('Insufficient disk space for bounded extraction')
    digest = hashlib.sha256()
    with input_deadline(90), target.open('xb') as archive:
        os.chmod(target, 0o600)
        while remaining:
            block = stream.read(min(remaining, 1024 * 1024))
            if not block:
                raise GateError('Incomplete approved archive')
            remaining -= len(block)
            digest.update(block)
            archive.write(block)
        if stream.read(1) or digest.hexdigest() != approval['archiveSha256']:
            raise GateError('Archive size or checksum differs from approval')
        archive.flush()
        os.fsync(archive.fileno())


def execute(publisher, request, stream, *, load_approval, policy_digest, require_open, clock=time.time):
    operation = validate_request(request)
    approval_digest = request['approvalSha256']
    with publisher.locked():
        journal = publisher.base / 'journal' / (operation + '.json')
        if os.path.lexists(journal):
            record = publisher.read_json(journal)
            if (record.get('operationId') != operation or record.get('request', {}).get('kind') not in ('flow-deploy', 'flow-rollback')
                    or record.get('request', {}).get('approvalSha256') != approval_digest):
                raise GateError('Operation already exists with a different approval')
            return record
        if request['mode'] == 'query':
            return {'schemaVersion': 1, 'operationId': operation, 'state': 'absent'}

        approval_body = load_approval(operation)
        approval = validate_approval(approval_body, request)
        verify_baseline(publisher, approval, policy_digest, require_open, clock, approval['expectedSequence'])
        namespace = approval['namespace']
        manifest_sha = approval['manifestSha256']
        action = approval['action']
        # Persist before reading the upload. A second Flow process can only
        # observe this reservation, even if the first SSH stream disconnects.
        record = publisher.start(operation, {'kind': 'flow-' + action, 'namespace': namespace,
                                             'manifestSha256': manifest_sha, 'archiveSha256': approval['archiveSha256'],
                                             'approvalSha256': approval_digest}, approval['expectedCurrent'])

        def prepare(manifest):
            if any(manifest[key] != approval[approved_key] for key, approved_key in
                   (('assetNamespace', 'namespace'), ('artifactId', 'artifactId'), ('sourceSHA', 'sourceSHA'))):
                raise GateError('Candidate manifest identity differs from approval')
            if load_approval(operation) != approval_body:
                raise GateError('Root approval changed before publication')
            meta = verify_baseline(publisher, approval, policy_digest, require_open, clock, record['sequence'])
            m.compatibility(manifest, meta)

        if action == 'deploy':
            with tempfile.TemporaryDirectory(prefix='flow-incoming-', dir=publisher.base / '.stage') as temporary:
                archive = Path(temporary) / 'input.tgz'
                receive_archive(publisher, stream, archive, approval)
                manifest = publisher.seal(operation, namespace, approval['archiveSha256'], manifest_sha,
                                          private_archive=archive, prepare=prepare)
        else:
            manifest = publisher.sealed(namespace, manifest_sha)
            publisher.require_approval(manifest, manifest_sha)
            prepare(manifest)
        record.update(artifactId=manifest['artifactId'], sourceSHA=manifest['sourceSHA'],
                      publicConfigFingerprint=manifest['build']['publicConfigFingerprint'])
        return publisher.activate(record, manifest)


def root_bytes(path, limit=m.MAX_JSON):
    for directory in (*reversed(path.parent.parents), path.parent):
        release.owned(directory, directory=True)
    release.owned(path)
    return m.read_regular(path, limit)


def production_policy_digest():
    identity = {name: m.digest(root_bytes(TOOLS / name)) for name in TOOL_FILES}
    identity['frontend-release.json'] = m.digest(root_bytes(release.CONFIG))
    return m.digest(m.canonical(identity))


def require_no_active_pair():
    policy_path = ETC / 'paired-release-policy.json'
    if not os.path.lexists(policy_path):
        return
    operation = m.identifier(m.parse(root_bytes(policy_path))['operationId'])
    journal = release.ROOT / 'paired-operations' / operation
    if not os.path.lexists(journal):
        return
    state = m.parse(root_bytes(journal / 'state.json'))
    m.keys(state, ['sequence', 'previousSha256', 'record'])
    sequence = state['sequence']
    m.integer(sequence, 1, 512)
    record = state['record']
    if (type(record) is not dict or record.get('kind') != 'zimage-paired-release-v1'
            or record.get('operationId') != operation or record.get('phase') not in ('opened', 'recovered')):
        raise GateError('Paired release has an unfinished operation')
    events = journal / 'events'
    release.owned(events, directory=True)
    if (sum(1 for _ in events.iterdir()) != sequence
            or m.parse(root_bytes(events / f'{sequence:04d}.json')) != state):
        raise GateError('Paired release journal must be reconciled')


def production_open():
    release.require_no_active_bootstrap()
    require_no_active_pair()
    if any(os.path.lexists(ETC / marker) for marker in ('ingress-maintenance.json', 'ingress-checking.json')):
        raise GateError('Ingress maintenance is active')
    gate = m.parse(root_bytes(ETC / 'backend-maintenance.json', 1024))
    m.keys(gate, ['schemaVersion', 'operationId', 'mode'])
    m.identifier(gate['operationId'])
    if type(gate['schemaVersion']) is not int or gate['schemaVersion'] != 2 or gate['mode'] != 'open':
        raise GateError('Backend maintenance is active')


def approval_context(publisher):
    with publisher.locked():
        production_open()
        sequence = publisher.read_json(publisher.base / 'sequence.json')
        m.keys(sequence, ['sequence'])
        m.integer(sequence['sequence'])
        current = publisher.current()
        if current is None:
            raise GateError('Flow requires an existing frontend')
        return {'expectedCurrent': current, 'expectedBackend': publisher.meta()['backendRelease'],
                'expectedSequence': sequence['sequence'], 'policySha256': production_policy_digest()}


def read_request(stream):
    line = stream.readline(HEADER_LIMIT + 1)
    if len(line) > HEADER_LIMIT or not line.endswith(b'\n'):
        raise GateError('Missing bounded Flow request header')
    return m.parse(line)


def main():
    arguments = sys.argv[1:]
    if arguments not in ([], ['--approval-context']):
        raise GateError('Invalid fixed Flow helper invocation')
    release.production_preflight()
    publisher = release.Publisher(release.ROOT, probe=release.production_probe, meta=release.production_meta,
                                  approval=release.production_approval)
    if arguments:
        print(json.dumps(approval_context(publisher), sort_keys=True))
        return 0
    with input_deadline(20):
        request = read_request(sys.stdin.buffer)
    result = execute(publisher, request, sys.stdin.buffer, load_approval=lambda op: root_bytes(APPROVALS / (op + '.json')),
                     policy_digest=production_policy_digest, require_open=production_open)
    print(json.dumps(result, sort_keys=True))
    return 0 if request['mode'] == 'query' or result.get('success') is True else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        detail = str(error) if isinstance(error, GateError) else type(error).__name__
        print('Frontend Flow request rejected: ' + detail, file=sys.stderr)
        sys.exit(1)
