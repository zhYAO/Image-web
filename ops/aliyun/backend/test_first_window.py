"""Local control flow and real verifier/receipt protocol tests; no production proof."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location('first_test_' + name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

f, v, receipt = load('first_window'), load('verify'), load('receipt')
A, B, C, OP = 'a' * 40, 'b' * 40, 'c' * 40, 'first-window-01'
PROCESS = {'pid': 101, 'startTicks': 1234, 'bootId': '12345678-1234-1234-1234-123456789abc'}


def documents():
    frontend = {'schemaVersion': 1, 'kind': 'legacy-next', 'backendRelease': A, 'treeSha256': 'd' * 64,
                'ingressConfigSha256': 'e' * 64, 'auditRefs': ['audit:legacy-frontend-01']}
    backend = {'api': {'major': 1, 'minor': 0, 'capabilities': []}, 'schemaRevision': 'db0',
               'workerRevision': 'worker0', 'modelCatalogRevision': 'prices0'}
    compatibility = {'schemaVersion': 1, 'frontendRelease': f.digest(frontend),
        'backends': {A: copy.deepcopy(backend), B: dict(copy.deepcopy(backend), drainProtocol=1, httpAdmissionProtocol=1)},
        'supportedFrontends': [{'releaseId': f.digest(frontend), 'requiresApi': {'major': 1, 'minor': 0, 'capabilities': []}, 'verifiedBackends': [A, B]}]}
    policy = {'schemaVersion': 1, 'operationId': OP, 'old': A, 'target': B, 'oldProcess': copy.deepcopy(PROCESS),
        'legacyFrontendSha256': f.digest(frontend), 'ingressConfigPath': '/etc/nginx/conf.d/zimage.conf',
        'ingressConfigSha256': 'e' * 64, 'candidateManifestSha256': 'f' * 64, 'compatibilitySha256': f.digest(compatibility),
        'candidatePolicy': compatibility, 'serviceTemplates': {'candidate': '5' * 64, 'legacy': '6' * 64}, 'originalServiceSha256': '7' * 64, 'auditRefs': ['audit:independent-compat-01'], 'issuedAt': 900, 'expiresAt': 2000}
    token = f.seal_token(policy)
    completion = {'schemaVersion': 1, 'protocol': 'zimage-legacy-completion-v1', 'operationId': OP, 'old': A,
        'oldProcess': copy.deepcopy(PROCESS), 'policySha256': f.digest(policy), 'ingressConfigSha256': 'e' * 64,
        'ingressSealSha256': f.digest(token), 'coverageStartTicks': 1234, 'sealedAt': 990, 'checkedAt': 995, 'expiresAt': 1100,
        'coverage': [{'category': key, 'evidenceSha256': '1' * 64, 'auditRef': 'audit:ingress-' + key, 'outcome': 'sealed'} for key in f.COVERAGE],
        'completion': [{'category': key, 'evidenceSha256': '2' * 64, 'auditRef': 'audit:complete-' + key, 'outcome': 'completed'} for key in f.COMPLETION],
        'auditRefs': ['audit:independent-completion-01'], 'reviewDecision': 'exact-completion-reviewed'}
    return policy, frontend, completion


class Ops:
    def __init__(self, gate):
        self.gate = gate
        self.approved, self.frontend, self.evidence = documents()
        self.token, self.checking = f.seal_token(self.approved), None
        self.release, self.proc, self.pid_counter, self.calls = A, copy.deepcopy(PROCESS), 101, []
        self.fail, self.active, self.http, self.framework = None, {}, 0, 0
        self.front_current, self.ingress_sha, self.audit_missing = False, 'e' * 64, False
    def first_policy(self): return copy.deepcopy(self.approved)
    def legacy_frontend(self): return copy.deepcopy(self.frontend)
    def completion(self): return copy.deepcopy(self.evidence)
    def ingress_state(self): return copy.deepcopy(self.token)
    def original_service_digest(self): return '7' * 64
    def service_policy(self, policy): pass
    def service_mode(self, mode, policy):
        assert self.proc is None
    def ingress_open_exists(self): return False
    def ingress_checking(self): return copy.deepcopy(self.checking)
    def ingress_digest(self, policy): return self.ingress_sha
    def frontend_current_exists(self): return self.front_current
    def current(self): return self.release
    def process(self): return copy.deepcopy(self.proc)
    def action(self, name, release=None):
        self.calls.append((name, release or self.release))
        if self.fail == (name, release or self.release):
            self.fail = None
            raise RuntimeError('injected local failure')
    def ingress_mode(self, op, mode, policy):
        assert op == OP and mode in ('checking', 'draining')
        self.checking = self.token if mode == 'checking' else None
    def validate_first_candidate(self, release, policy): self.action('validate', release)
    def stop(self):
        assert json.loads(self.gate.read_text())['mode'] == 'draining'
        assert self.checking is None
        if self.release == B:
            assert self.http == self.framework == 0 and not any(self.active.values())
        self.action('stop'); self.proc = None
    def native(self, release): self.action('native', release)
    def select(self, release, expected):
        assert expected == self.release and self.proc is None
        self.action('select', release); self.release = release
    def start(self):
        assert json.loads(self.gate.read_text())['mode'] == 'draining'
        self.action('start')
        self.pid_counter += 1
        self.proc = dict(PROCESS, pid=self.pid_counter, startTicks=1234 + self.pid_counter)
    def status(self):
        if self.release == A: raise AssertionError('Genuine B0 has no socket/meta/drain marker')
        gate = json.loads(self.gate.read_text())
        counters = {key: self.active.get(key, 0) for key in f.tx.COUNTERS}
        bridge = {'protocolVersion': 1, 'installed': True, 'barrierId': 'node-http-create-server-v1',
            'activeHttpRequests': self.http, 'activeFrameworkWork': self.framework,
            'frameworkWork': {'installed': True, 'protocolVersion': 1, 'nextVersion': '16.4.1', 'hook': 'response-cache-revalidate-v1', 'controlValid': True}}
        return {'schemaVersion': 1, 'backendRelease': B, 'pid': self.proc['pid'], 'controlValid': True,
            'maintenance': gate['mode'] != 'open', 'admissionEpoch': gate['operationId'], 'admissionMode': gate['mode'],
            'activeHttpRequests': self.http, 'activeFrameworkWork': self.framework, 'httpAdmission': bridge,
            'counters': counters, 'drained': not any(counters.values()) and self.http == self.framework == 0}
    def check(self, release, operation):
        assert json.loads(self.gate.read_text())['mode'] == 'checking' and self.checking
        self.action('check', release)
        self.action('receipt', release)
        return self.status()
    def check_legacy(self, release, operation, process, policy):
        assert release == A and self.proc == process
        self.action('safe-legacy-ready-account-sessions', release)
        if self.audit_missing: raise ValueError('Missing separate wallet/ledger SELECT audit')
        self.action('independent-wallet-ledger-audit', release)


class Crash(BaseException): pass


class FirstWindowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.gate, self.journal = self.root / 'gate', self.root / 'first-current.json'
        f.tx.atomic_json(self.gate, {'schemaVersion': 2, 'operationId': OP, 'mode': 'draining'})
        self.ops, self.tick = Ops(self.gate), 0
        self.expected_policy_sha256 = f.digest(self.ops.first_policy())
        self.expected_completion_sha256 = f.digest(self.ops.completion())
        self.window = f.FirstWindow(self.ops, self.gate, self.journal, lambda: self.tick, lambda: 1000, self.wait)
    def tearDown(self): self.temp.cleanup()
    def wait(self, duration): self.tick += duration
    def run_window(self):
        return self.window.run(B, A, OP, expected_policy_sha256=self.expected_policy_sha256,
                               expected_completion_sha256=self.expected_completion_sha256, timeout=1)
    def recover(self, timeout=300):
        return self.window.recover(OP, expected_policy_sha256=self.expected_policy_sha256,
                                   expected_completion_sha256=self.expected_completion_sha256, timeout=timeout)
    def phase(self): return json.loads(self.journal.read_text())['phase']
    def reset(self): self.tearDown(); self.setUp()

    def test_no_frontend_current_no_b0_meta_success_is_real_backend_stage_only(self):
        record = self.run_window()
        self.assertEqual(record['phase'], 'backend_ready')
        self.assertEqual(self.ops.release, B)
        self.assertEqual(record['frontend'], f.digest(self.ops.frontend))
        self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')
        self.assertIsNone(self.ops.checking)
        self.assertFalse(record['writesOpened'])

    def test_missing_unknown_or_boolean_completion_rejects_before_any_mutation(self):
        for mutate in (lambda x: x.clear(), lambda x: x.update(completion=True),
                       lambda x: x['completion'][0].update(outcome='unknown'),
                       lambda x: x.update(coverage=[]), lambda x: x.update(coverageStartTicks=1235),
                       lambda x: x.update(expiresAt=999), lambda x: x.update(policySha256='0' * 64),
                       lambda x: x.update(reviewDecision=True)):
            self.reset(); mutate(self.ops.evidence)
            self.expected_completion_sha256 = f.digest(self.ops.completion())
            before = self.gate.read_bytes()
            with self.assertRaises(ValueError): self.run_window()
            self.assertEqual(self.ops.calls, [])
            self.assertEqual(self.gate.read_bytes(), before)
            self.assertFalse(self.journal.exists())

    def test_policy_native_platform_compatibility_and_legacy_identity_are_bound(self):
        for field in ('legacyFrontendSha256', 'ingressConfigSha256', 'candidateManifestSha256', 'compatibilitySha256'):
            self.reset(); self.ops.approved[field] = 'x'
            with self.assertRaises(ValueError): self.run_window()
            self.assertEqual(self.ops.calls, [])
        self.reset(); self.ops.frontend['kind'] = 'static-fake'
        with self.assertRaises(ValueError): self.run_window()
        self.assertEqual(self.ops.calls, [])

    def test_existing_static_current_or_original_pid_or_ingress_drift_never_stops(self):
        for mutate in (lambda: setattr(self.ops, 'front_current', True), lambda: self.ops.proc.update(startTicks=999),
                       lambda: setattr(self.ops, 'ingress_sha', '0' * 64), lambda: setattr(self.ops, 'checking', self.ops.token)):
            self.reset(); mutate()
            with self.assertRaises(f.tx.TransactionFailure): self.run_window()
            self.assertEqual(self.ops.calls, [])

    def test_native_select_start_health_failures_recover_exact_genuine_old(self):
        for stage in ('native', 'select', 'start', 'check', 'receipt'):
            self.reset(); self.ops.fail = (stage, B)
            with self.assertRaises(f.tx.TransactionFailure): self.run_window()
            self.assertEqual(self.phase(), 'recovered', stage)
            self.assertEqual(self.ops.release, A)
            self.assertIn(('safe-legacy-ready-account-sessions', A), self.ops.calls)
            self.assertIn(('independent-wallet-ledger-audit', A), self.ops.calls)
            self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')

    def test_candidate_http_framework_and_business_async_work_prevent_recovery_stop(self):
        for key in ('http', 'framework', 'pendingFinalizers', 'activeStreams'):
            self.reset()
            original = self.ops.check
            def fail(release, operation):
                if key in ('http', 'framework'): setattr(self.ops, key, 1)
                else: self.ops.active[key] = 1
                raise RuntimeError('checks failed with asynchronous work')
            self.ops.check = fail
            with self.assertRaises(f.tx.TransactionFailure): self.run_window()
            self.assertEqual(self.phase(), 'needs_attention')
            self.assertNotIn(('stop', B), self.ops.calls)
            self.assertEqual(self.ops.release, B)
            self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')

    def test_checking_is_closed_before_waiting_for_live_candidate_completion(self):
        self.run_window(); self.ops.http = 1
        def complete(duration):
            self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')
            self.assertIsNone(self.ops.checking)
            self.assertNotIn(('stop', B), self.ops.calls)
            self.ops.http = 0; self.tick += duration
        self.window.engine.wait = complete
        self.assertEqual(self.recover(timeout=1)['phase'], 'recovered')

    def test_separate_old_wallet_audit_is_mandatory(self):
        self.ops.fail, self.ops.audit_missing = ('check', B), True
        with self.assertRaises(f.tx.TransactionFailure): self.run_window()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertEqual(self.ops.release, A)
        self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')

    def test_all_persisted_forward_crash_phases_require_explicit_exact_recovery(self):
        for phase in ('verified', 'stopping_legacy', 'legacy_stopped', 'configuring_candidate', 'selecting_candidate', 'starting_candidate', 'checking', 'backend_ready'):
            self.reset(); original = self.window.write
            def crash(record, state, **details):
                original(record, state, **details)
                if state == phase: raise Crash()
            self.window.write = crash
            with self.assertRaises(Crash): self.run_window()
            with self.assertRaises(f.tx.TransactionFailure): self.run_window()
            self.window.write = original
            self.assertEqual(self.recover(timeout=1)['phase'], 'recovered', phase)
            self.assertEqual(self.ops.release, A)

    def test_all_persisted_recovery_crashes_can_reconcile_without_blind_stop_replay(self):
        for phase in ('draining_candidate', 'stopping_candidate', 'configuring_legacy', 'selecting_legacy', 'starting_legacy', 'legacy_started', 'checking_legacy', 'recovered'):
            self.reset(); self.run_window(); original = self.window.write
            def crash(record, state, **details):
                original(record, state, **details)
                if state == phase: raise Crash()
            self.window.write = crash
            with self.assertRaises(Crash): self.recover(timeout=1)
            self.window.write = original
            count = self.ops.calls.count(('stop', B))
            self.assertEqual(self.recover(timeout=1)['phase'], 'recovered')
            self.assertLessEqual(self.ops.calls.count(('stop', B)), 1)

    def test_wrong_epoch_open_gate_and_writes_uncertain_never_auto_rollback(self):
        for gate in ({'schemaVersion': 2, 'operationId': 'other-op', 'mode': 'draining'},
                     {'schemaVersion': 2, 'operationId': OP, 'mode': 'open'}):
            self.reset(); self.run_window(); f.tx.atomic_json(self.gate, gate)
            with self.assertRaises(f.tx.TransactionFailure): self.recover()
            self.assertNotIn(('stop', B), self.ops.calls)
            self.assertTrue(json.loads(self.journal.read_text())['writesMayHaveOpened'])
            f.tx.atomic_json(self.gate, {'schemaVersion': 2, 'operationId': OP, 'mode': 'draining'})
            with self.assertRaises(f.tx.TransactionFailure): self.recover()
        self.reset(); record = self.run_window(); record['writesOpened'] = True; f.tx.atomic_json(self.journal, record)
        with self.assertRaises(f.tx.TransactionFailure): self.recover()
        self.assertNotIn(('stop', B), self.ops.calls)

    def test_policy_pointer_pid_drift_and_unknown_journal_phases_fail_closed(self):
        for mutate in (lambda: setattr(self.ops, 'release', C), lambda: self.ops.approved.update(auditRefs=['audit:changed-policy']),
                       lambda: f.tx.atomic_json(self.journal, dict(json.loads(self.journal.read_text()), phase='invented'))):
            self.reset(); self.run_window(); mutate()
            with self.assertRaises((ValueError, f.tx.TransactionFailure)): self.recover()
            self.assertNotIn(('stop', B), self.ops.calls)


    def test_missing_old_audit_can_only_retry_safe_verification_of_same_live_old(self):
        self.ops.fail, self.ops.audit_missing = ('check', B), True
        with self.assertRaises(f.tx.TransactionFailure): self.run_window()
        pid = self.ops.process()
        stops = [call for call in self.ops.calls if call[0] == 'stop']
        self.ops.audit_missing = False
        self.assertEqual(self.recover(timeout=1)['phase'], 'recovered')
        self.assertEqual(self.ops.process(), pid)
        self.assertEqual([call for call in self.ops.calls if call[0] == 'stop'], stops)

    def test_replacement_candidate_pid_start_is_never_stopped(self):
        self.run_window(); self.ops.proc['startTicks'] += 1
        with self.assertRaises(f.tx.TransactionFailure): self.recover(timeout=1)
        self.assertNotIn(('stop', B), self.ops.calls)

    def test_unknown_live_candidate_without_recorded_start_identity_is_not_stopped(self):
        original = self.window.write
        def crash(record, phase, **details):
            original(record, phase, **details)
            if phase == 'verified': raise Crash()
        self.window.write = crash
        with self.assertRaises(Crash): self.run_window()
        self.window.write = original
        self.ops.release, self.ops.proc = B, dict(PROCESS, pid=909, startTicks=9009)
        with self.assertRaises(f.tx.TransactionFailure): self.recover()
        self.assertNotIn(('stop', B), self.ops.calls)

    def test_start_command_uncertain_after_live_process_requires_identity_reconciliation(self):
        original = self.ops.start
        def uncertain():
            original()
            if self.ops.release == B: raise OSError('start reply lost after process exists')
        self.ops.start = uncertain
        with self.assertRaises(f.tx.TransactionFailure): self.run_window()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertNotIn(('stop', B), self.ops.calls)
        self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')

    def test_candidate_final_journal_write_failure_recovers_old_without_opening(self):
        original = self.window.write
        def fail(record, phase, **details):
            if phase == 'backend_ready': raise OSError('local journal failure')
            return original(record, phase, **details)
        self.window.write = fail
        with self.assertRaises(f.tx.TransactionFailure): self.run_window()
        self.assertEqual(self.phase(), 'recovered')
        self.assertEqual(self.ops.release, A)
        self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')


    def test_root_approval_documents_changed_after_client_preflight_fail_before_mutation(self):
        for changed in ('policy', 'completion'):
            self.reset()
            if changed == 'policy': self.ops.approved['auditRefs'] = ['audit:new-root-review']
            else: self.ops.evidence['auditRefs'] = ['audit:new-root-completion-review']
            before = self.gate.read_bytes()
            with self.assertRaises(ValueError): self.run_window()
            self.assertEqual(self.ops.calls, [])
            self.assertFalse(self.journal.exists())
            self.assertEqual(self.gate.read_bytes(), before)

    def test_recovery_approval_documents_changed_after_client_preflight_fail_before_mutation(self):
        for changed in ('policy', 'completion'):
            self.reset(); self.run_window()
            if changed == 'policy': self.ops.approved['auditRefs'] = ['audit:new-root-review']
            else: self.ops.evidence['auditRefs'] = ['audit:new-root-completion-review']
            before_gate, before_journal = self.gate.read_bytes(), self.journal.read_bytes()
            self.ops.calls.clear()
            with self.assertRaises(ValueError): self.recover()
            self.assertEqual(self.ops.calls, [])
            self.assertEqual(self.gate.read_bytes(), before_gate)
            self.assertEqual(self.journal.read_bytes(), before_journal)

    def test_completion_approval_drift_before_original_stop_never_stops(self):
        original = self.ops.validate_first_candidate
        def drift(release, policy):
            original(release, policy)
            self.ops.evidence['auditRefs'] = ['audit:changed-after-prepare']
        self.ops.validate_first_candidate = drift
        with self.assertRaises(f.tx.TransactionFailure): self.run_window()
        self.assertNotIn(('stop', A), self.ops.calls)
        self.assertNotIn(('stop', B), self.ops.calls)
        self.assertEqual(self.phase(), 'needs_attention')

    def test_known_original_legacy_still_running_may_recheck_without_adopting_replacement(self):
        original = self.window.write
        def crash(record, phase, **details):
            original(record, phase, **details)
            if phase == 'verified': raise Crash()
        self.window.write = crash
        with self.assertRaises(Crash): self.run_window()
        self.window.write = original
        self.assertEqual(self.recover()['phase'], 'recovered')
        self.assertEqual(self.ops.process(), PROCESS)
        self.assertFalse(any(call[0] == 'stop' for call in self.ops.calls))

    def test_unknown_new_legacy_process_after_lost_start_reply_stays_sealed(self):
        self.run_window(); start = self.ops.start
        def uncertain():
            start()
            if self.ops.release == A: raise OSError('legacy start reply lost after live PID')
        self.ops.start = uncertain
        with self.assertRaises(OSError): self.recover()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertNotIn('recoveryProcess', json.loads(self.journal.read_text()))
        self.assertNotIn(('safe-legacy-ready-account-sessions', A), self.ops.calls)
        self.ops.calls.clear()
        with self.assertRaises(f.tx.TransactionFailure): self.recover()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertEqual(self.ops.calls, [])
        self.assertEqual(json.loads(self.gate.read_text())['mode'], 'draining')

    def test_starting_legacy_journal_cannot_adopt_an_unrecorded_replacement(self):
        original = self.window.write
        def crash(record, phase, **details):
            original(record, phase, **details)
            if phase == 'verified': raise Crash()
        self.window.write = crash
        with self.assertRaises(Crash): self.run_window()
        self.window.write = original
        record = json.loads(self.journal.read_text()); record['phase'] = 'starting_legacy'
        f.tx.atomic_json(self.journal, record)
        self.ops.proc = dict(PROCESS, pid=909, startTicks=9009)
        with self.assertRaises(f.tx.TransactionFailure): self.recover()
        self.assertEqual(self.phase(), 'needs_attention')
        self.assertEqual(self.ops.calls, [('validate', B)])


class LegacyProtocolTests(unittest.TestCase):
    def setUp(self):
        self.policy, self.frontend, self.completion = documents()
        self.request = {'schemaVersion': 1, 'verifierProtocol': f.LEGACY_PROTOCOL, 'operationId': OP, 'backendRelease': A,
            'pid': 101, 'processStart': copy.deepcopy(PROCESS), 'nonce': '3' * 64, 'createdAt': 1000.0, 'expiresAt': 1120.0}
        self.seen = []
    def fetch(self, path):
        self.seen.append(path)
        if path == '/api/health/ready': body = {'status': 'ok', 'version': A}
        elif path == '/api/account': body = {'id': '12345678-1234-4234-8234-123456789abc', 'status': 'active', 'displayName': None, 'email': 'test@example.com'}
        elif path == '/api/sessions': body = {'sessions': []}
        else: raise AssertionError('Legacy verifier must not demand fake meta/drain/catalog/wallet routes')
        return 200, {'cache-control': 'private, no-store'}, body
    def test_actual_legacy_verifier_safe_paths_nonce_bound_without_meta_marker(self):
        result = v.verify(self.request, self.fetch, now=lambda: 1001)
        self.assertEqual(self.seen, list(f.LEGACY_PATHS) + ['/api/health/ready'])
        self.assertEqual(result['requestSha256'], f.digest(self.request))
        self.assertNotIn('catalogReady', result)
        self.assertNotIn('test@example.com', json.dumps(result))
        self.assertNotIn('12345678-1234-4234', json.dumps(result))
        self.assertEqual(result, f.validate_legacy_receipt(result, self.request, operation=OP, release=A, pid=101, now=1002))
    def test_legacy_v2_receipt_and_wrong_process_nonce_are_rejected(self):
        result = v.verify(self.request, self.fetch, now=lambda: 1001)
        for field, value in (('verifierProtocol', receipt.PROTOCOL), ('processStart', dict(PROCESS, startTicks=1)), ('nonce', '4' * 64), ('catalogReady', True)):
            bad = dict(result, **{field: value})
            with self.assertRaises(ValueError): f.validate_legacy_receipt(bad, self.request, operation=OP, release=A, pid=101, now=1002)
    def test_legacy_audit_cannot_be_catalog_or_success_boolean(self):
        for bad in ({'catalogReady': True}, {'walletLedgerReady': True}, True):
            with self.assertRaises(ValueError): f.validate_legacy_audit(bad, self.request, self.policy, 1001)
    def test_actual_private_receipt_kernel_accepts_only_exact_legacy_journal(self):
        result = v.verify(self.request, self.fetch, now=lambda: 1001)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); private = root / 'private'; private.mkdir(mode=0o700)
            incoming = root / 'incoming'; incoming.mkdir()
            body = json.dumps(result).encode(); (incoming / receipt.FILENAME).write_bytes(body)
            fd = os.open(incoming, os.O_RDONLY | os.O_DIRECTORY)
            journal = {'phase': 'checking_legacy', 'process': PROCESS}
            def check(value, *, operation, release):
                if value != journal or value['phase'] != 'checking_legacy': raise ValueError('wrong phase')
            try:
                got = receipt.accept_incoming(fd, private, request=self.request, journal=journal, operation=OP, release=A, pid=101,
                    current_release=lambda: A, live_pid=lambda: 101, expected_sha256=__import__('hashlib').sha256(body).hexdigest(), now=lambda: 1002,
                    owner_uid=os.getuid(), request_validator=f.validate_legacy_request, receipt_validator=f.validate_legacy_receipt, journal_validator=check)
                self.assertEqual(got, result)
            finally: os.close(fd)

if __name__ == '__main__': unittest.main()
