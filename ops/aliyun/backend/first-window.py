#!/usr/bin/python3 -I
"""Fixed privileged B1-first entrypoint; no fabricated B0 socket/meta/manifest."""
import argparse
from contextlib import nullcontext
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent

# Authenticate the fixed installed code closure before loading helper modules.
# Unit tests import the wrapper as a module; privileged execution uses __main__.
if __name__ == '__main__':
    if os.geteuid() != 0 or not sys.flags.isolated: raise SystemExit('Requires root and isolated Python')
    for target in (Path(__file__).absolute(), HERE / 'release.py', HERE / 'first_window.py', HERE / 'transaction.py', HERE / 'frontend_bootstrap.py'):
        for path in (target, *target.parents):
            info = path.lstat()
            if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
                raise SystemExit('Untrusted fixed first-window helper closure')

def local(name):
    spec = importlib.util.spec_from_file_location('first_window_cli_' + name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

r = local('release')
f = local('first_window')
b = local('frontend_bootstrap')
POLICY = Path('/etc/zimage/first-window-policy.json')
COMPLETION = Path('/etc/zimage/first-window-completion.json')
FRONTEND = Path('/etc/zimage/legacy-frontend-identity.json')
AUDIT = Path('/etc/zimage/first-window-legacy-audit.json')
INGRESS = Path('/etc/zimage/ingress-maintenance.json')
CHECKING = Path('/etc/zimage/ingress-checking.json')
OPEN = Path('/etc/zimage/ingress-open.json')
FRONTEND_CHECKING = Path('/etc/zimage/frontend-checking.json')
FRONTEND_INGRESS_RECEIPT = Path('/etc/zimage/frontend-bootstrap-ingress.json')
FRONTEND_TOOLS = Path('/opt/zimage/frontend-tools')
JOURNAL = r.ROOT / 'backend-operations/first-window-current.json'
FRONTEND_COMMANDS = ('prepare-frontend', 'frontend-deploy', 'frontend-rollback', 'frontend-open')


def unlink_synced(path):
    if os.path.lexists(path):
        r.owned(path)
        path.unlink()
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)


