from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest

import core
import ordinary
from ordinary_journal import JournalGate
from ordinary_staging import StageBinding
from system import Paths, SystemOps
from test_ordinary import Fixture


SPEC = importlib.util.spec_from_file_location('staging_backend_receipt', Path(__file__).parents[1] / 'backend/receipt.py')
receipts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receipts)

SERVICE = """
import json, os, socket, sys
sock = socket.socket(socket.AF_UNIX)
sock.bind(sys.argv[1]); os.chmod(sys.argv[1], 0o600); sock.listen()
while True:
    conn, _ = sock.accept()
    with conn:
        if conn.recv(128) == b'status':
            conn.sendall(json.dumps(dict(pid=os.getpid(), release=sys.argv[2])).encode())
"""


class LocalSystem(SystemOps):
    """Actual ephemeral pointers and socket, test-only service/verification."""
    def __init__(self, root, policy, state):
        self.anchor, self.paths, self.p, self.c = root, Paths(root, root / 'etc'), policy, core
        self.paths.etc.mkdir()
        self.root = root
        self.state = dict(state, frontendSequence=1)
        self.child = None
        self.mode = 'open'
        self.starts = []
        self.holds = 0
        self.open_fails = False
        for field in ('backend', 'frontend'):
            self.put_pointer(field, state[field])

    def put_pointer(self, kind, target):
        pending = self.root / (kind + '.next')
        pending.symlink_to(target)
        pending.replace(self.root / kind)

    def seal_probe(self): pass
    def wait_checking_ready(self, *args): pass
    def ingress_digest(self): return 'test-only'

    def peer(self):
        if self.child is None:
            return None
        with closing(socket.socket(socket.AF_UNIX)) as client:
            client.settimeout(1)
            client.connect(str(self.root / 'control.sock'))
            client.sendall(b'status')
            response = json.loads(client.recv(512))
        if response['pid'] != self.child.pid or response['release'] != os.readlink(self.root / 'backend'):
            raise ValueError('Fixture peer mismatch')
        return response

    def snapshot(self):
        frontend = os.readlink(self.root / 'frontend')
        node_mode = {'open': 'open', 'sealed': 'draining', 'checking': 'checking'}[self.mode]
        operation = self.p['operationId']
        token = self.token()
        markers = dict(maintenance=None, checking=None, open=None, frontend_fence=None)
        if self.mode == 'open':
            markers['open'] = token if frontend == self.p['newFrontend'] else dict(operationId='old-local')
        else:
            markers.update(maintenance=token, frontend_fence=token)
            if self.mode == 'checking':
                markers['checking'] = token
        return dict(backend=os.readlink(self.root/'backend'), frontend=frontend,
                    process=self.peer(), markers=markers, fence=None if self.mode=='open' else operation,
                    nodeMode=node_mode, nodeGate=dict(schemaVersion=2, operationId=operation, mode=node_mode),
                    ingressMode=self.mode, frontendSequence=self.state['frontendSequence'],
                    frontendArtifact='a'*64, configurationSha256='b'*64, ingressSha256='c'*64)

    def exact_process(self, expected):
        if expected is None or expected != self.peer():
            raise ValueError('Fixture peer identity drift')

    def validate_backend(self, release, manifest):
        if release != self.p['newBackend'] or manifest != self.p['backendManifestSha256']:
            raise ValueError('Fixture backend differs')

    def seal(self, record): self.mode = 'sealed'

    def drain(self, record, process):
        self.exact_process(process)
        self.mode = 'sealed'

    def close(self):
        if self.child is not None:
            self.child.terminate()
            self.child.wait(timeout=5)
            self.child = None
        (self.root / 'control.sock').unlink(missing_ok=True)

    def stop(self, record, process):
        self.exact_process(process)
        self.close()

    def select_backend(self, record):
        if self.child is not None or record['phase'] != 'backend_select_intent':
            raise ValueError('Fixture not stopped under backend intent')
        self.put_pointer('backend', self.p['newBackend'])

    def start(self, record, release):
        self.child = subprocess.Popen([sys.executable, '-I', '-B', '-c', SERVICE,
                                       str(self.root/'control.sock'), release],
                                      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.starts.append(self.child.pid)
        self.mode = 'checking' if record else 'open'
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and self.child.poll() is None:
            try: return self.snapshot()
            except OSError: time.sleep(0.025)
        raise ValueError('Fixture socket failed')

    def prepare_frontend(self, record, approval):
        self.exact_process(record['candidateProcess'])

    def publish_frontend(self, record, approval):
        self.exact_process(record['candidateProcess'])
        self.put_pointer('frontend', self.p['newFrontend'])
        self.state['frontendSequence'] += 1
        return self.snapshot()

    def probe(self, record): self.exact_process(record['candidateProcess'])
    def complete(self, record, recovery): self.exact_process(record['candidateProcess'])

    def open(self, record, process):
        self.exact_process(process)
        self.mode = 'open'
        if self.open_fails: raise ValueError('Fixture crash after writes may open')

    def hold(self, record):
        self.holds += 1
        self.mode = 'sealed'
        (self.root / 'quarantined').write_text(record['operationId'])


class Authority:
    """Synthetic receipt only; no online or authenticated staging claim."""
    def __init__(self, fixture):
        self.f = fixture
        self.wrong_nonce = False

    def current_main(self): return self.f.packet['commit']
    def database_fingerprint(self): return self.f.a['databaseSha256']

    def verify_inputs(self, packet, approval, initial):
        return dict(archiveSha256=approval['frontendArchiveSha256'], manifestSha256=approval['frontendManifestSha256'],
                    artifactId='a'*64, acceptanceSha256='b'*64)

    def authenticate(self, request, process, packet, approval):
        out = dict(schemaVersion=1, verifierProtocol=receipts.PROTOCOL, operationId=request['operationId'],
                   backendRelease=request['backendRelease'], pid=process['pid'],
                   nonce='f'*64 if self.wrong_nonce else request['nonce'],
                   requestSha256=receipts.request_digest(request), checkedAt=request['createdAt'],
                   authenticatedReadOnly=True, independentPublic=True, catalogReady=True,
                   checks=[dict(path=path,status=200,noStore=True,authenticated=i>=2) for i,path in enumerate(receipts.PATHS)])
        return out


class StagingBindingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='zs-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        if len(os.fsencode(self.root / 'control.sock')) > 103:
            self.skipTest('Unix socket path exceeds macOS limit')
        self.f = Fixture()
        (self.root/'deploy.lock').touch(mode=0o600)
        (self.root/'ordinary-operations').mkdir(0o700)
        self.gate = JournalGate(self.root, core, owner_uid=os.getuid())
        self.policy = dict(operationId=self.f.a['operation'], oldBackend=self.f.a['oldPair']['backend'],
                           newBackend=self.f.a['newPair']['backend'], oldFrontend=self.f.a['oldPair']['frontend'],
                           newFrontend=self.f.a['newPair']['frontend'], backendManifestSha256=self.f.packet['backendManifestSha256'])
        self.s = LocalSystem(self.root, self.policy, self.f.state)
        self.addCleanup(self.s.close)
        self.s.start(None, self.policy['oldBackend'])
        self.a = Authority(self.f)
        self.binding = StageBinding(self.gate, self.s, self.a, receipts, clock=lambda:100)

    def transition(self):
        return ordinary.transition(self.f.packet, self.f.a, ordinary.sha(self.f.a), self.binding, clock=lambda:100)

    def test_real_socket_and_pointer_switch_bound_to_durable_completed_record(self):
        result = self.transition()
        self.assertEqual(result['pair'], self.f.a['newPair'])
        self.assertEqual(self.s.snapshot()['process']['pid'], self.s.starts[-1])
        self.assertEqual(len(set(self.s.starts)), 2)
        self.assertEqual(self.s.mode, 'open')
        self.assertFalse((self.root/'quarantined').exists())
        self.assertEqual(core.Journal(self.root/'ordinary-operations'/self.f.a['operation'],
                                      owner_uid=os.getuid()).load()['phase'], 'opened')

    def test_bad_receipt_and_uncertain_open_keep_selected_pair_quarantined(self):
        for open_failure in (False, True):
            with self.subTest(after_open=open_failure):
                if open_failure: self.setUp()
                self.a.wrong_nonce = not open_failure
                self.s.open_fails = open_failure
                with self.assertRaises(ValueError): self.transition()
                self.assertEqual(self.s.holds, 1)
                self.assertEqual(self.s.mode, 'sealed')
                self.assertEqual(self.s.snapshot()['backend'], self.policy['newBackend'])
                with self.gate.lock(), self.assertRaisesRegex(ValueError, 'reconcile'):
                    self.gate.assert_no_unresolved()
                phase = core.Journal(self.root/'ordinary-operations'/self.f.a['operation'],
                                     owner_uid=os.getuid()).load()['phase']
                self.assertEqual(phase, 'writes-may-open' if open_failure else 'frontend-intent')

    def test_default_production_bound_probes_are_not_accepted(self):
        bound = SystemOps(self.policy, core, SimpleNamespace(backend=None, first=None, publisher=None),
                          paths=self.s.paths, owner_uid=os.getuid(), anchor=self.root)
        with self.assertRaisesRegex(ValueError, 'staging-specific'):
            StageBinding(self.gate, bound, self.a, receipts, clock=lambda:100)
