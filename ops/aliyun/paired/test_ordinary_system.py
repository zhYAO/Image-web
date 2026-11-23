from contextlib import nullcontext
from copy import deepcopy
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import ordinary
import ordinary_ssh
from ordinary_system import OrdinarySystem
from test_ordinary import Fixture, pair


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
        self.authority = Mock(spec=['assert_other_writers_clear', 'database_digest', 'verify_baseline', 'verify_candidate'])
        self.authority.database_digest.return_value = approval['databaseSha256']
        self.github = Mock(spec=['assert_main', 'merge', 'get', 'verify'])
        self.github.merge.return_value = {'commit': packet['commit'], 'pullRequest': 22, 'ruleSuiteId': 17}
        stage = patch('ordinary_system.ordinary_stage.prepare')
        self.prepare = stage.start()
        self.addCleanup(stage.stop)
        self.prepare.return_value = dict(archiveSha256=approval['frontendArchiveSha256'],
                                         manifestSha256=approval['frontendManifestSha256'],
                                         candidateSha256=self.system.p['frontendCandidateSha256'],
                                         payloadSha256=self.system.p['frontendPayloadSha256'])
        self.ops = OrdinarySystem(self.system, self.gate, self.authority, Path('private-request'),
                                  {'stageSha256': '6' * 64}, intake=Mock(), github=self.github)

    def start(self, record, release):
        self.assertEqual(record['phase'], 'backend_select_intent')
        self.assertEqual(self.live['backend'], release)
        self.live.update(ingressMode='checking', nodeMode='checking', process={'pid': 201 + self.fixture.packet['runId']})
        return deepcopy(self.live)

    def frontend(self, record, approval):
        self.assertEqual(record['candidateProcess'], {'pid': 202})
        self.live.update(frontend=self.system.p['newFrontend'], frontendSequence=self.live['frontendSequence'] + 1)
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
        self.github.merge.assert_called_once_with(self.fixture.packet)
        self.assertEqual(entries[0].kwargs['evidence']['protectedMerge'], self.github.merge.return_value)
        self.assertEqual(self.live['nodeMode'], 'open')

    def test_unproven_protected_merge_does_not_stage_or_switch(self):
        self.github.merge.side_effect = ValueError('required check proof missing')
        with self.assertRaisesRegex(ValueError, 'required check proof missing'):
            self.run_release()
        self.prepare.assert_not_called()
        self.gate.journal.assert_not_called()
        self.system.seal.assert_not_called()

    @unittest.skipUnless(os.name == 'posix', 'Requires a real POSIX deployment lock')
    def test_two_successive_transactions_retain_the_immediately_prior_pair(self):
        import core
        from ordinary_journal import JournalGate

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'deploy.lock').touch(mode=0o600)
            (root / 'ordinary-operations').mkdir(0o700)
            for run, old, new in ((1, pair('a'), pair('b')), (2, pair('b'), pair('c'))):
                operation = f'zimage-release-{run}-2'
                self.fixture.packet.update(runId=run, commit=new['backend'])
                self.fixture.a.update(operation=operation, oldPair=old, newPair=new,
                                      packetSha256=ordinary.sha(self.fixture.packet))
                self.system.p.update(operationId=operation, oldBackend=old['backend'], oldFrontend=old['frontend'],
                                     newBackend=new['backend'], newFrontend=new['frontend'])
                self.github.merge.return_value = {'commit': new['backend'], 'pullRequest': run, 'ruleSuiteId': run}
                self.system.pub.sealed.return_value['sourceSHA'] = old['backend']
                self.system.pub.checked_meta.return_value = old['backend']
                gate = JournalGate(root, core, owner_uid=os.getuid())
                self.ops = OrdinarySystem(self.system, gate, self.authority, Path('private-request'),
                                          {'stageSha256': '6' * 64}, intake=Mock(), github=self.github)
                self.assertEqual(self.run_release()['pair'], new)
                held = JournalGate(root, core, owner_uid=os.getuid())
                with held.lock():
                    original, opened = held.claim_restoration(operation, ordinary.sha(self.fixture.a))
                self.assertEqual({key: original['initial'][key] for key in old}, old)
                self.assertEqual(opened['pairSequence'], 7 + run)

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
        self.prepare.assert_not_called()
        self.gate.journal.assert_not_called()
        self.system.seal.assert_not_called()

    def test_candidate_auth_failure_does_not_open_or_emit_success(self):
        self.authority.verify_candidate.side_effect = ValueError('candidate proof missing')
        with self.assertRaisesRegex(ValueError, 'candidate proof missing'):
            self.run_release()
        self.assertEqual(self.gate.journal.call_args.args[0]['phase'], 'frontend-intent')
        self.system.open.assert_not_called()

    def test_prepared_frontend_digest_drift_refuses_switch(self):
        self.prepare.return_value['manifestSha256'] = '9' * 64
        with self.assertRaisesRegex(ValueError, 'Prepared frontend differs'):
            self.run_release()
        self.gate.journal.assert_not_called()
        self.system.seal.assert_not_called()

    def test_ssh_reply_requires_independent_authorization_and_completed_transition(self):
        f = self.fixture
        stage = 'e' * 64
        handoff = Mock()
        handoff.admit.return_value = {'packet': f.packet, 'stageSha256': stage, 'rollbackPair': f.a['oldPair']}
        host = Mock(gate=self.gate, authority=self.authority, github=self.github)
        host.system_for.return_value = self.system
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
        host.system_for.assert_called_once_with(f.packet, f.a)
        self.assertEqual(receipt['status'], 'opened')
        self.assertEqual(receipt['rootApprovalSha256'], ordinary.sha(f.a))
        self.assertEqual(receipt['rollbackPair'], f.a['oldPair'])
        self.assertEqual(receipt['rollbackAcceptanceSha256'], f.a['baselineAcceptanceSha256'])
        self.assertEqual(receipt['frontendRelease'], f.a['newPair']['frontend'])
