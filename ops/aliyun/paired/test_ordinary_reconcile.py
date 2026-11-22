import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

import core
import ordinary
from ordinary_journal import JournalGate
from ordinary_staging import StageBinding
from system import Paths, SystemOps
from test_ordinary import Fixture
from test_ordinary_staging import Authority, receipts


OLD_OPEN = {'operationId': 'previous-local-generation'}
OLD_NODE = dict(schemaVersion=2, operationId=OLD_OPEN['operationId'], mode='open')


def atomic_json(path, value, mode=0o644):
    fd, name = tempfile.mkstemp(dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(core.canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        core.sync(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def point(root, name, target):
    next_path = root / (name + '.next')
    next_path.symlink_to(target)
    next_path.replace(root / name)


class RecoverySystem(SystemOps):
    """Real gate writes and pointers, synthetic service and artifact authority."""
    def __init__(self, root, fixture, fault=''):
        self.fault = fault
        self.root = root
        old, new = fixture.a['oldPair'], fixture.a['newPair']
        policy = dict(operationId=fixture.a['operation'], oldBackend=old['backend'], oldFrontend=old['frontend'],
                      newBackend=new['backend'], newFrontend=new['frontend'],
                      backendManifestSha256=fixture.packet['backendManifestSha256'])
        modules = SimpleNamespace(
            backend=SimpleNamespace(current=lambda: os.readlink(root/'backend')),
            first=SimpleNamespace(process=self.process, service_metadata=lambda: {'synthetic': True}),
            publisher=SimpleNamespace(current=lambda: os.readlink(root/'frontend-current'), read_json=self.read,
                                      sealed=lambda namespace: {'artifactId': ('a' if namespace == new['frontend'] else 'b') * 64}),
            transaction=SimpleNamespace(atomic_json=self.write_gate))
        super().__init__(policy, core, modules, paths=Paths(root, root/'etc'), owner_uid=os.getuid(), anchor=root)
        self.lifecycle = SimpleNamespace(observed=self.observe, drain=self.local_drain)
        self.checkpoint = self.crash

    def process(self):
        identity = json.loads((self.root/'process.json').read_bytes())
        if identity is not None:
            os.kill(identity['pid'], 0)
        return identity

    def observe(self, release, operation=None, pid=None):
        self.exact_process(self.process())
        if self.process()['pid'] != pid or self.backend.current() != release:
            raise ValueError('Wrong local peer')
        gate = self.read(self.paths.control)
        if operation is not None and gate['operationId'] != operation:
            raise ValueError('Wrong local gate epoch')
        mode = gate['mode']
        return dict(admissionMode=mode, admissionEpoch=gate['operationId'], maintenance=mode != 'open',
                    activeHttpRequests=0, activeFrameworkWork=0, counters={}, drained=True)

    def local_drain(self, release, operation, pid, timeout):
        return self.observe(release, operation, pid)

    def crash(self, checkpoint):
        if checkpoint == self.fault:
            os.kill(os.getpid(), signal.SIGKILL)

    def write_gate(self, path, value, mode):
        atomic_json(path, value, mode)
        if path == self.paths.maintenance:
            self.crash('hold-maintenance')

    def seal_probe(self):
        if self.marker_mode() != 'sealed':
            raise ValueError('Local ingress marker seal absent')

    def ingress_digest(self): return 'c' * 64
    def wait_checking_ready(self, *args): pass
    def validate_backend(self, release, manifest): pass
    def probe(self, record): self.exact_process(record['candidateProcess'])
    def complete(self, record, *, recovery): self.exact_process(record['candidateProcess'])
    def prepare_frontend(self, record, approval): self.exact_process(record['candidateProcess'])

    def stop(self, record, process):
        self.exact_process(process)
        atomic_json(self.root/'process.json', None)

    def select_backend(self, record):
        point(self.root, 'backend', self.p['newBackend'])

    def start(self, record, release):
        identity = self.read(self.root/'candidate.json')
        atomic_json(self.root/'process.json', identity)
        self.node_gate('checking')
        self.put(self.paths.checking, self.token())
        return self.snapshot()

    def publish_frontend(self, record, approval):
        point(self.root, 'frontend-current', self.p['newFrontend'])
        atomic_json(self.root/'frontend/sequence.json', {'sequence': 2})
        return self.snapshot()


def initialize_site(root, fixture, system, old_process, candidate_process):
    (root/'ordinary-operations').mkdir(0o700)
    (root/'deploy.lock').touch(mode=0o600)
    (root/'frontend').mkdir()
    system.paths.etc.mkdir()
    system.put(system.paths.open, OLD_OPEN)
    system.put(system.paths.control, OLD_NODE)
    pair = fixture.a['oldPair']
    point(root, 'backend', pair['backend'])
    point(root, 'frontend-current', pair['frontend'])
    atomic_json(root/'frontend/sequence.json', {'sequence': 1})
    atomic_json(root/'process.json', old_process)
    atomic_json(root/'candidate.json', candidate_process)


def run_worker(root, action, fault, *, system_type=RecoverySystem):
    fixture = Fixture()
    system = system_type(root, fixture, fault)
    gate = JournalGate(root, core, owner_uid=os.getuid())
    binding = StageBinding(gate, system, Authority(fixture), receipts, clock=lambda: 100)
    approval = ordinary.sha(fixture.a)
    if action == 'publish':
        return ordinary.transition(fixture.packet, fixture.a, approval, binding, clock=lambda: 100)
    if fault == 'wrong-policy':
        system.p['backendManifestSha256'] = 'e' * 64
    if fault == 'wrong-approval':
        approval = 'f' * 64
    operation = 'other-exact-operation' if fault == 'wrong-operation' else fixture.a['operation']
    return binding.reconcile_open(operation, approval)


class RecoveryTests(unittest.TestCase):
    def configure(self):
        temporary = tempfile.TemporaryDirectory(prefix='zimage-ordinary-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.f = Fixture()
        self.system = RecoverySystem(self.root, self.f)
        old = self.service(1)
        self.candidate = self.service(2)
        initialize_site(self.root, self.f, self.system, old, self.candidate)

    def service(self, start_ticks):
        proc = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'import time; time.sleep(60)'])
        self.addCleanup(proc.wait, timeout=5)
        self.addCleanup(proc.terminate)
        return dict(pid=proc.pid, startTicks=start_ticks, bootId='11111111-1111-1111-1111-111111111111')

    def worker(self, action, fault='', code=0):
        result = subprocess.run([sys.executable, '-B', __file__, str(self.root), action, fault],
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, code, result.stderr)
        return json.loads(result.stdout) if code == 0 else result.stderr

    def gate_bytes(self):
        return {path.name: (path.read_bytes(), path.stat().st_ino) for path in self.system.paths.etc.iterdir()}

    def assert_held(self):
        observed = self.system.snapshot()
        self.assertEqual(observed['ingressMode'], 'sealed')
        self.assertEqual(observed['nodeMode'], 'draining')
        self.assertEqual(observed['process'], self.candidate)
        self.assertEqual({key: observed[key] for key in ('backend', 'frontend')}, self.f.a['newPair'])
        gate = JournalGate(self.root, core, owner_uid=os.getuid())
        with gate.lock(), self.assertRaisesRegex(ValueError, 'Unfinished ordinary'):
            gate.assert_no_unresolved()

    def test_recovers_two_sigkill_boundaries_and_keeps_uncertain_operation(self):
        for boundary in ('new_open_installed', 'ingress_open'):
            with self.subTest(boundary=boundary):
                self.configure()
                self.worker('publish', boundary, code=-signal.SIGKILL)
                self.assertEqual(self.system.read(self.system.paths.open), self.system.token())
                if boundary == 'ingress_open':
                    self.assertEqual(self.system.marker_mode(), 'open')
                result = self.worker('reconcile')
                self.assertEqual(result, dict(operation=self.f.a['operation'], phase='writes-may-open', held=True))
                self.assert_held()
                held = self.gate_bytes()
                self.worker('reconcile')
                self.assertEqual(self.gate_bytes(), held)

    def test_retry_after_recovery_dies_partway_through_hold(self):
        self.configure()
        self.worker('publish', 'ingress_open', code=-signal.SIGKILL)
        self.worker('reconcile', 'hold-maintenance', code=-signal.SIGKILL)
        self.assertEqual(self.system.read(self.system.paths.maintenance), self.system.token())
        self.assertEqual(self.system.read(self.system.paths.open), self.system.token())
        self.assertFalse(self.system.paths.frontend_fence.exists())
        self.worker('reconcile')
        self.assert_held()

    def test_completed_open_is_a_no_op(self):
        self.configure()
        self.worker('publish')
        before = self.gate_bytes()
        self.assertEqual(self.worker('reconcile')['phase'], 'opened')
        self.assertEqual(self.gate_bytes(), before)

    def test_rejects_wrong_identity_without_gate_writes(self):
        self.configure()
        self.worker('publish', 'ingress_open', code=-signal.SIGKILL)
        before = self.gate_bytes()
        for fault in ('wrong-operation', 'wrong-policy', 'wrong-approval'):
            with self.subTest(fault=fault):
                self.worker('reconcile', fault, code=1)
                self.assertEqual(self.gate_bytes(), before)
        atomic_json(self.root/'process.json', dict(self.candidate, startTicks=999))
        self.assertIn('process evidence differs', self.worker('reconcile', code=1))
        self.assertEqual(self.gate_bytes(), before)
        atomic_json(self.root/'process.json', self.candidate)
        self.system.put(self.system.paths.open, OLD_OPEN)
        foreign = self.gate_bytes()
        self.assertIn('Foreign ordinary gate ownership', self.worker('reconcile', code=1))
        self.assertEqual(self.gate_bytes(), foreign)
        self.system.put(self.system.paths.open, self.system.token())
        lock = self.root/'deploy.lock'
        lock.rename(self.root/'retained-old-lock')
        lock.touch(mode=0o600)
        replaced = self.gate_bytes()
        self.assertIn('deployment lock differs', self.worker('reconcile', code=1))
        self.assertEqual(self.gate_bytes(), replaced)


if __name__ == '__main__':
    root, action, fault = sys.argv[1:]
    print(json.dumps(run_worker(Path(root), action, fault)))
