from contextlib import nullcontext
from copy import deepcopy
import unittest
from unittest.mock import Mock

import ordinary
import ordinary_restore
from test_ordinary import Fixture


class RestoreTest(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.old = self.f.a['oldPair']
        self.new = self.f.a['newPair']
        self.system = Mock()
        self.policy = self.system.p = dict(operationId=self.f.a['operation'], oldBackend=self.old['backend'],
                                          oldFrontend=self.old['frontend'], newBackend=self.new['backend'],
                                          newFrontend=self.new['frontend'], oldFrontendArtifact='1' * 64,
                                          configurationSha256='2' * 64, ingressSha256='3' * 64)
        self.live = dict(self.new, process={'pid': 42}, frontendSequence=8,
                         configurationSha256=self.policy['configurationSha256'],
                         ingressSha256=self.policy['ingressSha256'], ingressMode='open', nodeMode='open',
                         fence=None, markers={'open': {'operation': self.f.a['operation']}})
        self.system.snapshot.side_effect = lambda: deepcopy(self.live)
        self.system.token.return_value = self.live['markers']['open']
        self.reverse = self.system.reversal.return_value
        self.reverse.token.return_value = {'operation': 'restoration'}
        self.reverse.snapshot.side_effect = lambda: deepcopy(self.live)
        self.reverse.pub.sealed.return_value = dict(artifactId='1' * 64, sourceSHA=self.old['backend'])
        self.reverse.seal.side_effect = lambda _: self.live.update(ingressMode='sealed', fence='restoration')
        self.reverse.drain.side_effect = lambda *_: self.live.update(ingressMode='sealed', nodeMode='draining')
        self.reverse.stop.side_effect = lambda *_: self.live.update(process=None)
        self.reverse.select_backend.side_effect = lambda _: self.live.update(backend=self.old['backend'])
        self.reverse.start.side_effect = self.start
        self.reverse.publish_frontend.side_effect = self.frontend
        self.reverse.open.side_effect = self.reopen
        self.reverse.hold.side_effect = lambda _: self.live.update(ingressMode='sealed', nodeMode='draining')
        retained = dict(backendManifestSha256='4' * 64, frontendManifestSha256='5' * 64, frontendArtifact='1' * 64)
        self.gate = Mock(spec=['lock', 'lock_identity', 'claim_restoration', 'journal'])
        self.gate.lock.return_value = nullcontext()
        self.gate.claim_restoration.return_value = (dict(retained=retained, initial=dict(self.old, frontendArtifact='1' * 64)),
                                                    dict(process={'pid': 42}, pairSequence=8))
        self.authority = Mock(spec=['assert_other_writers_clear', 'database_digest', 'verify_public_failure',
                                    'verify_restored_candidate', 'verify_public_restoration'])
        self.authority.database_digest.return_value = self.f.a['databaseSha256']
        self.authority.verify_public_failure.return_value = '6' * 64
        self.authority.verify_public_restoration.return_value = '7' * 64

    def start(self, record, release):
        self.assertEqual(self.live['backend'], release)
        self.assertEqual(self.live['frontend'], self.new['frontend'])
        self.live.update(process={'pid': 77}, ingressMode='checking', nodeMode='checking')
        return deepcopy(self.live)

    def frontend(self, record, approval):
        self.assertEqual(self.live['nodeMode'], 'checking')
        self.live.update(frontend=self.old['frontend'], frontendSequence=9)
        return deepcopy(self.live)

    def reopen(self, record, process):
        self.assertEqual(record['phase'], 'opening')
        self.assertEqual(self.gate.journal.call_args.args[0]['phase'], 'restore-open-intent')
        self.live.update(ingressMode='open', nodeMode='open', fence=None, markers={'open': self.reverse.token()})

    def run_restore(self):
        f = self.f
        return ordinary_restore.restore(f.packet, f.a, ordinary.sha(f.a), system=self.system, gate=self.gate,
                                        authority=self.authority, ordinary=ordinary, clock=lambda: f.time)

    def test_restores_both_components_and_only_journals_final_verified_receipt(self):
        receipt = self.run_restore()
        self.assertEqual(receipt['restoredPair'], self.old)
        self.assertEqual(receipt['publicFailureSha256'], '6' * 64)
        self.assertEqual(receipt['publicRestorationSha256'], '7' * 64)
        self.assertEqual(self.live['backend'], self.old['backend'])
        self.assertEqual(self.live['frontend'], self.old['frontend'])
        self.assertEqual([entry.args[0]['phase'] for entry in self.gate.journal.call_args_list],
                         ['restore-intent', 'restore-open-intent', 'restored'])
        self.assertEqual(self.gate.journal.call_args.kwargs['evidence'], receipt)
        self.assertIs(self.reverse.finish_frontend.call_args.kwargs['remember_previous'], False)

    def test_stale_generation_is_rejected_before_failure_probe_or_writes(self):
        self.live['frontendSequence'] += 1
        with self.assertRaisesRegex(ValueError, 'generation'):
            self.run_restore()
        self.authority.verify_public_failure.assert_not_called()
        self.gate.journal.assert_not_called()
        self.reverse.seal.assert_not_called()

    def test_missing_independent_failure_evidence_blocks_before_restoration_intent(self):
        self.authority.verify_public_failure.side_effect = ValueError('public failure unproven')
        with self.assertRaisesRegex(ValueError, 'unproven'):
            self.run_restore()
        self.gate.journal.assert_not_called()
        self.reverse.seal.assert_not_called()

    def test_checking_failure_seals_and_never_opens_the_old_pair(self):
        self.authority.verify_restored_candidate.side_effect = ValueError('old authenticated check failed')
        with self.assertRaisesRegex(ValueError, 'authenticated'):
            self.run_restore()
        self.reverse.open.assert_not_called()
        self.reverse.hold.assert_called_once()
        self.assertEqual(self.gate.journal.call_args.args[0]['phase'], 'restore-intent')

    def test_unverified_public_restoration_reseals_and_final_receipt_is_absent(self):
        self.authority.verify_public_restoration.side_effect = ValueError('public restoration unproven')
        with self.assertRaisesRegex(ValueError, 'restoration unproven'):
            self.run_restore()
        self.reverse.hold.assert_called_once()
        self.assertEqual(self.live['ingressMode'], 'sealed')
        self.assertEqual(self.gate.journal.call_args.args[0]['phase'], 'restore-open-intent')
