from contextlib import nullcontext
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import io
import os
from pathlib import Path
import socket
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import ordinary
import ordinary_restore
import ordinary_ssh
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
        proof = dict(commit=self.f.packet['commit'], pullRequest=22, ruleSuiteId=5, checkRunId=6, workflowRunId=7,
                     workflowSha256='7' * 64)
        self.gate = Mock(spec=['lock', 'lock_identity', 'claim_restoration', 'journal'])
        self.gate.lock.return_value = nullcontext()
        self.gate.claim_restoration.return_value = (dict(retained=retained, protectedMerge=proof,
                                                        initial=dict(self.old, frontendArtifact='1' * 64)),
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

    def test_original_protected_pr_evidence_is_required_for_restoration(self):
        initial, _ = self.gate.claim_restoration.return_value
        del initial['protectedMerge']
        with self.assertRaisesRegex(ValueError, 'Exact record'):
            self.run_restore()
        self.authority.verify_public_failure.assert_not_called()
        self.reverse.seal.assert_not_called()

    @unittest.skipUnless(os.name == 'posix', 'Requires POSIX stream descriptors')
    def test_interactive_restore_receipt_names_both_persisted_signed_observations(self):
        import core
        from ordinary_journal import JournalGate, PHASES
        from test_ordinary_authority import AuthorityTest
        with patch.object(sys, 'path', [str(Path(__file__).resolve().parents[1]), *sys.path]):
            import github_pair_handoff as handoff
            import github_pair_ssh as ssh
            import ordinary_public_exchange as wire
            from test_github_pair_public import public_responses

        fixture = AuthorityTest()
        fixture.setUp()
        self.f.a = fixture.approval
        self.policy['operationId'] = self.f.a['operation']
        fixture.writer.side_effect = fixture.put
        authority = fixture.driver
        authority.database_digest = self.authority.database_digest
        authority.assert_other_writers_clear = self.authority.assert_other_writers_clear
        authority.verify_restored_candidate = self.authority.verify_restored_candidate
        packet, approval = fixture.packet, fixture.approval
        digest = ordinary.sha(approval)
        operation = approval['operation']
        host = Mock(clock=lambda: self.f.time, authority=authority, restore=ordinary_restore.restore)

        def authorize(request):
            self.assertEqual(request, packet)
            return fixture.authorize()

        host.authorization.side_effect = authorize
        host.system_for.return_value = self.system
        selector = dict(packet=packet, approvalSha256=digest)
        raw = io.BytesIO()
        handoff.send_restoration(selector, raw, interactive=True)
        responses = public_responses(self.old['backend'])

        def fetch(path):
            if self.live['backend'] == self.new['backend']:
                return 503, 'text/html', 'no-store', b''
            return responses[path]

        def sign(subject, *, deadline):
            return hashlib.sha256(subject).digest()

        def verify(subject, bundle):
            self.assertEqual(bundle, sign(subject, deadline=None))

        left, right = socket.socketpair()
        with left, right, tempfile.TemporaryDirectory() as scratch, ThreadPoolExecutor(max_workers=1) as workers:
            root = Path(scratch).resolve()
            (root / 'deploy.lock').touch(mode=0o600)
            (root / 'ordinary-operations').mkdir(0o700)
            host.gate = JournalGate(root, core, owner_uid=os.getuid())
            original, generation = self.gate.claim_restoration.return_value
            evidence = {'seal-intent': original, 'writes-may-open': generation}
            with host.gate.lock():
                host.gate.assert_clear(operation)
                for phase in PHASES:
                    host.gate.journal(dict(operation=operation, rootApprovalSha256=digest, phase=phase),
                                      evidence=evidence.get(phase))
            deadline = time.monotonic() + 10
            host_frames = wire.Frames(left.fileno(), left.fileno(), deadline=deadline)
            client_frames = wire.Frames(right.fileno(), right.fileno(), deadline=deadline)

            def dispatch():
                result = ordinary_ssh.run(SimpleNamespace(read=host_frames.read_bytes), scratch=scratch, host=host,
                    handoff=handoff, ordinary=ordinary,
                    observe_public=lambda **options: wire.receive_signed_observation(host_frames, verify=verify, **options))
                host_frames.write(result, 16384)
                return result

            client_frames.write_bytes(raw.getvalue())
            pending = workers.submit(dispatch)
            received = ssh.observe_restoration(client_frames, selector=selector, rollback=self.old, sign=sign, fetch=fetch)
            result = pending.result()
            with host.gate.lock():
                self.assertEqual(host.gate.restoration_receipt(operation, digest), result)
        self.assertEqual(wire.decode(received), result)
        self.assertEqual(result['restoredPair'], self.old)
        for phase, field in [('candidate', 'publicFailureSha256'), ('restored', 'publicRestorationSha256')]:
            self.assertIn(fixture.directory / f'{phase}-public-{result[field]}.json', fixture.files)

    @unittest.skipUnless(os.name == 'posix', 'Requires a real POSIX deployment lock')
    def test_public_failure_to_recovery_receipt_uses_fixed_frame_and_durable_journal(self):
        import core
        from ordinary_journal import JournalGate, PHASES

        # The host installs both directories in one pinned import closure.
        with patch.object(sys, 'path', [str(Path(__file__).resolve().parents[1]), *sys.path]):
            import github_pair_handoff as handoff
            import github_pair_public as public
            import github_pair_ssh as ssh
            from test_github_pair_public import public_responses

        packet, approval = self.f.packet, self.f.a
        operation, digest = approval['operation'], ordinary.sha(approval)
        with tempfile.TemporaryDirectory(prefix='ordinary-restore-fixture-') as temp:
            root = Path(temp).resolve()
            (root / 'deploy.lock').touch(mode=0o600)
            (root / 'ordinary-operations').mkdir(0o700)
            gate = JournalGate(root, core, owner_uid=os.getuid())
            original, generation = self.gate.claim_restoration.return_value
            evidence = {'seal-intent': original, 'writes-may-open': generation}
            with gate.lock():
                gate.assert_clear(operation)
                for phase in PHASES:
                    gate.journal(dict(operation=operation, rootApprovalSha256=digest, phase=phase), evidence=evidence.get(phase))

            host = Mock(gate=gate, clock=lambda: self.f.time, authority=self.authority, restore=ordinary_restore.restore)
            host.authorization.return_value = dict(approval=approval, sha256=digest, stageSha256='8' * 64)
            host.system_for.return_value = self.system

            def dispatch(**extra):
                stream = io.BytesIO()
                handoff.send_restoration(dict(packet=packet, approvalSha256=digest, **extra), stream)
                stream.seek(0)
                return ordinary_ssh.run(stream, scratch=root, host=host, handoff=handoff, ordinary=ordinary)

            with self.assertRaisesRegex(ValueError, 'Exact record'):
                dispatch(target=self.old)
            host.authorization.assert_not_called()
            self.authority.verify_public_failure.side_effect = ValueError('No independent public failure')
            with self.assertRaisesRegex(ValueError, 'No independent public failure'):
                dispatch()
            self.reverse.seal.assert_not_called()
            self.authority.verify_public_failure.side_effect = None

            request = root / 'client'
            request.mkdir()
            commit, run, attempt = (packet[field] for field in ('commit', 'runId', 'attempt'))
            (request / 'pins.json').write_bytes(core.canonical(dict(commit=commit, runId=run, attempt=attempt,
                backend={'manifestSha256': packet['backendManifestSha256']},
                frontend={'subjectSha256': packet['frontendSubjectSha256']})))
            (request / 'stage.json').write_bytes(b'non-production fixture stage')
            deployment, witness, baseline, observation, restored = [root / (name + '.json') for name in
                ('deployment', 'failure-witness', 'baseline', 'observation', 'restored')]
            opened_receipt = dict(schemaVersion=1, kind='zimage-ordinary-pair-v1', status='opened',
                operationId=operation, commit=commit, runId=run, attempt=attempt, backendRelease=commit,
                frontendRelease=self.new['frontend'], backendManifestSha256=packet['backendManifestSha256'],
                frontendSubjectSha256=packet['frontendSubjectSha256'], stageSha256=handoff.file_sha(request / 'stage.json'),
                rootApprovalSha256=digest, rollbackPair=self.old, rollbackAcceptanceSha256=approval['baselineAcceptanceSha256'])
            deployment.write_bytes(core.canonical(opened_receipt))
            baseline.write_bytes(core.canonical(public.capture(fetch=public_responses(self.old['backend']).__getitem__)))
            responses = public_responses(commit)
            responses['/workspace'] = (503, 'text/html', 'no-store', b'')
            with self.assertRaises(public.ContractFailure):
                public.verify_with_witness(commit, witness, fetch=responses.__getitem__)
            result_observation = public.record_failure_observation(commit, deployment, baseline, witness,
                                                                   fetch=responses.__getitem__)
            self.assertIs(result_observation['recoveryVerified'], False)
            observation.write_bytes(core.canonical(result_observation))

            def fixture_transport(argv, *, stdin, stdout, **_):
                self.assertEqual(argv[-1], handoff.COMMAND)
                received = ordinary_ssh.run(stdin, scratch=root, host=host, handoff=handoff, ordinary=ordinary)
                stdout.write(core.canonical(received))
                return SimpleNamespace(returncode=0)

            with patch.object(ssh.subprocess, 'run', side_effect=fixture_transport) as transport:
                ssh.request_restore(request, deployment, observation, restored, public_baseline=baseline,
                                    host='nonproduction.invalid', known_hosts='nonproduction.invalid ssh-ed25519 ' + 'A' * 68,
                                    key='-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n')
            transport.assert_called_once()
            result = public.small_json(restored)
            self.assertEqual(result['restoredPair'], self.old)
            with gate.lock():
                self.assertEqual(gate.restoration_receipt(operation, digest), result)
            restored_public = public.verify_restored(commit, result, fetch=public_responses(self.live['backend']).__getitem__)
            self.assertEqual(restored_public['backendRelease'], self.old['backend'])
            self.assertEqual(restored_public['frontendRelease'], self.old['frontend'])
            with self.assertRaisesRegex(ValueError, 'eligible for restoration'):
                dispatch()
            self.reverse.seal.assert_called_once()
