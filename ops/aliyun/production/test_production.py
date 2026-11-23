import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import check
import receive
import send

OLD = ('a'*40, 'release-'+'a'*12)
NEW = ('b'*40, 'release-'+'b'*40)


class ProcessFixture:
    """Host.switch uses real symlinks and starts an actual version-reporting child in each release."""
    def __init__(self, root):
        self.root = root
        self.fail = set()
        self.proc = None
        self.pid_history = []
        self.host = receive.Host.__new__(receive.Host)
        host = self.host
        host.front = root/'frontend'
        for sha, ns in (OLD, NEW):
            (root/'releases'/sha).mkdir(parents=True)
            (host.front/'releases'/ns).mkdir(parents=True)
        (host.front/'assets').mkdir()
        (host.front/'assets'/OLD[1]).symlink_to('../releases/'+OLD[1])
        (root/'current').symlink_to(root/'releases'/OLD[0])
        (host.front/'current').symlink_to('releases/'+OLD[1])
        host.adapter = SimpleNamespace(current_target=lambda: (root/'current').resolve(strict=True))
        host.process = lambda sha, pid: self.assert_process(sha, pid)
        host.tx = SimpleNamespace(gate=self.gate, drain=lambda sha, op, pid: self.assert_process(sha, pid))
        host.ops = SimpleNamespace(service_stopped=lambda: self.proc is None or self.proc.poll() is not None,
                                   service_pid=lambda: self.proc.pid, stop=self.stop, native=lambda sha: None,
                                   select=self.select, start=self.start)
        host.operation = 'release-'+NEW[0]
        host.ingress_open = root/'ingress-open.json'
        host.saved_open = root/'production-saved-open.json'
        host.ingress_open.write_text('open')
        host.open_inode = host.ingress_open.stat()
        host.checks = check
        host.http_get = lambda url: (503, '{"code":"network"}') if not host.ingress_open.exists() else (200, '{}')
        host.await_boot = self.await_boot
        host.booting = None
        host.stop_attempted = False
        host.check_database = lambda: None
        host.record = lambda data: (root/'state.json').write_text(json.dumps(data))
        host.public = self.public
        host.check = self.check
        host.open = lambda pair: (self.check(pair), self.gate(host.operation, 'open'))
        self.start()

    def await_boot(self, sha):
        self.host.check_seal()
        if sha == NEW[0] and 'no-socket' in self.fail:
            self.host.tx.drain = Mock(side_effect=RuntimeError('socket missing'))
            raise RuntimeError('Live candidate cannot report lifecycle')
        self.assert_process(sha, self.proc.pid)

    def assert_process(self, sha, pid):
        if pid != self.proc.pid or self.proc.poll() is not None or Path('/proc', str(pid), 'cwd').resolve().name != sha:
            raise RuntimeError('Live process mismatch')

    def check(self, pair):
        self.assert_process(pair[0], self.proc.pid)
        if (self.host.front/'current').resolve().name != pair[1] or self.report != pair[0]:
            raise RuntimeError('Selected pair mismatch')

    def public(self, phase, pair):
        if phase in self.fail:
            raise ConnectionError('Public observation failed')
        self.check(pair)

    def gate(self, operation, mode):
        (self.root/'gate').write_text(mode)

    def select(self, sha, expected):
        current = self.root/'current'
        if current.resolve().name != expected:
            raise RuntimeError('Unexpected predecessor')
        tmp = self.root/'next'
        tmp.symlink_to(self.root/'releases'/sha)
        os.replace(tmp, current)

    def start(self):
        release = (self.root/'current').resolve()
        code = ("import os, time; print(os.path.basename(os.getcwd()), flush=True); time.sleep(120)"
                if release.name not in self.fail else "import sys; sys.exit(42)")
        self.proc = subprocess.Popen([sys.executable, '-c', code], cwd=release, stdout=subprocess.PIPE, text=True)
        self.pid_history.append(self.proc.pid)
        self.report = self.proc.stdout.readline().strip()
        if not self.report:
            raise RuntimeError(f'Service failed to start ({self.proc.wait()})')

    def stop(self):
        if self.proc is not None:
            self.proc.terminate()
            self.proc.wait(timeout=5)
            self.proc.stdout.close()
            self.proc = None


