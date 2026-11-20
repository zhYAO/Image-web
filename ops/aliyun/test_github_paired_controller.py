"""Test orchestration with mock controllers; generates no real authorization."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('github-paired-controller.py')
SPEC = importlib.util.spec_from_file_location('pair_controller_test', FILE)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class ProtectedController(unittest.TestCase):
    def setUp(self):
        self.commit, self.at = 'a' * 40, 20_000
        self.pins = dict(commit=self.commit, runId=42, attempt=1, frontendNamespace='release-' + self.commit[:12])
        self.env = dict(GITHUB_EVENT_NAME='push', GITHUB_REF='refs/heads/main', GITHUB_REF_PROTECTED='true',
                        GITHUB_REPOSITORY='zhYAO/Image-web', RUNNER_ENVIRONMENT='self-hosted', RUNNER_OS='Linux',
                        ZIMAGE_PAIRED_ROLE='staging', ZIMAGE_PAIRED_ENABLED='true', GITHUB_SHA=self.commit,
                        GITHUB_RUN_ID='42', GITHUB_RUN_ATTEMPT='1', ZIMAGE_PAIRED_BRIDGE_SHA256='1' * 64)
        self.calls = []

    def run_stage(self):
        def bridge(phase, argument):
            self.calls.append((phase, argument))
            return dict(schemaVersion=1, kind='zimage-staging-authenticated-pair-v1', commit=self.commit,
                        runId=42, attempt=1, pairSha256=argument, stageReceiptSha256='2' * 64,
                        backendReceiptSha256='3' * 64, frontendAcceptanceSha256='4' * 64, checkedAt=self.at)
        return m.dispatch('staging', self.pins, self.env, bridge, now=self.at)

    def production_env(self):
        stage = self.run_stage()
        return dict(self.env, ZIMAGE_PAIRED_ROLE='production', STAGE_RECEIPT_SHA256=stage['stageReceiptSha256'],
                    STAGE_PAIR_SHA256=stage['pairSha256'], STAGE_CHECKED_AT=str(self.at))

    def authorize(self, request):
        return dict(schemaVersion=1, kind='zimage-independent-pair-approval-v1', commit=self.commit,
                    runId=42, attempt=1, **m.json.loads(request), independentApprovalSha256='5' * 64)

    def test_same_run_root_controller_staging_then_production_mock(self):
        env = self.production_env()
        def bridge(phase, canonical_gate):
            gate = m.json.loads(canonical_gate)
            self.calls.append((phase, gate['pairSha256']))
            if phase == 'authorization':
                return self.authorize(canonical_gate)
            return dict(schemaVersion=1, kind='zimage-ordinary-paired-release-v1', commit=self.commit,
                        runId=42, attempt=1, **gate, operationId='gha-42-1', backend=self.commit,
                        frontend=self.pins['frontendNamespace'], healthVerified=True, rollbackRecorded=True)
        promoted = m.dispatch('production', self.pins, env, bridge, now=self.at + 1)
        self.assertEqual([kind for kind, _ in self.calls], ['staging', 'authorization', 'production'])
        self.assertTrue(promoted['rollbackRecorded'])

    def test_mock_bridge_drives_actual_no_migration_kernel_under_one_lock(self):
        fixture_path = FILE.parent / 'paired'
        def load(alias, path):
            spec = importlib.util.spec_from_file_location(alias, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        kernel = load('ordinary', fixture_path / 'ordinary.py')
        import sys
        with patch.dict(sys.modules, {'ordinary': kernel}):
            fixture = load('ordinary_fixture_for_bridge', fixture_path / 'test_ordinary.py').Fixture()
        self.commit = fixture.packet['commit']
        self.pins.update(commit=self.commit, frontendNamespace=fixture.a['newPair']['frontend'])
        self.env['GITHUB_SHA'] = self.commit
        protected = self.production_env()
        fixture.packet.update(runId=42, attempt=1)
        fixture.a.update(operation='gha-42-1', packetSha256=kernel.sha(fixture.packet),
                         stagingAcceptanceSha256=protected['STAGE_RECEIPT_SHA256'])
        approval = kernel.sha(fixture.a)
        def bridge(phase, canonical_gate):
            if phase == 'authorization':
                return dict(self.authorize(canonical_gate), independentApprovalSha256=approval)
            gate = m.json.loads(canonical_gate)
            self.assertEqual(gate['independentApprovalSha256'], approval)
            selected = kernel.transition(fixture.packet, fixture.a, approval, fixture, clock=lambda:fixture.time)
            return dict(schemaVersion=1, kind='zimage-ordinary-paired-release-v1', commit=self.commit,
                        runId=42, attempt=1, **gate, operationId=selected['operation'], **selected['pair'],
                        healthVerified=selected['phase'] == 'opened', rollbackRecorded=True)
        result = m.dispatch('production', self.pins, protected, bridge, now=self.at + 1)
        self.assertEqual(result['backend'], self.commit)
        self.assertLess(fixture.calls.index('backend'), fixture.calls.index('frontend'))
        self.assertLess(fixture.calls.index('frontend'), fixture.calls.index('open'))
        self.assertEqual(fixture.state['databaseSha256'], fixture.a['databaseSha256'])
        self.assertEqual([e['phase'] for e in fixture.events][-2:], ['writes-may-open', 'opened'])

    def test_foreign_runner_diagnostic_or_namespace_does_not_enter_bridge(self):
        for values in ({'RUNNER_ENVIRONMENT': 'github-hosted'}, {'GITHUB_EVENT_NAME': 'workflow_dispatch'},
                       {'GITHUB_SHA': 'b' * 40}, {'GITHUB_REF_PROTECTED': 'false'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                m.dispatch('staging', self.pins, dict(self.env, **values), self.fail, now=self.at)
        with self.assertRaisesRegex(ValueError, 'Diagnostic frontend'):
            m.dispatch('staging', dict(self.pins, frontendNamespace='rehearsal'), self.env, self.fail, now=self.at)

    def test_production_declines_stale_foreign_and_missing_approval(self):
        env = self.production_env()
        for changed in ({'STAGE_PAIR_SHA256': 'f' * 64}, {'STAGE_CHECKED_AT': str(self.at - 7201)},
                        {'STAGE_RECEIPT_SHA256': ''}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                m.dispatch('production', self.pins, dict(env, **changed), self.fail, now=self.at)

    def test_missing_independent_root_approval_never_calls_mutating_phase(self):
        env = self.production_env()
        phases = []
        def bridge(phase, _):
            phases.append(phase)
            return None
        with self.assertRaisesRegex(ValueError, 'independently root-approved'):
            m.dispatch('production', self.pins, env, bridge, now=self.at)
        self.assertEqual(phases, ['authorization'])

    def test_receipt_cannot_report_success_without_verified_recovery(self):
        env = self.production_env()
        def bridge(phase, canonical_gate):
            if phase == 'authorization':
                return self.authorize(canonical_gate)
            return dict(schemaVersion=1, kind='zimage-ordinary-paired-release-v1', commit=self.commit,
                        runId=42, attempt=1, **m.json.loads(canonical_gate), operationId='gha-42-1',
                        backend=self.commit, frontend=self.pins['frontendNamespace'],
                        healthVerified=True, rollbackRecorded=False)
        with self.assertRaisesRegex(ValueError, 'recoverable prior state'):
            m.dispatch('production', self.pins, env, bridge, now=self.at)
