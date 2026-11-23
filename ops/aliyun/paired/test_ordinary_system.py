from contextlib import nullcontext
from copy import deepcopy
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

import ordinary
import ordinary_ssh
from ordinary_system import OrdinarySystem
from test_ordinary import Fixture


class SystemTest(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        packet, approval = self.fixture.packet, self.fixture.a
        self.live = dict(backend=approval['oldPair']['backend'], frontend=approval['oldPair']['frontend'],
                         process={'pid': 101}, frontendSequence=7, frontendArtifact='1' * 64,
                         configurationSha256='2' * 64, ingressSha256='3' * 64,
                         ingressMode='open', nodeMode='open', fence=None)
        self.system = Mock()
        self.system.p = dict(operationId=approval['operation'], oldBackend=self.live['backend'],
                             oldFrontend=self.live['frontend'], newBackend=packet['commit'],
                             newFrontend=approval['newPair']['frontend'], backendManifestSha256=packet['backendManifestSha256'],
                             oldFrontendArtifact=self.live['frontendArtifact'], configurationSha256=self.live['configurationSha256'],
                             ingressSha256=self.live['ingressSha256'], frontendCandidateSha256='4' * 64,
                             frontendPayloadSha256='5' * 64)
        self.system.snapshot.side_effect = lambda: deepcopy(self.live)
        self.system.paths.root = Path('fixture')
        self.system.raw.return_value = b'7' * 64
        self.system.c.digest.return_value = '8' * 64
        self.system.pub.sealed.return_value = dict(artifactId=self.live['frontendArtifact'], sourceSHA=self.live['backend'])
        self.system.pub.checked_meta.return_value = self.live['backend']
        self.system.seal.side_effect = lambda record: self.live.update(ingressMode='sealed', fence=record['operationId'])
        self.system.drain.side_effect = lambda *_: self.live.update(ingressMode='sealed', nodeMode='draining')
        self.system.stop.side_effect = lambda *_: self.live.update(process=None)
        self.system.select_backend.side_effect = lambda _: self.live.update(backend=packet['commit'])
        self.system.start.side_effect = self.start
        self.system.publish_frontend.side_effect = self.frontend
        self.system.open.side_effect = lambda *_: self.live.update(ingressMode='open', nodeMode='open', fence=None)
        self.gate = Mock(spec=['lock', 'lock_identity', 'assert_clear', 'journal'])
        self.gate.lock.return_value = nullcontext()
        self.authority = Mock(spec=['assert_other_writers_clear', 'assert_main', 'database_digest',
                                    'verify_protected_merge', 'verify_baseline', 'prepare', 'verify_candidate'])
        self.authority.database_digest.return_value = approval['databaseSha256']
        self.authority.prepare.return_value = dict(archiveSha256=approval['frontendArchiveSha256'],
                                                    manifestSha256=approval['frontendManifestSha256'],
                                                    candidateSha256=self.system.p['frontendCandidateSha256'],
                                                    payloadSha256=self.system.p['frontendPayloadSha256'])
        self.ops = OrdinarySystem(self.system, self.gate, self.authority, 'private-request', {'stageSha256': '6' * 64})

    def start(self, record, release):
        self.assertEqual(record['phase'], 'backend_select_intent')
        self.assertEqual(self.live['backend'], release)
        self.live.update(ingressMode='checking', nodeMode='checking', process={'pid': 202})
        return deepcopy(self.live)

    def frontend(self, record, approval):
        self.assertEqual(record['candidateProcess'], {'pid': 202})
        self.live.update(frontend=self.system.p['newFrontend'], frontendSequence=8)
        return deepcopy(self.live)

    def run_release(self):
        f = self.fixture
        return ordinary.transition(f.packet, f.a, ordinary.sha(f.a), self.ops, clock=lambda: f.time)

    def test_switches_real_adapter_methods_under_one_gate_and_records_recovery_evidence(self):
        result = self.run_release()
        self.assertEqual(result['pair'], self.fixture.a['newPair'])
        self.gate.lock.assert_called_once_with(blocking=False)
        entries = self.gate.journal.call_args_list
        self.assertEqual([entry.args[0]['phase'] for entry in entries],
                         ['seal-intent', 'backend-intent', 'frontend-intent', 'writes-may-open', 'opened'])
        self.assertEqual(entries[0].kwargs['evidence']['initial']['backend'], self.fixture.a['oldPair']['backend'])
        self.assertEqual(entries[3].kwargs['evidence'], {'process': {'pid': 202}, 'pairSequence': 8})
        rollback = self.fixture.a['oldPair']['backend']
        self.system.m.adapter.verify_retained_layered.assert_called_once_with(
            Path('fixture') / 'releases' / rollback, rollback, run_probe=False)
        self.authority.verify_candidate.assert_called_once_with({'pid': 202}, self.fixture.packet, self.fixture.a)
        self.authority.verify_protected_merge.assert_called_once_with(self.fixture.packet)
        self.assertEqual(self.live['nodeMode'], 'open')

    def test_unproven_protected_merge_does_not_stage_or_switch(self):
        self.authority.verify_protected_merge.side_effect = ValueError('required check proof missing')
        with self.assertRaisesRegex(ValueError, 'required check proof missing'):
            self.run_release()
        self.authority.prepare.assert_not_called()
        self.gate.journal.assert_not_called()
        self.system.seal.assert_not_called()

    def test_refuses_missing_recovery_evidence_before_first_intent(self):
        self.authority.verify_baseline.side_effect = ValueError('rollback proof missing')
        with self.assertRaisesRegex(ValueError, 'rollback proof missing'):
            self.run_release()
        self.gate.journal.assert_not_called()
        self.system.seal.assert_not_called()

    def test_damaged_retained_pair_does_not_stage_or_switch(self):
        self.system.m.adapter.verify_retained_layered.side_effect = ValueError('corrupt rollback backend')
        with self.assertRaisesRegex(ValueError, 'corrupt rollback backend'):
            self.run_release()
        self.authority.prepare.assert_not_called()
        self.gate.journal.assert_not_called()
        self.system.seal.assert_not_called()

    def test_candidate_auth_failure_does_not_open_or_emit_success(self):
        self.authority.verify_candidate.side_effect = ValueError('candidate proof missing')
        with self.assertRaisesRegex(ValueError, 'candidate proof missing'):
            self.run_release()
        self.assertEqual(self.gate.journal.call_args.args[0]['phase'], 'frontend-intent')
        self.system.open.assert_not_called()

    def test_prepared_frontend_digest_drift_refuses_switch(self):
        self.authority.prepare.return_value['manifestSha256'] = '9' * 64
        with self.assertRaisesRegex(ValueError, 'Prepared frontend differs'):
            self.run_release()
        self.gate.journal.assert_not_called()
        self.system.seal.assert_not_called()

    def test_ssh_reply_requires_independent_authorization_and_completed_transition(self):
        f = self.fixture
        stage = 'e' * 64
        handoff = Mock()
        handoff.admit.return_value = {'packet': f.packet, 'stageSha256': stage, 'rollbackPair': f.a['oldPair']}
        host = Mock(system=self.system, gate=self.gate, authority=self.authority)
        host.clock.return_value = f.time
        host.authorization.return_value = dict(approval=f.a, sha256=ordinary.sha(f.a), stageSha256='f' * 64)
        with tempfile.TemporaryDirectory() as scratch:
            with self.assertRaisesRegex(ValueError, 'verified stage'):
                ordinary_ssh.run(io.BytesIO(), scratch=scratch, host=host, handoff=handoff, ordinary=ordinary)
            self.gate.lock.assert_not_called()
            self.gate.journal.assert_not_called()
            host.authorization.return_value['stageSha256'] = stage
            handoff.admit.return_value['rollbackPair'] = dict(backend='c' * 40, frontend='release-' + 'c' * 12)
            with self.assertRaisesRegex(ValueError, 'public rollback pair differs'):
                ordinary_ssh.run(io.BytesIO(), scratch=scratch, host=host, handoff=handoff, ordinary=ordinary)
            self.gate.lock.assert_not_called()
            handoff.admit.return_value['rollbackPair'] = f.a['oldPair']
            receipt = ordinary_ssh.run(io.BytesIO(), scratch=scratch, host=host, handoff=handoff, ordinary=ordinary)
        self.assertEqual(receipt['status'], 'opened')
        self.assertEqual(receipt['rootApprovalSha256'], ordinary.sha(f.a))
        self.assertEqual(receipt['rollbackPair'], f.a['oldPair'])
        self.assertEqual(receipt['rollbackAcceptanceSha256'], f.a['baselineAcceptanceSha256'])
        self.assertEqual(receipt['frontendRelease'], f.a['newPair']['frontend'])
