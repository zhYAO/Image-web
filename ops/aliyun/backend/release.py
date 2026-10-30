#!/usr/bin/python3 -I
"""Fixed-path backend release wrapper; never invoke the old activation entrypoint.

Administrator installation and first legacy bootstrap remain separate gates.
No SSH, cloud build, dependency install, DB migration or Worker deploy is here.
"""
import argparse
from contextlib import nullcontext
import importlib.util
import fcntl
import json
import os
from pathlib import Path
import socket
import secrets
import struct
import pwd
import stat
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/opt/zimage')
TOOLS = Path('/usr/local/libexec/zimage-three-layer')
CONTROL = Path('/etc/zimage/backend-maintenance.json')
POLICY = Path('/etc/zimage/backend-release-policy.json')
RECEIPT = Path('/etc/zimage/backend-readonly-receipt.json')
VERIFICATION = ROOT / 'backend-operations/verification-request.json'
SOCKET_DIRECTORY = Path('/run/zimage-lifecycle')
SOCKET = str(SOCKET_DIRECTORY / 'control.sock')
SERVICE_DROPIN = Path('/etc/systemd/system/zimage.service.d/backend-lifecycle.conf')
HEX40 = __import__('re').compile(r'[a-f0-9]{40}')
FRONTEND_ID = __import__('re').compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}')


def owned(path, directory=False):
    path = Path(path)
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('Untrusted root-managed backend path: ' + str(item))
        if item == path and not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
            raise ValueError('Wrong backend path type')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise ValueError('Backend ancestor is not a directory')


