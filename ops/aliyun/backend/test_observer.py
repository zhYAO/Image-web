"""Independent observer: real protected temporary files, no production calls."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
from unittest import mock
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('isolated_observer', HERE / 'observer.py')
o = importlib.util.module_from_spec(spec) if spec else None
if spec and (HERE / 'observer.py').exists(): spec.loader.exec_module(o)


def body(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(value): return hashlib.sha256(value).hexdigest()
def process(pid): return {'pid': pid, 'startTicks': pid * 100, 'bootId': '12345678-1234-1234-1234-123456789abc'}


class Runtime:
    def __init__(self, snapshot):
        self.value = copy.deepcopy(snapshot); self.time = 1000; self.ticks = 0; self.on_wait = None
    def snapshot(self, policy): return copy.deepcopy(self.value)
    def wall(self): return self.time
    def monotonic(self): return self.ticks
    def wait(self, seconds):
        self.time += seconds; self.ticks += seconds
        if self.on_wait: self.on_wait()


class Fixture(unittest.TestCase):
    def setUp(self):
        self.assertTrue(hasattr(o, 'ProtectedFS'), 'independent ProtectedFS API is missing')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        (self.root / 'markers').mkdir(mode=0o700); (self.root / 'journal-dir').mkdir(mode=0o700)
        self.paths = {name: self.root / name for name in ('policy', 'receipt', 'open', 'maintenance', 'checking', 'journal', 'lock')}
        for name in ('open', 'maintenance', 'checking'): self.paths[name] = self.root / 'markers' / name
        self.paths['journal'] = self.root / 'journal-dir' / 'journal'
        self.paths['lock'].write_bytes(b''); self.paths['lock'].chmod(0o600)
        config = [{'path': path, 'sha256': 'c' * 64} for path in sorted(o.CONFIG_PATHS)]
        self.policy = {'schemaVersion': 1, 'protocol': 'zimage-ingress-observer-policy-v1', 'operationId': 'observer-20261030',
                       'release': 'a' * 40, 'process': process(42), 'currentTarget': '/opt/zimage/releases/' + 'a' * 40,
                       'nginxMaster': process(8), 'nginxWorkers': [process(9)], 'configFiles': config,
                       'helperFiles': [{'name': name, 'sha256': 'f' * 64} for name in ('observer.py', 'ingress-observe.py')],
                       'closureSha256': sha(body(config)), 'loadedReceiptSha256': '', 'openSha256': '',
                       'issuedAt': 900, 'expiresAt': 1200}
        opening = {'schemaVersion': 1, 'protocol': 'zimage-ingress-observer-open-v1',
                   'operationId': self.policy['operationId'], 'closureSha256': self.policy['closureSha256']}
        self.original_open = body(opening)
        self.policy['openSha256'] = sha(self.original_open)
        receipt = {key: copy.deepcopy(self.policy[key]) for key in ('operationId', 'release', 'process', 'currentTarget', 'nginxMaster', 'nginxWorkers', 'closureSha256')}
        receipt.update(schemaVersion=1, protocol='zimage-ingress-loaded-receipt-v1', oldGenerationsExited=True,
                       reviewedAt=950, coverage=[{'category': category, 'boundarySha256': 'b' * 64, 'outcome': 'reviewed-gate-boundary'}
                                                for category in ('public-http', 'public-https', 'existing-http2', 'loopback', 'direct-bind', 'internal-callers')])
        self.paths['receipt'].write_bytes(body(receipt)); self.policy['loadedReceiptSha256'] = sha(body(receipt))
        self.save_policy(); self.paths['open'].write_bytes(self.original_open)
        live = {key: copy.deepcopy(self.policy[key]) for key in ('release', 'process', 'currentTarget', 'nginxMaster', 'nginxWorkers', 'configFiles', 'helperFiles')}
        self.runtime = Runtime(live)
        self.fs = o.ProtectedFS(self.root, os.getuid())
        self.observer = o.Observer(self.fs, self.paths, self.runtime)
    def save_policy(self): self.paths['policy'].write_bytes(body(self.policy))
    def state(self): return tuple(os.path.lexists(self.paths[key]) for key in ('open', 'maintenance', 'checking'))
    def sealed(self):
        self.runtime.on_wait = lambda: (_ for _ in ()).throw(Crash())
        with self.assertRaises(Crash): self.observer.observe(2)
        self.runtime.on_wait = None
        self.assertEqual(self.state(), (False, True, False))
    def test_observe_deadline_restores_exact_original_open(self):
        result = self.observer.observe(2)
        self.assertEqual(result['phase'], 'cancelled'); self.assertEqual(result['code'], 'WINDOW_ENDED')
        self.assertEqual(self.paths['open'].read_bytes(), self.original_open)
        self.assertEqual(self.state(), (True, False, False)); self.assertFalse(result['completionAuthorized'])
        self.assertLessEqual(self.runtime.ticks, 2)
    def test_initial_journal_is_durable_before_first_marker(self):
        seen = []
        self.fs.failpoint = lambda event: seen.append((event, self.paths['journal'].exists()))
        self.observer.observe(1)
        self.assertTrue(next(journal for event, journal in seen if event == 'publish:maintenance:before'))
    def test_hard_crash_recovers_only_via_explicit_cancel(self):
        self.sealed(); result = self.observer.cancel()
        self.assertEqual(result['phase'], 'cancelled'); self.assertEqual(self.state(), (True, False, False))
    def test_repeat_observe_does_not_reseal_existing_operation(self):
        self.sealed(); result = self.observer.observe(1)
        self.assertEqual(result['code'], 'EXISTING_JOURNAL'); self.assertEqual(self.state(), (False, True, False))
    def test_cancel_accepts_expired_policy_without_changing_binding(self):
        self.sealed(); self.runtime.time = 1300
        self.assertEqual(self.observer.cancel()['phase'], 'cancelled')
    def test_new_observe_rejects_expired_policy(self):
        self.runtime.time = 1300
        self.assertEqual(self.observer.observe(1)['code'], 'POLICY_TIME'); self.assertFalse(self.paths['journal'].exists())
    def test_cancel_rejects_policy_changed_even_if_semantically_equivalent(self):
        self.sealed(); self.paths['policy'].write_bytes(body(self.policy) + b' ')
        self.assertEqual(self.observer.cancel()['code'], 'POLICY_BINDING'); self.assertEqual(self.state(), (False, True, False))
    def test_all_live_identity_drift_blocks_cancel(self):
        mutations = [('release', 'b' * 40), ('currentTarget', '/opt/zimage/releases/' + 'b' * 40),
                     ('process', process(43)), ('nginxMaster', process(10)), ('nginxWorkers', [process(11)]),
                     ('configFiles', [{'path': '/etc/nginx/nginx.conf', 'sha256': 'd' * 64}])]
        self.sealed(); baseline = copy.deepcopy(self.runtime.value)
        for key, value in mutations:
            with self.subTest(key=key):
                self.runtime.value = copy.deepcopy(baseline); self.runtime.value[key] = value
                self.assertEqual(self.observer.cancel()['code'], 'CONTROL_DRIFT'); self.assertEqual(self.state(), (False, True, False))
    def test_control_policy_and_receipt_drift_report_admission_uncertain(self):
        self.sealed(); baseline = copy.deepcopy(self.runtime.value)
        original_policy = self.paths['policy'].read_bytes(); original_receipt = self.paths['receipt'].read_bytes()
        mutations = [('CONTROL_DRIFT', lambda: self.runtime.value.update(nginxWorkers=[process(99)])),
                     ('POLICY_BINDING', lambda: self.paths['policy'].write_bytes(original_policy + b' ')),
                     ('RECEIPT_BINDING', lambda: self.paths['receipt'].write_bytes(original_receipt + b' '))]
        for code, mutate in mutations:
            with self.subTest(code=code):
                self.runtime.value = copy.deepcopy(baseline)
                self.paths['policy'].write_bytes(original_policy); self.paths['receipt'].write_bytes(original_receipt)
                mutate(); result = self.observer.cancel()
                self.assertEqual(result['code'], code)
                self.assertTrue(result['admissionMayBeOpen'], 'markers cannot prove drifted ingress coverage')
                self.assertEqual(self.state(), (False, True, False))
    def test_status_foreign_open_with_own_maintenance_reports_uncertain(self):
        self.sealed(); self.paths['open'].write_bytes(b'foreign')
        result = self.observer.status()
        self.assertEqual(result['code'], 'MARKER_FOREIGN')
        self.assertTrue(result['admissionMayBeOpen'])
    def test_policy_missing_any_config_closure_member_is_refused(self):
        self.policy['configFiles'] = [self.policy['configFiles'][0]]
        self.policy['closureSha256'] = sha(body(self.policy['configFiles'])); self.save_policy()
        self.assertEqual(self.observer.observe(1)['code'], 'POLICY_SCHEMA')
    def test_snapshot_exhausting_deadline_never_publishes_maintenance(self):
        original = self.runtime.snapshot
        def slow(policy):
            self.runtime.ticks += 5
            return original(policy)
        self.runtime.snapshot = slow; events = []; self.fs.failpoint = events.append
        result = self.observer.observe(1)
        self.assertNotIn('publish:maintenance:before', events)
        self.assertEqual(self.state(), (True, False, False)); self.assertEqual(result['code'], 'WINDOW_ENDED')
    def test_signal_before_first_maintenance_visibility_does_not_seal(self):
        original = self.runtime.snapshot; calls = []
        def signal_at_second_snapshot(policy):
            calls.append(True)
            if len(calls) == 2: self.observer.request_cancel()
            return original(policy)
        self.runtime.snapshot = signal_at_second_snapshot; events = []; self.fs.failpoint = events.append
        result = self.observer.observe(1)
        self.assertNotIn('publish:maintenance:before', events)
        self.assertEqual(self.state(), (True, False, False)); self.assertEqual(result['code'], 'CANCEL_REQUESTED')
    def test_pending_fsync_exhausting_budget_never_links_maintenance(self):
        original = self.fs.pending
        def slow_pending(path, contents):
            pending = original(path, contents)
            if path == self.paths['maintenance']: self.runtime.ticks += 2
            return pending
        self.fs.pending = slow_pending
        result = self.observer.observe(1)
        self.assertEqual(self.state(), (True, False, False)); self.assertEqual(result['code'], 'WINDOW_ENDED')
    def test_deadline_after_maintenance_visible_cancels_without_removing_open(self):
        events = []
        def after_visible(event):
            events.append(event)
            if event == 'publish:maintenance:after': self.runtime.ticks += 2
        self.fs.failpoint = after_visible
        result = self.observer.observe(1)
        self.assertNotIn('remove:open:before', events)
        self.assertEqual(self.state(), (True, False, False)); self.assertEqual(result['code'], 'WINDOW_ENDED')
    def test_policy_expiry_after_maintenance_visible_restores_old_admission(self):
        def expire(event):
            if event == 'publish:maintenance:after': self.runtime.time = self.policy['expiresAt'] + 1
        self.fs.failpoint = expire
        result = self.observer.observe(1)
        self.assertEqual(self.state(), (True, False, False)); self.assertEqual(result['phase'], 'cancelled')
        self.assertEqual(result['code'], 'POLICY_TIME')
    def test_existing_open_must_be_durable_before_maintenance_remove(self):
        self.sealed(); self.paths['open'].write_bytes(self.original_open)
        original = self.fs.sync_dir; events = []; self.fs.failpoint = events.append
        def fail_marker_barrier(path):
            if path == self.paths['open'].parent: raise OSError('barrier unavailable')
            return original(path)
        self.fs.sync_dir = fail_marker_barrier
        result = self.observer.cancel()
        self.assertTrue(result['needsAttention'])
        self.assertNotIn('remove:maintenance:before', events)
        self.assertEqual(self.state(), (True, True, False))
    def test_same_pid_start_and_boot_drift_block_cancel(self):
        self.sealed(); baseline = copy.deepcopy(self.runtime.value)
        for key, value in [('startTicks', 999), ('bootId', '22345678-1234-1234-1234-123456789abc')]:
            self.runtime.value = copy.deepcopy(baseline); self.runtime.value['process'][key] = value
            self.assertEqual(self.observer.cancel()['code'], 'CONTROL_DRIFT')
    def test_checking_drift_is_uncertain_and_never_deleted(self):
        self.sealed(); self.paths['checking'].write_bytes(b'foreign')
        result = self.observer.cancel()
        self.assertEqual(result['code'], 'CHECKING_DRIFT'); self.assertTrue(result['admissionMayBeOpen'])
        self.assertEqual(self.paths['checking'].read_bytes(), b'foreign')
    def test_foreign_maintenance_is_never_removed(self):
        self.sealed(); self.paths['maintenance'].write_bytes(b'foreign')
        self.assertEqual(self.observer.cancel()['code'], 'MARKER_FOREIGN'); self.assertEqual(self.paths['maintenance'].read_bytes(), b'foreign')
    def test_cancel_no_open_no_maintenance_refuses_to_guess(self):
        self.sealed(); self.paths['maintenance'].unlink()
        self.assertEqual(self.observer.cancel()['code'], 'MARKER_TUPLE'); self.assertEqual(self.state(), (False, False, False))
    def test_cancel_already_original_open_without_maintenance_is_safe(self):
        self.sealed(); self.paths['open'].write_bytes(self.original_open); self.paths['maintenance'].unlink()
        self.assertEqual(self.observer.cancel()['phase'], 'cancelled')
    def test_cancel_open_plus_own_maintenance_is_safe(self):
        self.sealed(); self.paths['open'].write_bytes(self.original_open)
        self.assertEqual(self.observer.cancel()['phase'], 'cancelled')
    def test_foreign_open_and_checking_at_start_never_mutate(self):
        self.paths['open'].write_bytes(b'foreign')
        self.assertEqual(self.observer.observe(1)['code'], 'OPEN_BINDING'); self.assertFalse(self.paths['maintenance'].exists())
    def test_signal_flag_cancels_on_next_iteration(self):
        self.runtime.on_wait = self.observer.request_cancel
        result = self.observer.observe(10)
        self.assertEqual(result['code'], 'CANCEL_REQUESTED'); self.assertEqual(self.state(), (True, False, False))
        self.assertLess(self.runtime.ticks, 10)
    def test_live_drift_during_window_preserves_seal(self):
        self.runtime.on_wait = lambda: self.runtime.value.update(process=process(43))
        result = self.observer.observe(2)
        self.assertEqual(result['code'], 'CONTROL_DRIFT'); self.assertEqual(self.state(), (False, True, False))
    def test_duration_is_real_integer_one_to_300(self):
        for seconds in (True, 0, 301, 1.5):
            with self.subTest(seconds=seconds): self.assertEqual(self.observer.observe(seconds)['code'], 'DURATION')
    def test_loaded_receipt_binding_and_all_six_entries_required(self):
        value = json.loads(self.paths['receipt'].read_bytes()); value['coverage'].pop()
        self.paths['receipt'].write_bytes(body(value)); self.policy['loadedReceiptSha256'] = sha(body(value)); self.save_policy()
        self.assertEqual(self.observer.observe(1)['code'], 'RECEIPT_SCHEMA')
    def test_marker_publish_eexist_never_overwrites(self):
        target = self.paths['maintenance']; target.write_bytes(b'foreign')
        with self.assertRaises(o.ObserverError): self.fs.publish(target, b'ours')
        self.assertEqual(target.read_bytes(), b'foreign')
    def test_read_rejects_symbolic_hard_links_and_writable_files(self):
        original = self.paths['policy'].read_bytes()
        for kind in ('symbolic', 'hard', 'writable'):
            with self.subTest(kind=kind):
                self.paths['policy'].unlink(missing_ok=True); extra = self.root / 'extra'; extra.unlink(missing_ok=True)
                extra.write_bytes(original)
                if kind == 'symbolic': self.paths['policy'].symlink_to(extra)
                elif kind == 'hard': os.link(extra, self.paths['policy'])
                else: self.paths['policy'].write_bytes(original); self.paths['policy'].chmod(0o666)
                with self.assertRaises(o.ObserverError): self.fs.read(self.paths['policy'])
    def test_remove_rejects_changed_inode_or_bytes(self):
        target = self.paths['maintenance']; target.write_bytes(b'ours')
        def replace(event):
            if event == 'remove:maintenance:before':
                target.unlink(); target.write_bytes(b'foreign')
        self.fs.failpoint = replace
        with self.assertRaises(o.ObserverError): self.fs.remove(target, b'ours')
        self.assertEqual(target.read_bytes(), b'foreign')
    def test_each_crash_boundary_leaves_recoverable_or_untouched_tuple(self):
        # Every durable journal/marker boundary uses a fresh fixture; only explicit cancel recovers.
        for event in ('journal:preparing:after', 'journal:sealing:create-maintenance:after',
                      'publish:maintenance:after', 'journal:sealing:remove-open:after',
                      'remove:open:after', 'journal:sealed:after'):
            with self.subTest(event=event):
                with tempfile.TemporaryDirectory() as directory:
                    cloned = Path(directory); cloned.chmod(0o700)
                    paths = {key: cloned / key for key in self.paths}
                    for key in ('policy', 'receipt', 'open', 'lock'): paths[key].write_bytes(self.paths[key].read_bytes())
                    fs = o.ProtectedFS(cloned, os.getuid())
                    fs.failpoint = lambda name, expected=event: (_ for _ in ()).throw(Crash()) if name == expected else None
                    observer = o.Observer(fs, paths, Runtime(self.runtime.value))
                    with self.assertRaises(Crash): observer.observe(1)
                    fs.failpoint = None
                    result = observer.cancel()
                    self.assertEqual(result['phase'], 'cancelled')
                    self.assertEqual(paths['open'].read_bytes(), self.original_open); self.assertFalse(paths['maintenance'].exists())
    def test_cancel_failure_after_unlink_attempts_safe_reseal_and_reports_actual(self):
        self.sealed()
        fired = []
        def fail(event):
            if event == 'remove:maintenance:after' and not fired:
                fired.append(event); raise OSError('SECRET must never escape')
        self.fs.failpoint = fail
        result = self.observer.cancel()
        self.assertTrue(result['needsAttention']); self.assertEqual(result['markers'], {'open': True, 'maintenance': True, 'checking': False})
        self.assertFalse(result['admissionMayBeOpen']); self.assertNotIn('SECRET', json.dumps(result))
    def test_real_shared_flock_busy_never_recreates_lock(self):
        import fcntl
        inode = self.paths['lock'].stat().st_ino
        with self.paths['lock'].open('rb') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.observer.cancel()['code'], 'BUSY')
        self.assertEqual(self.paths['lock'].stat().st_ino, inode)
    def test_status_does_not_create_completion_or_mutate_markers(self):
        result = self.observer.status()
        self.assertFalse(result['completionAuthorized']); self.assertFalse(self.paths['journal'].exists())
        self.assertEqual(self.state(), (True, False, False))
    def test_status_drift_never_changes_existing_journal(self):
        self.sealed(); original = self.paths['journal'].read_bytes()
        self.runtime.value['process'] = process(43)
        self.assertEqual(self.observer.status()['code'], 'CONTROL_DRIFT')
        self.assertEqual(self.paths['journal'].read_bytes(), original)
    def test_policy_and_receipt_changes_during_window_are_detected(self):
        self.runtime.on_wait = lambda: self.paths['policy'].write_bytes(body(self.policy) + b' ')
        result = self.observer.observe(2)
        self.assertEqual(result['code'], 'POLICY_BINDING')
        self.assertEqual(self.state(), (False, True, False))
    def test_cancel_crashes_after_each_boundary_are_recoverable(self):
        self.sealed(); journal = self.paths['journal'].read_bytes(); maintenance = self.paths['maintenance'].read_bytes()
        for event in ('journal:cancelling:create-open:after', 'publish:open:after',
                      'journal:cancelling:remove-maintenance:after', 'remove:maintenance:after', 'journal:cancelled:after'):
            with self.subTest(event=event):
                self.paths['journal'].write_bytes(journal); self.paths['open'].unlink(missing_ok=True)
                self.paths['maintenance'].write_bytes(maintenance)
                self.fs.failpoint = lambda name, expected=event: (_ for _ in ()).throw(Crash()) if name == expected else None
                with self.assertRaises(Crash): self.observer.cancel()
                self.fs.failpoint = None
                self.assertEqual(self.observer.cancel()['phase'], 'cancelled')
                self.assertEqual(self.state(), (True, False, False))
    def test_failed_reseal_reports_open_possibility(self):
        self.sealed()
        def fail(event):
            if event in ('remove:maintenance:after', 'publish:maintenance:before'): raise OSError('secret')
        self.fs.failpoint = fail
        result = self.observer.cancel()
        self.assertEqual(result['markers'], {'open': True, 'maintenance': False, 'checking': False})
        self.assertTrue(result['admissionMayBeOpen']); self.assertTrue(result['needsAttention'])
    def test_helper_file_drift_blocks_cancel(self):
        self.sealed(); self.runtime.value['helperFiles'][0]['sha256'] = 'd' * 64
        self.assertEqual(self.observer.cancel()['code'], 'CONTROL_DRIFT')
    def test_foreign_receipt_cannot_substitute_loaded_generation(self):
        self.paths['receipt'].write_bytes(b'{}')
        self.assertEqual(self.observer.observe(1)['code'], 'RECEIPT_BINDING')
    def test_strict_json_rejects_duplicates_nan_and_size(self):
        for value in (b'{"a":1,"a":2}', b'{"a":NaN}', b' ' * 65537):
            with self.assertRaises(o.ObserverError): o.strict_json(value)
    def test_marker_inode_with_interrupted_extra_link_needs_attention(self):
        self.sealed(); extra = self.root / '.observer-interrupted-link'
        os.link(self.paths['maintenance'], extra)
        result = self.observer.cancel()
        self.assertEqual(result['code'], 'FILE_TRUST'); self.assertTrue(result['needsAttention'])
        self.assertTrue(extra.exists()); self.assertEqual(self.state(), (False, True, False))
    def test_all_eight_marker_tuples_at_new_observe(self):
        import itertools
        opening = self.original_open
        for has_open, has_maintenance, has_checking in itertools.product((False, True), repeat=3):
            with self.subTest(state=(has_open, has_maintenance, has_checking)):
                self.paths['journal'].unlink(missing_ok=True)
                for name, exists in [('open', has_open), ('maintenance', has_maintenance), ('checking', has_checking)]:
                    self.paths[name].unlink(missing_ok=True)
                    if exists: self.paths[name].write_bytes(opening if name == 'open' else b'foreign')
                result = self.observer.observe(1)
                if (has_open, has_maintenance, has_checking) == (True, False, False):
                    self.assertEqual(result['phase'], 'cancelled')
                else:
                    self.assertTrue(result['needsAttention'])
                    self.assertEqual(self.state(), (has_open, has_maintenance, has_checking))
    def test_directory_fsync_failure_after_maintenance_unlink_attempts_reseal(self):
        self.sealed(); original = self.fs.sync_dir; fired = []
        def fail_once(path):
            if self.observer.removing_maintenance and not self.paths['maintenance'].exists() and not fired:
                fired.append(True); raise OSError('private detail')
            return original(path)
        self.fs.sync_dir = fail_once
        result = self.observer.cancel()
        self.assertTrue(result['needsAttention']); self.assertEqual(self.state(), (True, True, False))
        self.assertFalse(result['admissionMayBeOpen']); self.assertNotIn('private detail', str(result))
    def test_missing_lock_is_not_created(self):
        self.paths['lock'].unlink()
        self.assertEqual(self.observer.observe(1)['code'], 'IO_UNCERTAIN')
        self.assertFalse(self.paths['lock'].exists()); self.assertEqual(self.state(), (True, False, False))
    def test_policy_boolean_schema_and_duplicate_worker_pids_rejected(self):
        baseline = copy.deepcopy(self.policy)
        for mutate in (lambda p: p.update(schemaVersion=True), lambda p: p['process'].update(pid=True),
                       lambda p: p['nginxWorkers'].append(copy.deepcopy(p['nginxWorkers'][0])),
                       lambda p: p['helperFiles'][0].update(name='release.py')):
            self.policy = copy.deepcopy(baseline); mutate(self.policy); self.save_policy()
            self.assertEqual(self.observer.observe(1)['code'], 'POLICY_SCHEMA')
    def test_protected_ancestor_and_owner_are_required(self):
        self.root.chmod(0o777)
        with self.assertRaises(o.ObserverError): self.fs.read(self.paths['policy'])
        self.root.chmod(0o700)
        fs = o.ProtectedFS(self.root, os.getuid() + 1)
        with self.assertRaises(o.ObserverError): fs.read(self.paths['policy'])


class Crash(BaseException): pass


class ClosureTests(unittest.TestCase):
    def test_cli_exposes_only_fixed_observe_cancel_status(self):
        path = HERE / 'ingress-observe.py'
        self.assertTrue(path.exists(), 'independent fixed CLI is missing')
        text = path.read_text()
        self.assertNotIn("local('release')", text)
        self.assertNotIn('first_window', text)
        self.assertNotIn('check_output', text)
        self.assertIn('timeout=', text)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('observer_cli_fixture', HERE / 'ingress-observe.py')
        self.cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.cli)
        self.runtime = self.cli.ReadOnlyRuntime(o, None)
    def test_service_has_fixed_command_timeout_and_clean_environment(self):
        completed = SimpleNamespace(stdout='MainPID=42\nActiveState=active\nSubState=running\n')
        with mock.patch.object(self.cli.subprocess, 'run', return_value=completed) as run:
            self.assertEqual(self.runtime.service('zimage.service'), 42)
            args, keywords = run.call_args
            self.assertEqual(args[0], ['/usr/bin/systemctl', 'show', 'zimage.service', '--property=MainPID,ActiveState,SubState'])
            self.assertEqual(keywords['timeout'], 3)
            self.assertEqual(keywords['env'], {'LANG': 'C', 'LC_ALL': 'C'})
    def test_timeout_is_fixed_error_without_command_output(self):
        error = self.cli.subprocess.TimeoutExpired('sensitive', 3, output='secret', stderr='private')
        with mock.patch.object(self.cli.subprocess, 'run', side_effect=error):
            with self.assertRaises(o.ObserverError) as raised: self.runtime.service('zimage.service')
        self.assertEqual(str(raised.exception), 'SERVICE_UNCERTAIN')
    def test_systemctl_duplicate_transition_and_boolean_pid_refused(self):
        for text in ('MainPID=42\nActiveState=active\nSubState=running\nMainPID=43\n',
                     'MainPID=42\nActiveState=activating\nSubState=start\n',
                     'MainPID=True\nActiveState=active\nSubState=running\n'):
            with mock.patch.object(self.cli.subprocess, 'run', return_value=SimpleNamespace(stdout=text)):
                with self.assertRaises(o.ObserverError): self.runtime.service('zimage.service')
    def test_proc_stat_handles_parentheses_in_comm(self):
        tail = ['S', '8'] + ['0'] * 17 + ['4200']
        self.runtime.read_proc = lambda path: '42 (name ) with spaces) ' + ' '.join(tail)
        value, name, parent = self.runtime.process(42, process(42)['bootId'])
        self.assertEqual(value, process(42)); self.assertEqual(parent, 8); self.assertEqual(name, 'name ) with spaces')
    def test_authenticated_source_exec_ignores_matching_unreviewed_pyc(self):
        import py_compile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'observer.py'
            authenticated = b"MARKER = 'SOURCE'\n"; source.write_bytes(b"MARKER = 'CACHED'\n")
            os.utime(source, (1700000000, 1700000000))
            with mock.patch('sys.pycache_prefix', None): py_compile.compile(str(source), doraise=True)
            source.write_bytes(authenticated); os.utime(source, (1700000000, 1700000000))
            with mock.patch('sys.pycache_prefix', None), mock.patch.object(self.cli, 'INSTALL', root), mock.patch.object(self.cli, 'authenticated_source', create=True, return_value=authenticated):
                library = self.cli.load_library()
            self.assertEqual(library.MARKER, 'SOURCE')
    def test_proc_enumeration_has_a_total_entry_limit(self):
        entries = [SimpleNamespace(name='not-a-pid')] * 3
        self.runtime.process = lambda pid, boot: (process(pid), 'nginx', 1)
        iterator = mock.MagicMock(); iterator.__enter__.return_value = iter(entries)
        with mock.patch.object(self.cli, 'MAX_PROC_ENTRIES', 2, create=True), mock.patch.object(self.cli.os, 'listdir', return_value=['x'] * 3), mock.patch.object(self.cli.os, 'scandir', return_value=iterator):
            with self.assertRaises(o.ObserverError) as raised: self.runtime.generation(8, process(8)['bootId'])
        self.assertEqual(str(raised.exception), 'PROCESS_LIMIT')
    def test_snapshot_has_elapsed_budget_even_if_identity_is_unchanged(self):
        ticks = [0]
        self.runtime.monotonic = lambda: ticks[0]
        def slow(_): ticks[0] += 2; return {'same': True}
        self.runtime.once = slow
        with self.assertRaises(o.ObserverError) as raised: self.runtime.snapshot({})
        self.assertEqual(str(raised.exception), 'PROCESS_BUDGET')
    def test_cli_root_or_closure_rejection_is_fixed_json(self):
        import io
        stream = io.StringIO()
        with mock.patch.object(self.cli, 'trusted_closure', return_value=False), mock.patch('sys.stdout', stream):
            self.assertEqual(self.cli.main(), 1)
        value = json.loads(stream.getvalue()); self.assertEqual(value['code'], 'ROOT_ISOLATED_CLOSURE_REQUIRED')
        self.assertFalse(value['completionAuthorized'])
    def test_implementation_has_no_old_controller_or_mutating_command(self):
        import ast
        for name in ('observer.py', 'ingress-observe.py'):
            tree = ast.parse((HERE / name).read_text())
            imports = [item.module for item in ast.walk(tree) if isinstance(item, ast.ImportFrom)]
            imports += [alias.name for item in ast.walk(tree) if isinstance(item, ast.Import) for alias in item.names]
            self.assertFalse(set(imports) & {'release', 'first_window', 'transaction', 'socket', 'urllib', 'requests', 'sqlite3'})
        text = (HERE / 'ingress-observe.py').read_text()
        self.assertNotIn("'stop'", text); self.assertNotIn("'start'", text); self.assertNotIn("'reload'", text)
        self.assertNotIn('os.kill', text); self.assertNotIn('/environ', text)


class ConfigClosureTests(unittest.TestCase):
    def test_only_reachable_exact_five_file_include_graph_is_accepted(self):
        self.assertTrue(hasattr(o, 'validate_config_closure'), 'actual include graph validation is missing')
        bodies = {path: b'# reviewed\n' for path in o.CONFIG_PATHS}
        bodies['/etc/nginx/nginx.conf'] = b'events{} http{include /etc/nginx/mime.types; include /etc/nginx/sites-available/zimage.conf;}'
        bodies['/etc/nginx/sites-available/zimage.conf'] = b'include /etc/nginx/zimage-ingress-maintenance-maps.conf; server{include /etc/nginx/zimage-ingress-maintenance-server.conf;}'
        o.validate_config_closure(bodies)
        for suffix in (b'include /etc/nginx/conf.d/*.conf;', b'"include" "/etc/nginx/other.conf";', b'include $unreviewed;'):
            changed = dict(bodies); changed['/etc/nginx/nginx.conf'] += suffix
            with self.assertRaises(o.ObserverError): o.validate_config_closure(changed)
        changed = dict(bodies); changed['/etc/nginx/sites-available/zimage.conf'] = b'server{}'
        with self.assertRaises(o.ObserverError): o.validate_config_closure(changed)


if __name__ == '__main__': unittest.main()
