"""Real temporary frontend artifacts with injected service/ingress boundaries."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import unittest

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


first = load('bootstrap_first_fixtures', HERE / 'test_first_window.py')
front = load('bootstrap_front_fixtures', HERE.parent / 'frontend/test_frontend_release.py')
core = load('bootstrap_core_test', HERE / 'frontend_bootstrap.py')
A, B, OP = first.A, first.B, first.OP
NAMESPACE = 'web-A'


class FrontendBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.files = front.ReleaseTests()
        self.files.setUp()
        self.addCleanup(self.files.tearDown)
        self.publisher = self.files.adapter
        self.files.meta['backendRelease'] = B
        self.files.options['verifiedBackendReleases'] = [B]
        dist = self.files.dist()
        candidate_path = dist / '.release/candidate.json'
        candidate = self.files.m.parse(candidate_path.read_bytes())
        candidate['allowedBackendReleases'] = [B]
        candidate_path.write_bytes(self.files.m.canonical(candidate))
        evidence = self.files.evidence(dist)
        evidence['backendReleases'][0]['backendRelease'] = B
        self.report = self.files.m.pack(dist, self.files.root / 'bootstrap.tgz', self.files.options, self.files.public, evidence)
        incoming = self.files.server / 'incoming'
        incoming.mkdir()
        shutil.copyfile(self.report['archive'], incoming / ('frontend-' + OP + '.tgz'))
        self.gate = self.files.server / 'backend-maintenance.json'
        self.journal = self.files.server / 'first-window-current.json'
        first.f.tx.atomic_json(self.gate, {'schemaVersion': 2, 'operationId': OP, 'mode': 'draining'})
        self.ops = first.Ops(self.gate)
        self.ops.approved['frontendBootstrap'] = {
            'namespace': NAMESPACE, 'manifestSha256': self.report['manifestSha256'],
            'splitIngressSha256': '8' * 64, 'maintenanceMapsSha256': '9' * 64,
            'maintenanceServerSha256': '0' * 64,
        }
        self.policy_sha = first.f.digest(self.ops.approved)
        self.ops.evidence['policySha256'] = self.policy_sha
        self.completion_sha = first.f.digest(self.ops.evidence)
        self.now, self.tick = 1000, 0
        self.front_marker, self.opened, self.receipt = None, False, None
        self.digests = {key: self.ops.approved['frontendBootstrap'][key] for key in core.INGRESS_KEYS}
        self.ops.frontend_current_exists = lambda: self.publisher.current() is not None
        self.ops.frontend_checking = lambda: copy.deepcopy(self.front_marker)
        self.ops.frontend_mark = self.mark
        self.ops.frontend_ingress_receipt = lambda: copy.deepcopy(self.receipt)
        self.ops.bootstrap_ingress_digests = lambda policy: dict(self.digests)
        self.ops.ingress_open_exists = lambda: self.opened
        self.ops.open_ingress = self.open_ingress
        self.ops.seal_ingress = self.seal_ingress
        self.window = first.f.FirstWindow(self.ops, self.gate, self.journal,
            clock=lambda: self.tick, wall=lambda: self.now, wait=self.wait)
        self.window.run(B, A, OP, expected_policy_sha256=self.policy_sha,
                        expected_completion_sha256=self.completion_sha, timeout=1)
        self.bootstrap = core.FrontendBootstrap(self.window, self.publisher, clock=lambda: self.now)
        self.probes = []
        self.publisher.probe = self.probe

    def wait(self, seconds): self.tick += seconds
    def mark(self, value): self.front_marker = copy.deepcopy(value)
    def open_ingress(self, policy):
        self.assertEqual(self.mode(), 'open')
        self.opened = True
        self.ops.token, self.ops.checking = None, None
    def seal_ingress(self, policy):
        self.opened = False
        self.ops.token, self.ops.checking = first.f.seal_token(policy), None
    def mode(self): return json.loads(self.gate.read_text())['mode']
    def backend_record(self): return json.loads(self.journal.read_text())
    def probe(self, namespace, backend):
        self.probes.append((namespace, backend))
        self.assertEqual(backend, B)
        self.assertEqual(self.mode(), 'checking')
        self.assertFalse(self.opened)
        # None is a real API-only public baseline: no static F0 is invented.
        if namespace is None:
            self.assertIsNone(self.publisher.current())
        else:
            self.assertEqual(namespace, NAMESPACE)
            self.files.m.verify(self.publisher.base / 'releases' / namespace, self.report['manifestSha256'])
        return True

    def prepare(self):
        record = self.bootstrap.prepare(OP, self.policy_sha, self.completion_sha)
        self.ops.ingress_sha = self.digests['splitIngressSha256']
        self.receipt = {'schemaVersion': 1, 'protocol': 'zimage-frontend-bootstrap-ingress-v1',
            'operationId': OP, 'policySha256': self.policy_sha, 'backendProcess': copy.deepcopy(self.ops.proc),
            'ingressConfigSha256': self.digests['splitIngressSha256'],
            'maintenanceMapsSha256': self.digests['maintenanceMapsSha256'],
            'maintenanceServerSha256': self.digests['maintenanceServerSha256'],
            'checkedAt': 1000, 'expiresAt': 1600,
            'coverage': [{'category': key, 'evidenceSha256': '1' * 64, 'auditRef': 'audit:bootstrap-' + key,
                          'outcome': 'writes-sealed'} for key in first.f.COVERAGE],
            'auditRefs': ['audit:loaded-split-ingress'], 'reviewDecision': 'split-readonly-ingress-reviewed'}
        return record

    def deploy(self): return self.bootstrap.deploy(OP, self.policy_sha, self.completion_sha, self.report['archiveSha256'])
    def rollback(self): return self.bootstrap.rollback(OP, self.policy_sha, self.completion_sha)
    def open(self): return self.bootstrap.open(OP, self.policy_sha, self.completion_sha)

    def test_prepare_retains_backend_ready_and_enables_only_checking(self):
        record = self.prepare()
        self.assertEqual(record['phase'], 'backend_ready')
        self.assertFalse(record['writesOpened'])
        self.assertEqual(self.mode(), 'checking')
        self.assertEqual(self.ops.checking, first.f.seal_token(self.ops.approved))
        self.assertIsNone(self.front_marker)
        self.assertIsNone(self.publisher.current())
        self.assertFalse(self.opened)

    def test_prepare_refuses_leftover_static_marker_before_changing_gates(self):
        self.front_marker = core.marker(self.ops.approved)
        with self.assertRaises((ValueError, RuntimeError)):
            self.bootstrap.prepare(OP, self.policy_sha, self.completion_sha)
        self.assertEqual(self.mode(), 'draining')
        self.assertIsNone(self.ops.checking)
        self.assertEqual(self.front_marker, core.marker(self.ops.approved))
        self.assertFalse(self.opened)

    def test_first_public_baseline_is_api_only_then_real_static_artifact_checks(self):
        self.prepare()
        record = self.deploy()
        self.assertEqual(record['state'], 'committed')
        self.assertEqual(self.probes, [(None, B), (NAMESPACE, B)])
        self.assertEqual(self.publisher.current(), NAMESPACE)
        self.assertEqual(self.front_marker, core.marker(self.ops.approved))
        self.assertEqual(self.mode(), 'checking')
        self.assertFalse(self.backend_record()['writesOpened'])

    def test_rollback_to_genuine_none_retains_artifact_and_remains_closed(self):
        self.prepare(); self.deploy()
        record = self.rollback()
        self.assertEqual(record['state'], 'bootstrap_reverted')
        self.assertIsNone(self.publisher.current())
        self.assertIsNone(self.front_marker)
        self.assertTrue((self.publisher.base / 'releases' / NAMESPACE / 'assets/main.js').is_file())
        self.assertTrue((self.publisher.base / 'objects').is_dir())
        self.assertEqual(self.mode(), 'draining')
        self.assertFalse(self.opened)
        self.assertEqual(self.rollback()['state'], 'bootstrap_reverted')

    def test_active_business_work_prevents_rollback_unlink_after_checking(self):
        self.prepare(); self.deploy()
        self.ops.active['pendingFinalizers'] = 1
        calls = list(self.ops.calls)
        with self.assertRaises(TimeoutError): self.rollback()
        self.assertEqual(self.publisher.current(), NAMESPACE)
        self.assertEqual(self.mode(), 'draining')
        self.assertFalse(self.opened)
        self.assertEqual(self.ops.calls, calls)
        record = self.publisher.read_json(self.publisher.base / 'journal' / (OP + '.json'))
        self.assertEqual(record['state'], 'committed')

    def test_foreign_or_stale_receipt_rejects_before_publication(self):
        self.prepare()
        original = copy.deepcopy(self.receipt)
        for mutate in (lambda x: x.update(expiresAt=999), lambda x: x.update(operationId='other-operation'),
                       lambda x: x['backendProcess'].update(startTicks=1),
                       lambda x: x.update(maintenanceMapsSha256='2' * 64),
                       lambda x: x.update(coverage=[]), lambda x: x['coverage'][0].update(outcome='unknown')):
            self.receipt = copy.deepcopy(original); mutate(self.receipt)
            with self.subTest(receipt=self.receipt), self.assertRaises((ValueError, RuntimeError)):
                self.deploy()
            self.assertIsNone(self.publisher.current())
            self.assertFalse(os.path.lexists(self.publisher.base / 'assets' / NAMESPACE))
            self.assertIsNone(self.front_marker)

    def test_split_and_both_includes_are_rechecked_before_publication(self):
        self.prepare()
        for key in core.INGRESS_KEYS:
            original = self.digests[key]; self.digests[key] = '3' * 64
            with self.subTest(key=key), self.assertRaises((ValueError, RuntimeError)): self.deploy()
            self.digests[key] = original
            self.assertIsNone(self.publisher.current())
            self.assertIsNone(self.front_marker)

    def test_process_replacement_refuses_deploy_and_does_not_claim_new_pid(self):
        self.prepare(); self.ops.proc['startTicks'] += 1
        with self.assertRaises((ValueError, RuntimeError)): self.deploy()
        self.assertIsNone(self.publisher.current())
        self.assertIsNone(self.front_marker)

    def test_foreign_marker_is_never_removed_by_rollback(self):
        self.prepare(); self.deploy()
        self.front_marker['operationId'] = 'different-operation'
        retained = copy.deepcopy(self.front_marker)
        with self.assertRaises((ValueError, RuntimeError)): self.rollback()
        self.assertEqual(self.front_marker, retained)
        self.assertEqual(self.publisher.current(), NAMESPACE)

    def test_later_sequence_refuses_aba_rollback_even_when_namespace_matches(self):
        self.prepare(); self.deploy()
        path = self.publisher.base / 'sequence.json'
        sequence = self.publisher.read_json(path)['sequence']
        self.publisher.json_write(path, {'sequence': sequence + 1})
        with self.assertRaises((ValueError, RuntimeError)): self.rollback()
        self.assertEqual(self.publisher.current(), NAMESPACE)
        self.assertEqual(self.front_marker, core.marker(self.ops.approved))

    def test_missing_current_without_prior_rollback_intent_is_drift(self):
        self.prepare(); self.deploy()
        self.publisher.atomic_pointer('current', None)
        with self.assertRaises((ValueError, RuntimeError)): self.rollback()
        record = self.publisher.read_json(self.publisher.base / 'journal' / (OP + '.json'))
        self.assertEqual(record['state'], 'committed')

    def test_expired_ingress_receipt_blocks_open_but_does_not_prevent_safe_rollback(self):
        self.prepare(); self.deploy(); self.now = 1601
        with self.assertRaises((ValueError, RuntimeError)): self.open()
        self.assertEqual(self.rollback()['state'], 'bootstrap_reverted')
        self.assertFalse(self.opened)

    def test_crash_after_pointer_switch_can_resume_exact_same_unopened_artifact(self):
        self.prepare()
        def crash(phase):
            if phase == 'after_switch': raise first.Crash()
        self.publisher.checkpoint = crash
        with self.assertRaises(first.Crash): self.deploy()
        self.assertEqual(self.publisher.current(), NAMESPACE)
        self.assertEqual(self.mode(), 'checking')
        self.publisher.checkpoint = lambda phase: None
        self.assertEqual(self.deploy()['state'], 'committed')
        self.assertFalse(self.opened)

    def test_crash_after_rollback_unlink_is_confirmed_from_durable_intent(self):
        self.prepare(); self.deploy()
        original = self.publisher.atomic_pointer
        def crash(name, namespace):
            original(name, namespace)
            if name == 'current' and namespace is None: raise first.Crash()
        self.publisher.atomic_pointer = crash
        with self.assertRaises(first.Crash): self.rollback()
        self.assertIsNone(self.publisher.current())
        self.publisher.atomic_pointer = original
        self.assertEqual(self.rollback()['state'], 'bootstrap_reverted')
        self.assertEqual(self.mode(), 'draining')
        self.assertFalse(self.opened)

    def test_open_records_irreversible_intent_and_preserves_exact_pair(self):
        self.prepare(); self.deploy()
        record = self.open()
        self.assertTrue(record['writesOpened'])
        self.assertEqual(record['phase'], 'committed')
        self.assertTrue(self.opened)
        self.assertEqual(self.mode(), 'open')
        self.assertIsNone(self.front_marker)
        self.assertEqual(self.publisher.current(), NAMESPACE)
        with self.assertRaises((ValueError, RuntimeError)): self.rollback()

    def test_frontend_disappearance_during_final_drain_never_opens_ingress(self):
        self.prepare(); self.deploy()
        drain = self.window.engine.drain
        def disappear(*args, **kwargs):
            result = drain(*args, **kwargs)
            self.publisher.atomic_pointer('current', None)
            return result
        self.window.engine.drain = disappear
        with self.assertRaises((ValueError, RuntimeError)): self.open()
        self.assertFalse(self.opened)
        self.assertEqual(self.mode(), 'draining')
        self.assertFalse(self.backend_record()['writesOpened'])

    def test_backend_replacement_during_public_probe_cannot_open_or_stop_new_pid(self):
        self.prepare(); self.deploy()
        probe = self.publisher.probe
        def replace(namespace, backend):
            result = probe(namespace, backend)
            self.ops.proc['startTicks'] += 1
            return result
        self.publisher.probe = replace
        calls = list(self.ops.calls)
        with self.assertRaises((ValueError, RuntimeError)): self.open()
        self.assertFalse(self.opened)
        self.assertEqual(self.ops.calls, calls)
        self.assertFalse(self.backend_record()['writesOpened'])

    def test_failed_open_stays_closed_and_never_allows_automatic_b0_recovery(self):
        self.prepare(); self.deploy()
        def partial_open(policy):
            self.open_ingress(policy)
            raise RuntimeError('failure after public gate write')
        self.ops.open_ingress = partial_open
        with self.assertRaisesRegex(RuntimeError, 'failure after public gate write'): self.open()
        self.assertFalse(self.opened)
        self.assertEqual(self.mode(), 'draining')
        self.assertTrue(self.backend_record()['writesMayHaveOpened'])
        calls = list(self.ops.calls)
        with self.assertRaises((ValueError, RuntimeError)):
            self.window.recover(OP, expected_policy_sha256=self.policy_sha, expected_completion_sha256=self.completion_sha)
        self.assertEqual(self.ops.calls, calls)

    def test_process_change_at_public_open_reseals_without_claiming_commit(self):
        self.prepare(); self.deploy()
        def changed_process(policy):
            self.open_ingress(policy)
            self.ops.proc['startTicks'] += 1
        self.ops.open_ingress = changed_process
        with self.assertRaisesRegex(ValueError, 'pair changed after ingress opening'): self.open()
        self.assertFalse(self.opened)
        self.assertEqual(self.mode(), 'draining')
        self.assertEqual(self.backend_record()['phase'], 'needs_attention')
        self.assertTrue(self.backend_record()['writesMayHaveOpened'])

    def test_pointer_disappearance_during_rollback_drain_is_not_adopted(self):
        self.prepare(); self.deploy()
        original = self.window.engine.drain
        def changed_pointer(*args, **kwargs):
            result = original(*args, **kwargs)
            self.publisher.atomic_pointer('current', None)
            return result
        self.window.engine.drain = changed_pointer
        with self.assertRaisesRegex(ValueError, 'changed during rollback drain'): self.rollback()
        record = self.publisher.read_json(self.publisher.base / 'journal' / (OP + '.json'))
        self.assertEqual(record['state'], 'committed')
        self.assertEqual(self.mode(), 'draining')
        self.assertFalse(self.opened)


if __name__ == '__main__': unittest.main()