def load(path, name):
    owned(path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bounded_json(path, limit=65536):
    owned(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise ValueError('Backend JSON is not a bounded regular file')
        value = stream.read(limit + 1)
        if len(value) > limit: raise ValueError('Backend JSON exceeds bound')
        def pairs(items):
            result = {}
            for key, item in items:
                if key in result: raise ValueError('Duplicate backend JSON field')
                result[key] = item
            return result
        return json.loads(value, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite backend JSON')))


def service_launch_preflight():
    owned(Path(__file__).with_name('http-admission.cjs'))
    fields = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage.service', '--property=ExecStart', '--value'], text=True)
    match = __import__('re').search(r'argv\[\]=([^;]+);', fields)
    expected = ['/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node', '--require',
                '/usr/local/libexec/zimage-backend/http-admission.cjs', 'server.js']
    if match is None or match.group(1).strip().split() != expected:
        raise ValueError('Loaded systemd ExecStart must bind exact reviewed root Node preload')


class SystemOps:
    def __init__(self, adapter, legacy):
        self.adapter, self.legacy = adapter, legacy

    def current(self):
        return self.adapter.current_target().name

    def frontend(self):
        base = ROOT / 'frontend'
        owned(base, directory=True)
        current = base / 'current'
        info = current.lstat()
        if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0:
            raise ValueError('Frontend current must be root-managed')
        target = os.readlink(current)
        parts = target.split('/')
        if len(parts) != 2 or parts[0] != 'releases' or not FRONTEND_ID.fullmatch(parts[1]):
            raise ValueError('Frontend pointer must select exact releases/<assetNamespace>')
        release = base / target
        owned(release, directory=True)
        manifest = bounded_json(release / '.release/manifest.json')
        if manifest.get('assetNamespace') != parts[1]: raise ValueError('Frontend manifest pointer mismatch')
        policy = self.policy()
        candidates = [item for item in policy['supportedFrontends'] if item['releaseId'] == manifest.get('artifactId')]
        if len(candidates) != 1: raise ValueError('Current frontend compatibility evidence missing')
        required = candidates[0]['requiresApi']
        if manifest.get('apiRequirements') != {'major': required['major'], 'minMinor': required['minor'], 'capabilities': required['capabilities']} or candidates[0]['verifiedBackends'] != manifest.get('verifiedBackendReleases'):
            raise ValueError('Current frontend actual requirements differ from approved compatibility record')
        return manifest['artifactId']

    def policy(self):
        return bounded_json(POLICY)

    def service_pid(self):
        fields = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage.service', '--property=MainPID,ActiveState'], text=True)
        state = dict(line.split('=', 1) for line in fields.splitlines() if '=' in line)
        if state.get('ActiveState') != 'active' or not state.get('MainPID', '').isdigit() or int(state['MainPID']) <= 0:
            raise RuntimeError('Backend is stopped or not active; status never starts it')
        return int(state['MainPID'])

    def status(self):
        pid = self.service_pid()
        uid = pwd.getpwnam('zimage').pw_uid
        owned(SOCKET_DIRECTORY.parent, directory=True)
        directory = SOCKET_DIRECTORY.lstat()
        if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != uid or stat.S_IMODE(directory.st_mode) != 0o700:
            raise ValueError('Lifecycle runtime directory must be private to the service UID')
        info = os.lstat(SOCKET)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != uid or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('Lifecycle socket must be service-owned mode 0600')
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(3)
            connection.connect(SOCKET)
            peer_pid, peer_uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
            if peer_pid != pid or peer_uid != uid:
                raise RuntimeError('Lifecycle socket peer is not the exact service MainPID/UID')
            connection.sendall(b'{"command":"status"}\n')
            body = b''
            while not body.endswith(b'\n'):
                block = connection.recv(4096)
                if not block: raise RuntimeError('Lifecycle status ended early')
                body += block
                if len(body) > 16384: raise ValueError('Lifecycle status exceeds bound')
            state = json.loads(body)
            if state.get('pid') != pid or self.service_pid() != pid:
                raise RuntimeError('Lifecycle status process changed during read')
            return state

    def validate(self, release):
        target = ROOT / 'releases' / release
        # This intentionally accepts only the retained layered protocol, never
        # an unverified source directory or a pure frontend artifact.
        self.adapter.verify_retained_layered(target, release)
        policy = self.policy()['backends'][release]
        actual = self.legacy.get('http://127.0.0.1:3100/api/meta')
        if actual[0] != 200: raise RuntimeError('Current backend metadata unavailable')
        # Candidate API metadata is checked after start. Its approved manifest
        # compatibility record is root-controlled, not supplied by incoming.
        if policy.get('drainProtocol') != 1:
            raise ValueError('Candidate lacks reviewed drain protocol evidence')

    def stop(self):
        subprocess.run(['/usr/bin/systemctl', 'stop', 'zimage.service'], check=True)

    def start(self):
        subprocess.run(['/usr/bin/systemctl', 'start', 'zimage.service'], check=True)

    def native(self, release):
        self.legacy.font_preflight(ROOT / 'releases' / release)

    def select(self, release, expected):
        if self.current() != expected: raise RuntimeError('Backend current changed before exact selection')
        temporary = ROOT / 'current.backend-next'
        if os.path.lexists(temporary): raise RuntimeError('Unreconciled backend pointer temporary')
        temporary.symlink_to(ROOT / 'releases' / release)
        os.replace(temporary, ROOT / 'current')
        fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)

    def previous(self, release):
        temporary = ROOT / 'previous.backend-next'
        if os.path.lexists(temporary): raise RuntimeError('Unreconciled previous pointer temporary')
        temporary.symlink_to(ROOT / 'releases' / release)
        os.replace(temporary, ROOT / 'previous')

    def safe_to_restore(self, release, operation):
        # A failed start with no PID cannot have accepted application requests.
        pid = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage.service', '--property=MainPID', '--value'], text=True).strip()
        if pid == '0': return
        state = self.status()
        if (str(state.get('pid')) != pid or state.get('backendRelease') != release or state.get('admissionEpoch') != operation
                or state.get('maintenance') is not True or state.get('admissionMode') != 'draining'):
            raise RuntimeError('Candidate exact draining identity unavailable; recovery remains protected')

    def service_stopped(self):
        pid = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage.service', '--property=MainPID', '--value'], text=True).strip()
        if not pid.isdigit(): raise RuntimeError('Unknown service PID state')
        return pid == '0'

    def check(self, release, operation):
        self.legacy.wait_healthy(ROOT / 'releases' / release)
        status = self.status()
        code, body = self.legacy.get('http://127.0.0.1:3100/api/meta')
        meta = json.loads(body)
        expected = self.policy()['backends'][release]['api']
        if code != 200 or meta.get('backendRelease') != release or meta.get('api') != {key: expected[key] for key in ('major', 'minor')} or not set(expected['capabilities']).issubset(meta.get('capabilities', [])):
            raise RuntimeError('Exact API compatibility metadata mismatch')
        # This receipt is produced by an independently authorized verifier, not
        # by a ready probe or the API service. Missing evidence keeps writes shut.
        engine = load(Path(__file__).with_name('transaction.py'), 'backend_receipt_writer')
        receipt_protocol = load(Path(__file__).with_name('receipt.py'), 'backend_receipt_protocol')
        now = time.time()
        request = {'schemaVersion': 1, 'operationId': operation, 'backendRelease': release, 'pid': status['pid'],
                   'nonce': secrets.token_hex(32), 'createdAt': now, 'expiresAt': now + 120}
        engine.atomic_json(VERIFICATION, request)
        # A verifier on an independent machine consumes the fixed request, runs
        # verify.py with an already-authorized short-lived cookie, and a trusted
        # root transport installs its receipt. No CLI Boolean bypass exists.
        deadline = time.monotonic() + 110
        while True:
            try:
                receipt_protocol.validate_receipt(bounded_json(RECEIPT), request,
                                                  operation=operation, release=release, pid=status['pid'], now=time.time())
                return status
            except (OSError, ValueError): pass
            if time.monotonic() >= deadline:
                raise RuntimeError('Independent exact-version read-only receipt missing, stale or invalid')
            time.sleep(0.25)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    deploy = sub.add_parser('deploy')
    for name in ('sha', 'outer_sha256', 'manifest_sha256', 'run_number', 'expected_current', 'operation_id'):
        deploy.add_argument(name)
    rollback = sub.add_parser('rollback')
    for name in ('sha', 'expected_current', 'operation_id'): rollback.add_argument(name)
    sub.add_parser('status')
    sub.add_parser('verification-request')
    accept = sub.add_parser('accept-receipt')
    accept.add_argument('operation_id')
    accept.add_argument('sha')
    accept.add_argument('pid', type=int)
    accept.add_argument('expected_receipt_sha256')
    args = parser.parse_args()
    if os.geteuid() != 0 or not sys.flags.isolated:
        raise RuntimeError('Requires root, isolated Python, and administrator-installed fixed helper closure')
    owned(Path(__file__).absolute())
    engine = load(Path(__file__).with_name('transaction.py'), 'backend_transaction')
    bridge = load(TOOLS / 'release-three-layer.py', 'backend_layers')
    layers, legacy = bridge.load_tools(strict=True)
    owned(ROOT, directory=True)
    for installed, source in ((SERVICE_DROPIN, 'backend-lifecycle.conf'),):
        owned(installed)
        template = Path(__file__).with_name(source)
        owned(template)
        if installed.read_bytes() != template.read_bytes(): raise ValueError('Exact reviewed lifecycle systemd template required')
    service_launch_preflight()
    bounded_json(CONTROL, 1024)
    # Root-owned deployment journal lives outside deploy's incoming directory.
    journal_dir = ROOT / 'backend-operations'
    owned(journal_dir, directory=True)
    if args.command == 'verification-request':
        # Atomic root request read only; does not take the release lock or
        # connect the socket or interact with the service.
        print(json.dumps(bounded_json(VERIFICATION, 4096), sort_keys=True))
        return
    with bridge.safe_node_environment():
        # Native probe is deferred until the old API has safely drained/stopped;
        # all existing layer/cache/ELF/font closure validation stays enabled.
        adapter = bridge.Adapter(ROOT, layers, legacy, native_check=lambda *_: None)
        if args.command == 'accept-receipt':
            # The release transaction holds deploy.lock while waiting for the
            # verifier. This independent narrow lock serializes receipt installs
            # without selecting a backend or altering root admission/approval.
            receipt_protocol = load(Path(__file__).with_name('receipt.py'), 'backend_receipt_accept')
            private = journal_dir / 'receipt-stage'
            if not private.exists(): private.mkdir(mode=0o700)
            owned(private, directory=True)
            lock_path = journal_dir / 'receipt.lock'
            if os.path.lexists(lock_path): owned(lock_path)
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                request = bounded_json(VERIFICATION, 4096)
                ops = SystemOps(adapter, legacy)
                def live_pid():
                    status = ops.status()
                    if status.get('backendRelease') != args.sha or status.get('maintenance') is not True or status.get('admissionEpoch') != args.operation_id:
                        raise ValueError('Receipt process has not observed the exact persistent maintenance gate')
                    return status['pid']
                gate = bounded_json(CONTROL, 1024)
                if gate != {'schemaVersion': 2, 'operationId': args.operation_id, 'mode': 'checking'}:
                    raise ValueError('Receipt cannot authorize an unrelated or open maintenance window')
                # The caller's policy remains authoritative; incoming cannot
                # create backend/frontend approval by claiming successful GETs.
                journal = bounded_json(journal_dir / 'current.json')
                engine.compatible(ops.policy(), journal['old'], journal['target'], ops.frontend())
                incoming = ROOT / 'incoming'
                parent = incoming.parent
                owned(parent, directory=True)
                incoming_fd = os.open(incoming, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    receipt = receipt_protocol.accept_incoming(incoming_fd, private, request=request,
                        journal=lambda: bounded_json(journal_dir / 'current.json'), operation=args.operation_id,
                        release=args.sha, pid=args.pid, expected_sha256=args.expected_receipt_sha256,
                        current_release=ops.current, live_pid=live_pid)
                finally: os.close(incoming_fd)
                if bounded_json(VERIFICATION, 4096) != request or bounded_json(CONTROL, 1024) != gate:
                    raise ValueError('Root verification request or maintenance changed before receipt install')
                receipt_protocol.validate_receipt(receipt, request, operation=args.operation_id, release=args.sha, pid=args.pid, now=time.time())
                engine.atomic_json(RECEIPT, receipt)
                print(json.dumps({'schemaVersion': 1, 'accepted': True, 'operationId': args.operation_id,
                                  'backendRelease': args.sha, 'pid': args.pid, 'requestSha256': receipt['requestSha256']}, sort_keys=True))
                return
        with adapter.locked():  # exactly the same deploy.lock as frontend/legacy
            ops = SystemOps(adapter, legacy)
            if args.command == 'status':
                print(json.dumps({'current': ops.current(), 'frontend': ops.frontend(), 'lifecycle': ops.status(),
                                  'journal': bounded_json(journal_dir / 'current.json') if (journal_dir / 'current.json').exists() else None}, sort_keys=True))
                return
            transaction = engine.BackendTransaction(ops, CONTROL, journal_dir / 'current.json')
            def activate(target, **_kwargs):
                return transaction.switch(target.name, args.expected_current, args.operation_id)
            legacy.activate = activate
            # The outer lock covers artifact validation, prepare, drain, checks,
            # exact recovery and open. The adapter must not take a nested flock.
            adapter.locked = nullcontext
            if args.command == 'deploy':
                result = adapter.deploy(args.sha, args.outer_sha256, args.manifest_sha256, args.run_number)
                result['backendJournal'] = bounded_json(journal_dir / 'current.json')
            else:
                if not HEX40.fullmatch(args.sha): raise ValueError('Exact full-SHA rollback only')
                result = transaction.switch(args.sha, args.expected_current, args.operation_id)
            print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Backend operation failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