class FirstOps(r.SystemOps):
    def first_policy(self): return r.bounded_json(POLICY)
    def policy(self): return self.first_policy()['candidatePolicy']
    def legacy_frontend(self): return r.bounded_json(FRONTEND)
    def completion(self): return r.bounded_json(COMPLETION)
    def ingress_state(self): return r.bounded_json(INGRESS, 1024)
    def ingress_open_exists(self): return os.path.lexists(OPEN)
    def ingress_checking(self): return r.bounded_json(CHECKING, 1024) if os.path.lexists(CHECKING) else None
    def frontend_current_exists(self): return os.path.lexists(r.ROOT / 'frontend/current')
    def first_journal(self): return r.bounded_json(JOURNAL)
    def frontend_checking(self): return r.bounded_json(FRONTEND_CHECKING, 1024) if os.path.lexists(FRONTEND_CHECKING) else None
    def frontend_ingress_receipt(self): return r.bounded_json(FRONTEND_INGRESS_RECEIPT)
    def frontend_mark(self, value):
        expected = b.marker(self.first_policy())
        if self.frontend_checking() not in (None, expected): raise ValueError('Foreign frontend checking marker')
        if value is None: unlink_synced(FRONTEND_CHECKING)
        elif value == expected: f.tx.atomic_json(FRONTEND_CHECKING, value, 0o644)
        else: raise ValueError('Unexpected frontend checking marker')
    def bootstrap_ingress_digests(self, policy):
        result = {'splitIngressSha256': self.ingress_digest(policy)}
        for key, name in (('maintenanceMapsSha256', 'maps'), ('maintenanceServerSha256', 'server')):
            path = Path('/etc/nginx/zimage-ingress-maintenance-' + name + '.conf')
            r.owned(path)
            with path.open('rb') as stream: body = stream.read(1_048_577)
            if len(body) > 1_048_576: raise ValueError('Ingress include exceeds bound')
            result[key] = hashlib.sha256(body).hexdigest()
        return result
    def open_ingress(self, policy):
        token = f.seal_token(policy)
        if (self.ingress_state() != token or self.ingress_open_exists() or self.ingress_checking() is not None
                or self.frontend_checking() is not None
                or r.bounded_json(r.CONTROL, 1024) != {'schemaVersion': 2, 'operationId': policy['operationId'], 'mode': 'open'}):
            raise ValueError('Exact drained bootstrap required for final ingress open')
        # O+M is deliberately closed. Durably publish O before removing our M.
        f.tx.atomic_json(OPEN, token, 0o644)
        if self.ingress_state() != token: raise ValueError('Ingress seal drift before opening')
        unlink_synced(INGRESS)
    def seal_ingress(self, policy):
        token = f.seal_token(policy)
        for path in (INGRESS, CHECKING, OPEN):
            if os.path.lexists(path) and r.bounded_json(path, 1024) != token:
                raise ValueError('Foreign ingress marker; manual reconciliation required')
        f.tx.atomic_json(INGRESS, token, 0o644)
        unlink_synced(OPEN)
        unlink_synced(CHECKING)
    def service_metadata(self):
        fields = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage.service', '--property=User,Group,WorkingDirectory,ExecStart,EnvironmentFiles,DropInPaths'], text=True)
        values = dict(line.split('=', 1) for line in fields.splitlines() if '=' in line)
        if set(values) != {'User', 'Group', 'WorkingDirectory', 'ExecStart', 'EnvironmentFiles', 'DropInPaths'}: raise ValueError('Service metadata incomplete')
        matched = __import__('re').search(r'argv\[\]=([^;]+);', values['ExecStart'])
        if matched is None: raise ValueError('Cannot establish exact loaded service argv')
        values['ExecStart'] = matched.group(1).strip().split()
        trusted = '/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node'
        legacy = [trusted, 'server.js']
        candidate = [trusted, '--require', '/usr/local/libexec/zimage-backend/http-admission.cjs', 'server.js']
        if (values['User'] != 'zimage' or values['Group'] != 'zimage' or values['WorkingDirectory'] != '/opt/zimage/current/apps/web'
                or values['ExecStart'] not in (legacy, candidate)):
            raise ValueError('Service must preserve reviewed trusted Node, UID and working directory')
        return values
    def original_service_digest(self): return f.digest(self.service_metadata())
    def service_policy(self, policy):
        for mode, name in (('candidate', 'backend-lifecycle.conf'), ('legacy', 'backend-legacy.conf')):
            path = HERE / name
            r.owned(path)
            if hashlib.sha256(path.read_bytes()).hexdigest() != policy['serviceTemplates'][mode]:
                raise ValueError('Reviewed service template digest mismatch')
    def service_mode(self, mode, policy):
        if self.process() is not None: raise RuntimeError('Service mode changes require a stopped process')
        self.service_policy(policy)
        r.owned(r.SERVICE_DROPIN.parent, directory=True)
        name = {'candidate': 'backend-lifecycle.conf', 'legacy': 'backend-legacy.conf'}[mode]
        template = HERE / name
        # Retain the existing UID, limits, font EnvironmentFiles and NODE_OPTIONS.
        body = template.read_bytes()
        import tempfile
        descriptor, pending = tempfile.mkstemp(prefix='.first-window-service-', dir=r.SERVICE_DROPIN.parent)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                os.fchmod(stream.fileno(), 0o644); stream.write(body); stream.flush(); os.fsync(stream.fileno())
            os.replace(pending, r.SERVICE_DROPIN)
            directory = os.open(r.SERVICE_DROPIN.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            Path(pending).unlink(missing_ok=True)
        subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
        metadata = self.service_metadata()
        expected = ['/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node']
        if mode == 'candidate': expected.extend(['--require', '/usr/local/libexec/zimage-backend/http-admission.cjs'])
        expected.append('server.js')
        if metadata['ExecStart'] != expected: raise ValueError('Loaded systemd launch differs from exact service mode')
    def ingress_digest(self, policy):
        path = Path(policy['ingressConfigPath'])
        r.owned(path)
        with path.open('rb') as stream:
            body = stream.read(1_048_577)
        if len(body) > 1_048_576: raise ValueError('Ingress configuration exceeds fixed bound')
        return hashlib.sha256(body).hexdigest()
    def process(self):
        fields = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage.service', '--property=MainPID,ActiveState,SubState'], text=True)
        value = dict(line.split('=', 1) for line in fields.splitlines() if '=' in line)
        text = value.get('MainPID', '')
        if not text.isdigit(): raise RuntimeError('Uncertain systemd MainPID')
        pid = int(text)
        if pid == 0:
            if value.get('ActiveState') not in ('inactive', 'failed'): raise RuntimeError('Service is in transition; reconcile before recovery')
            return None
        if value.get('ActiveState') != 'active' or value.get('SubState') != 'running': raise RuntimeError('Service process is not stably running')
        def read():
            body = Path('/proc/' + str(pid) + '/stat').read_text()
            # comm may contain spaces and parentheses. starttime is field 22.
            tail = body[body.rfind(')') + 2:].split()
            if len(tail) < 20 or not tail[19].isdigit(): raise RuntimeError('Cannot establish Linux process start identity')
            return {'pid': pid, 'startTicks': int(tail[19]), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
        before, after = read(), read()
        if before != after or self.service_pid() != pid: raise RuntimeError('Service PID/start drift')
        f.identity(after)
        return after
    def ingress_mode(self, operation, mode, policy):
        token = f.seal_token(policy)
        if self.ingress_open_exists(): raise RuntimeError('External open flag contradicts first-window seal')
        if operation != policy['operationId'] or self.ingress_state() != token:
            raise RuntimeError('External reviewed all-ingress seal absent or unrelated')
        if mode == 'draining':
            unlink_synced(CHECKING)
        elif mode == 'checking':
            f.tx.atomic_json(CHECKING, token, 0o644)
        else: raise ValueError('First-window coordinator cannot open ingress')
    def validate_first_candidate(self, release, policy):
        target = r.ROOT / 'releases' / release
        self.adapter.verify_retained_layered(target, release)
        # The adapter retains Linux target/runtime/ABI/glibc/ELF and font checks.
        # Candidate metadata is checked only after start, never demanded of B0.
        r.owned(target / '.manifest-sha256')
        if (target / '.manifest-sha256').read_text().strip() != policy['candidateManifestSha256']:
            raise ValueError('Candidate differs from reviewed Linux manifest')
    def check_legacy(self, release, operation, process, policy):
        self.legacy.wait_healthy(r.ROOT / 'releases' / release)
        if self.process() != process: raise RuntimeError('Legacy PID/start changed during genuine readiness')
        now = time.time()
        request = {'schemaVersion': 1, 'verifierProtocol': f.LEGACY_PROTOCOL, 'operationId': operation,
                   'backendRelease': release, 'pid': process['pid'], 'processStart': process,
                   'nonce': secrets.token_hex(32), 'createdAt': now, 'expiresAt': now + 120}
        f.tx.atomic_json(r.VERIFICATION, request)
        deadline = time.monotonic() + 110
        while True:
            try:
                f.validate_legacy_receipt(r.bounded_json(r.RECEIPT), request, operation=operation, release=release, pid=process['pid'], now=time.time())
                f.validate_legacy_audit(r.bounded_json(AUDIT), request, policy, time.time())
                if self.process() != process or self.current() != release: raise RuntimeError('Legacy live identity drift')
                return process
            except (OSError, ValueError): pass
            if time.monotonic() >= deadline: raise RuntimeError('Genuine legacy safe-read receipt and separate wallet/ledger SELECT audit missing')
            time.sleep(0.25)


def checked_journal(ops, operation=None):
    record = r.bounded_json(JOURNAL)
    policy = ops.first_policy()
    f.validate_record(record, policy, operation or policy['operationId'], f.digest(ops.completion()))
    return record


def accept(args, ops):
    protocol = r.load(HERE / 'receipt.py', 'first_window_receipt_accept')
    journal_dir = JOURNAL.parent
    private = journal_dir / 'receipt-stage'
    if not private.exists(): private.mkdir(mode=0o700)
    r.owned(private, directory=True)
    lock_path = journal_dir / 'receipt.lock'
    if os.path.lexists(lock_path): r.owned(lock_path)
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = checked_journal(ops, args.operation_id)
        policy = ops.first_policy()
        coordinator = f.FirstWindow(ops, r.CONTROL, JOURNAL)
        coordinator.context(policy, completion_sha256=record['completionSha256'])
        if r.bounded_json(r.CONTROL, 1024) != {'schemaVersion': 2, 'operationId': args.operation_id, 'mode': 'checking'}:
            raise ValueError('Receipt requires exact checking epoch')
        if r.bounded_json(CHECKING, 1024) != f.seal_token(policy): raise ValueError('Exact external checking epoch required')
        request = r.bounded_json(r.VERIFICATION, 4096)
        legacy = request.get('verifierProtocol') == f.LEGACY_PROTOCOL
        validators = {}
        if legacy:
            def legacy_journal(value, *, operation, release):
                if (value != checked_journal(ops, operation) or value.get('phase') != 'checking_legacy'
                        or value.get('old') != release or value.get('verificationTarget') != release
                        or value.get('recoveryProcess') != request['processStart']): raise ValueError('Legacy check journal mismatch')
            validators = {'request_validator': f.validate_legacy_request, 'receipt_validator': f.validate_legacy_receipt, 'journal_validator': legacy_journal}
        elif record.get('phase') != 'checking' or request.get('backendRelease') != record['target']:
            raise ValueError('Only exact candidate or legacy verification phases accept receipts')
        def live_pid():
            if legacy:
                process = ops.process()
                if process != request['processStart']: raise ValueError('Legacy live process identity changed')
                return process['pid']
            status = ops.status()
            if status.get('backendRelease') != args.sha or status.get('admissionEpoch') != args.operation_id or status.get('admissionMode') != 'checking':
                raise ValueError('Candidate has not observed exact checking epoch')
            if ops.process() != record.get('candidateProcess') or status['pid'] != record['candidateProcess']['pid']:
                raise ValueError('Candidate exact process-start identity changed')
            return status['pid']
        incoming = r.ROOT / 'incoming'
        r.owned(incoming.parent, directory=True)
        incoming_fd = os.open(incoming, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            receipt = protocol.accept_incoming(incoming_fd, private, request=request, journal=lambda: checked_journal(ops, args.operation_id),
                operation=args.operation_id, release=args.sha, pid=args.pid, expected_sha256=args.expected_receipt_sha256,
                current_release=ops.current, live_pid=live_pid, **validators)
        finally: os.close(incoming_fd)
        coordinator.context(policy, completion_sha256=record['completionSha256'])
        if (r.bounded_json(r.VERIFICATION, 4096) != request or checked_journal(ops, args.operation_id) != record
                or r.bounded_json(r.CONTROL, 1024) != {'schemaVersion': 2, 'operationId': args.operation_id, 'mode': 'checking'}):
            raise ValueError('Trusted verification state changed before receipt installation')
        f.tx.atomic_json(r.RECEIPT, receipt)
        print(json.dumps({'schemaVersion': 1, 'accepted': True, 'operationId': args.operation_id, 'backendRelease': args.sha,
                          'pid': args.pid, 'requestSha256': receipt['requestSha256']}, sort_keys=True))


def mutate_locked(args, ops, adapter, legacy):
    """Called only inside the shared deploy lock; compare approvals before work."""
    coordinator = f.FirstWindow(ops, r.CONTROL, JOURNAL)
    policy, _ = coordinator.approvals(args.expected_policy_sha256, args.expected_completion_sha256)
    approvals = {'expected_policy_sha256': args.expected_policy_sha256,
                 'expected_completion_sha256': args.expected_completion_sha256}
    if args.command in FRONTEND_COMMANDS:
        # Validate the complete cross-directory import closure before executing it.
        r.owned(FRONTEND_TOOLS, directory=True)
        for name in ('release.py', 'manifest.py', 'transport.py'): r.owned(FRONTEND_TOOLS / name)
        frontend = r.load(FRONTEND_TOOLS / 'release.py', 'first_window_frontend')
        frontend.production_preflight()
        b.FrontendBootstrap(coordinator, None).approvals(args.operation_id, args.expected_policy_sha256,
                                                        args.expected_completion_sha256)
        publisher = frontend.Publisher(r.ROOT, probe=frontend.production_bootstrap_probe,
                                       meta=frontend.production_meta, approval=frontend.production_approval)
        bootstrap = b.FrontendBootstrap(coordinator, publisher)
        parameters = (args.operation_id, args.expected_policy_sha256, args.expected_completion_sha256)
        if args.command == 'prepare-frontend': result = bootstrap.prepare(*parameters)
        elif args.command == 'frontend-deploy': result = bootstrap.deploy(*parameters, args.outer_sha256)
        elif args.command == 'frontend-rollback': result = bootstrap.rollback(*parameters)
        else: result = bootstrap.open(*parameters)
        return {'schemaVersion': 1, 'bootstrapResult': result,
                'productionReady': args.command == 'frontend-open' and result.get('phase') == 'committed'}
    if args.command == 'recover':
        return {'schemaVersion': 1, 'firstWindowJournal': coordinator.recover(args.operation_id, **approvals), 'productionReady': False}
    f.validate_policy(policy, args.operation_id, args.expected_current, args.sha, time.time())
    if args.manifest_sha256 != policy['candidateManifestSha256']: raise ValueError('Incoming candidate manifest not approved')
    coordinator.context(policy, completion_sha256=args.expected_completion_sha256, original=True, completion=True)
    if ops.current() != args.expected_current or JOURNAL.exists(): raise ValueError('First window already started or current drift')
    legacy.activate = lambda target, **_: coordinator.run(target.name, args.expected_current, args.operation_id, **approvals)
    adapter.locked = nullcontext
    adapter.deploy(args.sha, args.outer_sha256, args.manifest_sha256, args.run_number)
    return {'schemaVersion': 1, 'firstWindowJournal': r.bounded_json(JOURNAL), 'productionReady': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    run = commands.add_parser('run')
    for key in ('sha', 'outer_sha256', 'manifest_sha256', 'run_number', 'expected_current', 'operation_id', 'expected_policy_sha256', 'expected_completion_sha256'): run.add_argument(key)
    recover = commands.add_parser('recover')
    for key in ('operation_id', 'expected_policy_sha256', 'expected_completion_sha256'): recover.add_argument(key)
    for name in FRONTEND_COMMANDS:
        command = commands.add_parser(name)
        for key in ('operation_id', 'expected_policy_sha256', 'expected_completion_sha256'): command.add_argument(key)
        if name == 'frontend-deploy': command.add_argument('outer_sha256')
    commands.add_parser('status'); commands.add_parser('verification-request')
    receipt = commands.add_parser('accept-receipt')
    for key in ('operation_id', 'sha'): receipt.add_argument(key)
    receipt.add_argument('pid', type=int); receipt.add_argument('expected_receipt_sha256')
    args = parser.parse_args()
    if os.geteuid() != 0 or not sys.flags.isolated: raise RuntimeError('Requires root and isolated Python')
    for name in ('first-window.py', 'first_window.py', 'frontend_bootstrap.py', 'release.py', 'transaction.py', 'receipt.py', 'verify.py', 'http-admission.cjs', 'backend-lifecycle.conf', 'backend-legacy.conf'):
        r.owned(HERE / name)
    r.owned(r.ROOT, directory=True); r.owned(JOURNAL.parent, directory=True)
    if os.path.lexists(r.SERVICE_DROPIN):
        r.owned(r.SERVICE_DROPIN)
        if r.SERVICE_DROPIN.read_bytes() not in tuple((HERE / name).read_bytes() for name in ('backend-lifecycle.conf', 'backend-legacy.conf')): raise ValueError('Unreviewed candidate/legacy drop-in drift')
    r.owned(INGRESS.parent, directory=True)
    if __import__('stat').S_IMODE(INGRESS.parent.stat().st_mode) != 0o755: raise ValueError('Ingress flags require root-owned directory mode 0755')
    r.bounded_json(r.CONTROL, 1024)
    if args.command == 'verification-request':
        print(json.dumps(r.bounded_json(r.VERIFICATION, 4096), sort_keys=True)); return
    bridge = r.load(r.TOOLS / 'release-three-layer.py', 'first_window_layers')
    layers, legacy = bridge.load_tools(strict=True)
    with bridge.safe_node_environment():
        adapter = bridge.Adapter(r.ROOT, layers, legacy, native_check=lambda *_: None)
        ops = FirstOps(adapter, legacy)
        if args.command == 'accept-receipt': accept(args, ops); return
        with adapter.locked():
            coordinator = f.FirstWindow(ops, r.CONTROL, JOURNAL)
            policy = ops.first_policy()
            if args.command == 'status':
                retained = r.bounded_json(JOURNAL) if JOURNAL.exists() else None
                if retained is not None and retained.get('writesMayHaveOpened') is True:
                    f.validate_record(retained, policy, policy['operationId'], f.digest(ops.completion()), allow_opened_status=True)
                    print(json.dumps({'schemaVersion': 1, 'kind': 'first-window', 'current': ops.current(),
                        'currentProcess': ops.process(), 'journal': retained, 'admission': r.bounded_json(r.CONTROL, 1024),
                        'ingressOpen': ops.ingress_open_exists(), 'automaticLegacyRecoveryAllowed': False}, sort_keys=True))
                    return
                if retained is not None and retained.get('phase') == 'backend_ready' and 'frontendBootstrap' in policy:
                    f.validate_record(retained, policy, policy['operationId'], f.digest(ops.completion()))
                    print(json.dumps({'schemaVersion': 1, 'kind': 'first-window', 'current': ops.current(),
                        'currentProcess': ops.process(), 'journal': retained, 'admission': r.bounded_json(r.CONTROL, 1024),
                        'frontendChecking': ops.frontend_checking(), 'frontendCurrentExists': ops.frontend_current_exists(),
                        'ingressOpen': ops.ingress_open_exists(), 'ingressConfigSha256': ops.ingress_digest(policy),
                        'bootstrapStatusOnly': True, 'productionReady': False}, sort_keys=True))
                    return
                record = checked_journal(ops) if JOURNAL.exists() else None
                coordinator.context(policy, completion_sha256=record['completionSha256'] if record else None,
                                    original=record is None, completion=record is None)
                gate = r.bounded_json(r.CONTROL, 1024)
                if gate not in ({'schemaVersion': 2, 'operationId': policy['operationId'], 'mode': mode} for mode in ('draining', 'checking')):
                    raise ValueError('Status requires exact sealed backend admission epoch')
                current = ops.current()
                if current not in (policy['old'], policy['target']) or record is None and current != policy['old']:
                    raise ValueError('Exact current drift')
                print(json.dumps({'schemaVersion': 1, 'kind': 'first-window', 'current': current, 'frontend': None,
                    'legacyProcess': policy['oldProcess'], 'currentProcess': ops.process(), 'operationId': policy['operationId'],
                    'target': policy['target'], 'candidateManifestSha256': policy['candidateManifestSha256'], 'policySha256': f.digest(policy), 'completionSha256': f.digest(ops.completion()),
                    'preflight': 'reviewed-sealed' if record is None else 'journal-sealed', 'journal': record}, sort_keys=True)); return
            print(json.dumps(mutate_locked(args, ops, adapter, legacy), sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('First-window operation failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