class Transactions(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fx = ProcessFixture(Path(tmp.name))
        self.addCleanup(self.fx.stop)

    def run_release(self, *fail):
        self.fx.fail.update(fail)
        code = receive.activate(self.fx.host, OLD, NEW, 8)
        state = json.loads((self.fx.root/'state.json').read_text())
        return code, state['phase'], (self.fx.root/'gate').read_text()

    def test_success_starts_matching_pair_and_retains_old(self):
        self.assertEqual(self.run_release(), (0, 'committed', 'open'))
        self.fx.check(NEW)
        self.assertTrue((self.fx.root/'releases'/OLD[0]).is_dir())
        self.assertTrue((self.fx.host.front/'releases'/OLD[1]).is_dir())

    def test_failed_start_actually_restarts_retained_release(self):
        self.assertEqual(self.run_release(NEW[0]), (20, 'restored', 'open'))
        self.fx.check(OLD)
        self.assertEqual(len(set(self.fx.pid_history)), 3)

    def test_live_unobservable_candidate_is_stopped_behind_verified_nginx_fence(self):
        self.assertEqual(self.run_release('no-socket'), (20, 'restored', 'open'))
        self.fx.check(OLD)
        self.fx.host.tx.drain.assert_not_called()
        self.assertTrue(self.fx.host.ingress_open.is_file())

    def test_failed_rollback_is_closed_and_needs_attention(self):
        self.assertEqual(self.run_release(NEW[0], OLD[0]), (21, 'needs_attention', 'draining'))

    def test_post_open_failure_recovers_only_after_both_old_checks(self):
        self.assertEqual(self.run_release('live'), (20, 'restored', 'open'))
        self.fx.check(OLD)

    def test_restored_process_without_public_confirmation_stays_closed(self):
        self.assertEqual(self.run_release(NEW[0], 'restoration'), (21, 'needs_attention', 'draining'))
        self.fx.check(OLD)


class InputChecks(unittest.TestCase):
    def test_truncated_wire_body_rejected(self):
        with tempfile.TemporaryDirectory() as d, self.assertRaises(EOFError):
            receive.read_exact(io.BytesIO(b'123'), Path(d)/'pair.tar', 4)

    def test_parent_path_and_link_rejected_before_materialization(self):
        for name, kind in [('frontend/../bad', tarfile.REGTYPE), ('frontend/x', tarfile.SYMTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                with tarfile.open(root/'pair.tar', 'w') as arc:
                    entry = tarfile.TarInfo(name)
                    entry.type = kind
                    arc.addfile(entry)
                with self.assertRaises(ValueError):
                    receive.unpack(root/'pair.tar', root)
                self.assertFalse((root/'frontend').exists())

    def test_verification_pins_workflow_ref_both_digests_and_host_trust(self):
        with patch.object(subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'gh')) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                receive.verify(Path('pair.tar'), Path('bundle'), NEW[0])
        args = run.call_args.args[0]
        for flag, expected in [('--source-digest', NEW[0]), ('--signer-digest', NEW[0]),
                               ('--source-ref', 'refs/heads/main'), ('--signer-workflow', receive.WORKFLOW),
                               ('--custom-trusted-root', '/etc/zimage/production-trusted-root.jsonl')]:
            self.assertEqual(args[args.index(flag)+1], expected)
        self.assertIn('--deny-self-hosted-runners', args)

    def test_network_exit_and_false_restoration_never_succeed(self):
        for code in (0, 20, 21, 255):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as d:
                file = Path(d)/'a'
                file.write_bytes(b'123')
                proc = SimpleNamespace(stdin=io.BytesIO(), stdout=io.BytesIO(), wait=lambda: code)
                with self.assertRaisesRegex(RuntimeError, 'incomplete'):
                    send.deliver(proc, NEW[0], file, file)

    def test_wrong_public_version_rejected(self):
        with patch.object(check, 'fetch', return_value=b'{}'), self.assertRaises(ValueError):
            check.probe(*NEW)

    def test_wrong_target_rejected(self):
        management = Mock()
        management.bounded_json.return_value = {'instanceId': 'i-reviewed'}
        with patch.object(Path, 'read_text', return_value='i-other'), self.assertRaisesRegex(ValueError, 'Wrong ECS'):
            receive.target_policy(management)

    def test_database_mismatch_before_mutation(self):
        host = receive.Host.__new__(receive.Host)
        host.management = Mock()
        host.management.bounded_json.return_value = dict(instanceId='i-fixture', compatibleMigrationTrees=['a'*40])
        meta = dict(run=1, sha=NEW[0], manifest='d'*64, migrations='b'*40)
        with patch.object(Path, 'read_text', return_value='i-fixture'), self.assertRaisesRegex(ValueError, 'Database'):
            host.preflight(NEW[0], meta)
        host.management.service_launch_preflight.assert_not_called()


class Channel(unittest.TestCase):
    def test_verifier_rejects_before_unpack(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(receive, 'verify', side_effect=ValueError('untrusted')), \
                patch.object(receive, 'unpack') as unpack:
            with self.assertRaisesRegex(ValueError, 'untrusted'):
                receive.receive_pair(io.BytesIO(b'proofarchive'), Path(tmp), NEW[0], 5, 7)
            unpack.assert_not_called()

    def test_distinct_process_cannot_enter_the_existing_deploy_lock(self):
        adapter = receive.load(Path(receive.__file__).resolve().parents[1]/'release-three-layer.py')
        with tempfile.TemporaryDirectory() as tmp:
            instance = adapter.Adapter.__new__(adapter.Adapter)
            instance.root, instance.uid = Path(tmp), os.getuid()
            probe = """import fcntl, sys
with open(sys.argv[1], 'r+') as f:
    try: fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: sys.exit(9)
"""
            cmd = [sys.executable, '-c', probe, str(instance.root/'deploy.lock')]
            with instance.locked():
                self.assertEqual(subprocess.run(cmd).returncode, 9)
            self.assertEqual(subprocess.run(cmd).returncode, 0)

    def test_sender_and_receiver_share_one_bounded_session(self):
        child = """
import sys, receive, kit
kit_id, sha, proof_size, size = sys.stdin.buffer.readline().split()
assert kit_id.decode() == kit.identity(kit.source_contents())
assert sys.stdin.buffer.read(int(proof_size)) == b'proof'
assert sys.stdin.buffer.read(int(size)) == b'contents'
old = ('a'*40, 'release-'+'a'*12)
new = (sha.decode(), 'release-'+sha.decode())
for phase, pair in [('before',old), ('candidate',new), ('live',new)]:
    receive.public(phase, pair)
"""
        with tempfile.TemporaryDirectory() as tmp, patch.object(send, 'probe') as probe:
            root = Path(tmp)
            bundle, pair = root/'proof.json', root/'pair.tar'
            bundle.write_bytes(b'proof')
            pair.write_bytes(b'contents')
            with subprocess.Popen([sys.executable, '-B', '-c', child], cwd=Path(receive.__file__).parent,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
                send.deliver(process, NEW[0], pair, bundle)
            self.assertEqual([call.args for call in probe.call_args_list], [OLD, NEW, NEW])
