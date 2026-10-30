import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backend_transaction', Path(__file__).with_name('transaction.py'))
tx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tx)
A, B, C = 'a' * 40, 'b' * 40, 'c' * 40


def policy():
    backend = {'api': {'major': 1, 'minor': 0, 'capabilities': ['runtime.meta.v1']}, 'schemaRevision': 'unchanged-db', 'workerRevision': 'unchanged-worker', 'modelCatalogRevision': 'unchanged-prices'}
    return {'schemaVersion': 1, 'frontendRelease': 'frontend-content-id', 'backends': {A: copy.deepcopy(backend), B: copy.deepcopy(backend)},
            'supportedFrontends': [{'releaseId': 'frontend-content-id', 'requiresApi': {'major': 1, 'minor': 0, 'capabilities': ['runtime.meta.v1']}, 'verifiedBackends': [A, B]}]}


class FakeOps:
    def __init__(self, gate):
        self.gate, self.release, self.pid = gate, A, 101
        self.front = 'frontend-content-id'
        self.approved = policy()
        self.calls, self.active, self.fail_check, self.fail_native = [], {}, set(), set()
        self.legacy, self.candidate_active, self.drift, self.pid_drift = False, False, False, False
        self.http, self.framework, self.bridge_valid = 0, 0, True
    def current(self): return self.release
    def frontend(self): return self.front
    def policy(self): return self.approved
    def status(self):
        if self.legacy: raise ConnectionError('old version has no lifecycle socket')
        gate = json.loads(self.gate.read_text())
        counters = {key: self.active.get(key, 0) for key in tx.COUNTERS}
        if self.drift and (gate['mode'] != 'open'): self.release = C
        if self.pid_drift and (gate['mode'] != 'open'): self.pid = 999
        return {'schemaVersion': 1, 'backendRelease': self.release, 'pid': self.pid, 'controlValid': True,
                'maintenance': (gate['mode'] != 'open'), 'admissionEpoch': gate['operationId'], 'counters': counters,
                'admissionMode': gate['mode'], 'activeHttpRequests': self.http, 'activeFrameworkWork': self.framework,
                'httpAdmission': {'protocolVersion': 1, 'installed': self.bridge_valid, 'barrierId': 'node-http-create-server-v1',
                    'activeHttpRequests': self.http, 'activeFrameworkWork': self.framework,
                    'frameworkWork': {'installed': True, 'protocolVersion': 1, 'nextVersion': '16.4.1', 'hook': 'response-cache-revalidate-v1', 'controlValid': True}},
                'drained': (gate['mode'] != 'open') and not any(counters.values()) and self.http == self.framework == 0}
    def validate(self, release): self.calls.append(('validate', release))
    def stop(self): self.calls.append(('stop', self.release))
    def start(self):
        self.calls.append(('start', self.release)); self.pid += 1
        assert (json.loads(self.gate.read_text())['mode'] != 'open'), 'restart must never open writes'
    def native(self, release):
        self.calls.append(('native', release))
        if release in self.fail_native: raise RuntimeError('native/font failure')
    def select(self, release, expected):
        assert self.release == expected
        self.calls.append(('select', release)); self.release = release
    def previous(self, release): self.calls.append(('previous', release))
    def check(self, release, operation):
        self.calls.append(('check', release))
        if release in self.fail_check: raise RuntimeError('exact health/auth/public failure')
        return self.status()
    def safe_to_restore(self, release, operation):
        if self.candidate_active: raise RuntimeError('pending candidate finalizers')


class BackendTransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.gate, self.journal = self.root / 'gate.json', self.root / 'current.json'
        tx.atomic_json(self.gate, {'schemaVersion': 2, 'operationId': 'baseline-1', 'mode': 'open'})
        self.ops = FakeOps(self.gate)
        self.now = 0
        self.transaction = tx.BackendTransaction(self.ops, self.gate, self.journal, lambda: self.now, self.wait)
    def tearDown(self): self.temp.cleanup()
    def wait(self, duration): self.now += duration
    def run_switch(self): return self.transaction.switch(B, A, 'operation-1', timeout=1)
    def phase(self): return json.loads(self.journal.read_text())['phase']
    def closed(self): return (json.loads(self.gate.read_text())['mode'] != 'open')

    def test_success_checks_before_open_and_keeps_exact_old(self):
        result = self.run_switch()
        self.assertEqual(result['phase'], 'committed')
        self.assertFalse(self.closed())
        self.assertEqual(self.ops.calls, [('validate', B), ('stop', A), ('native', B), ('select', B), ('start', B), ('check', B), ('previous', A)])
        self.assertEqual(json.loads((self.root / 'operation-1.json').read_text()), result)
        self.assertEqual(self.gate.stat().st_mode & 0o777, 0o644)

    def test_every_counter_prevents_stop_and_timeout_restores_only_admission(self):
        for key in tx.COUNTERS:
            with self.subTest(key=key):
                self.temp.cleanup()
                self.setUp()
                try:
                    self.ops.active[key] = 1
                    with self.assertRaises(TimeoutError): self.run_switch()
                    self.assertEqual(self.phase(), 'cancelled')
                    self.assertFalse(self.closed())
                    self.assertEqual(self.ops.pid, 101)
                    self.assertEqual(self.ops.calls, [('validate', B)])
                finally: self.tearDown()

    def test_delayed_finalizer_finishes_before_stop(self):
        self.ops.active['pendingFinalizers'] = 1
        def finish(duration):
            self.now += duration
            self.assertFalse(any(call[0] == 'stop' for call in self.ops.calls))
            self.ops.active.clear()
        self.transaction.wait = finish
        self.assertEqual(self.run_switch()['phase'], 'committed')

    def test_candidate_failure_recovers_exact_old_once_and_still_fails(self):
        self.ops.fail_check.add(B)
        with self.assertRaises(tx.TransactionFailure): self.run_switch()
        self.assertEqual(self.phase(), 'recovered')
        self.assertEqual(self.ops.release, A)
        self.assertFalse(self.closed())
        self.assertEqual([entry for entry in self.ops.calls if entry[0] == 'select'], [('select', B), ('select', A)])

    def test_restore_failure_keeps_gate_closed_and_never_reselects_bad_version(self):
        self.ops.fail_check.update((A, B))
        with self.assertRaises(tx.TransactionFailure): self.run_switch()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertTrue(self.closed())
        self.assertEqual(self.ops.release, A)
        self.assertEqual(self.ops.calls.count(('select', B)), 1)

    def test_live_candidate_finalizers_prevent_unsafe_recovery_stop(self):
        self.ops.fail_check.add(B); self.ops.candidate_active = True
        with self.assertRaises(tx.TransactionFailure): self.run_switch()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertTrue(self.closed())
        self.assertEqual(self.ops.calls.count(('stop', B)), 0)

    def test_legacy_without_drain_is_blocked_before_gate_or_stop(self):
        self.ops.legacy = True
        with self.assertRaises(ConnectionError): self.run_switch()
        self.assertFalse(self.closed())
        self.assertEqual(self.ops.calls, [])

    def test_current_or_pid_drift_never_reopens_or_stops_other_process(self):
        for key in ('drift', 'pid_drift'):
            with self.subTest(key=key):
                self.temp.cleanup()
                self.setUp()
                try:
                    setattr(self.ops, key, True)
                    with self.assertRaises(tx.TransactionFailure): self.run_switch()
                    self.assertEqual(self.phase(), 'needs_attention')
                    self.assertTrue(self.closed())
                    self.assertFalse(any(call[0] == 'stop' for call in self.ops.calls))
                finally: self.tearDown()

    def test_api_schema_worker_and_price_incompatibility_fail_before_mutations(self):
        for key in ('schemaRevision', 'workerRevision', 'modelCatalogRevision'):
            self.ops.approved['backends'][B][key] = 'changed'
            with self.assertRaises(ValueError): self.run_switch()
            self.ops.approved = policy()
        self.ops.approved['backends'][B]['api']['capabilities'] = []
        with self.assertRaises(ValueError): self.run_switch()
        self.assertEqual(self.ops.calls, [])
        self.assertFalse(self.closed())

    def test_unfinished_crash_or_reused_operation_requires_reconciliation(self):
        self.ops.active['activeStreams'] = 1
        with self.assertRaises(TimeoutError): self.run_switch()
        with self.assertRaises(tx.TransactionFailure): self.run_switch()
        tx.atomic_json(self.journal, {'operationId': 'other-operation', 'phase': 'switching', 'sequence': 2})
        with self.assertRaises(tx.TransactionFailure): self.transaction.switch(B, A, 'operation-2')

    def test_native_failure_restores_old_while_maintenance_stays_closed_through_restart(self):
        self.ops.fail_native.add(B)
        with self.assertRaises(tx.TransactionFailure): self.run_switch()
        self.assertEqual(self.phase(), 'recovered')
        self.assertEqual(self.ops.release, A)
        self.assertFalse(self.closed())

    def test_post_open_journal_failure_recloses_without_stopping_or_rollback(self):
        original = self.transaction.write
        def fail(record, phase, **details):
            if phase == 'committed': raise OSError('disk error after admission opened')
            return original(record, phase, **details)
        self.transaction.write = fail
        with self.assertRaises(tx.TransactionFailure): self.run_switch()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertTrue(self.closed())
        self.assertEqual(self.ops.release, B)
        self.assertEqual(self.ops.calls.count(('stop', B)), 0)

    def test_recovery_or_cancellation_journal_failure_recloses_admission(self):
        for phase in ('recovered', 'cancelled'):
            self.temp.cleanup(); self.setUp()
            if phase == 'recovered': self.ops.fail_check.add(B)
            else: self.ops.active['pendingFinalizers'] = 1
            original = self.transaction.write
            def fail(record, stage, **details):
                if stage == phase: raise OSError('journal write failed after reopening')
                return original(record, stage, **details)
            self.transaction.write = fail
            with self.assertRaises((tx.TransactionFailure, TimeoutError)): self.run_switch()
            self.assertEqual(self.phase(), 'needs_attention')
            self.assertTrue(self.closed())


    def test_http_and_detached_framework_work_each_prevent_old_stop(self):
        for key in ('http', 'framework'):
            self.temp.cleanup(); self.setUp()
            setattr(self.ops, key, 1)
            with self.assertRaises(TimeoutError): self.run_switch()
            self.assertFalse(any(call[0] == 'stop' for call in self.ops.calls))
            self.assertEqual(self.phase(), 'cancelled')

    def test_missing_http_or_framework_bridge_never_closes_or_stops(self):
        for mutate in (lambda state: state.pop('httpAdmission'),
                       lambda state: state['httpAdmission'].pop('frameworkWork'),
                       lambda state: state['httpAdmission']['frameworkWork'].update(nextVersion='other'),
                       lambda state: state['httpAdmission']['frameworkWork'].update(protocolVersion=True),
                       lambda state: state.update(activeHttpRequests=True)):
            self.temp.cleanup(); self.setUp()
            original = self.ops.status
            def status():
                state = original(); mutate(state); return state
            self.ops.status = status
            with self.assertRaises(tx.TransactionFailure): self.run_switch()
            self.assertFalse(self.closed())
            self.assertEqual(self.ops.calls, [])

    def test_frontend_or_policy_drift_cannot_reopen_cancelled_old_backend(self):
        for change in ('frontend', 'policy'):
            self.temp.cleanup(); self.setUp()
            self.ops.active['activeStreams'] = 1
            def drift(duration):
                self.now += duration
                self.ops.active.clear()
                if change == 'frontend': self.ops.front = 'unapproved-frontend'
                else: self.ops.approved['backends'][B]['schemaRevision'] = 'changed-schema'
            self.transaction.wait = drift
            with self.assertRaises((tx.TransactionFailure, ValueError)): self.run_switch()
            self.assertEqual(self.phase(), 'needs_attention')
            self.assertTrue(self.closed())
            self.assertFalse(any(call[0] == 'stop' for call in self.ops.calls))

    def test_recovery_changes_checking_to_draining_before_counted_work_settles(self):
        original = self.ops.check
        def check(release, operation):
            if release == B:
                self.ops.http = 1
                raise RuntimeError('inflight candidate HTTP')
            return original(release, operation)
        self.ops.check = check
        def complete(duration):
            self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')
            self.assertEqual(self.ops.calls.count(('stop', B)), 0)
            self.ops.http = 0
            self.now += duration
        self.transaction.wait = complete
        with self.assertRaises(tx.TransactionFailure): self.run_switch()
        self.assertEqual(self.phase(), 'recovered')
        self.assertEqual(self.ops.calls.count(('stop', B)), 1)


if __name__ == '__main__': unittest.main()
