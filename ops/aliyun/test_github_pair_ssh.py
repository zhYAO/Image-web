import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import github_pair_handoff as handoff
import github_pair_public as public
import github_pair_ssh as ssh
from test_github_pair_public import public_responses


class PairSshTest(unittest.TestCase):
    def setUp(self):
        self.host = 'ecs.example.invalid'
        self.host_key = self.host + ' ssh-ed25519 ' + 'A' * 68
        self.identity = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n'

    def test_single_forced_command_and_ephemeral_identity(self):
        with ssh.invocation(self.host, self.host_key, self.identity) as argv:
            self.assertEqual(argv[-2:], ['zimage-release@' + self.host, 'zimage-publish-pair-v1'])
            self.assertIn('StrictHostKeyChecking=yes', argv)
            self.assertIn('ClearAllForwardings=yes', argv)
            self.assertIn('IdentityAgent=none', argv)
            identity = Path(argv[argv.index('-i') + 1])
            self.assertEqual(identity.read_bytes(), self.identity.encode())
            self.assertNotIn(self.identity, ' '.join(argv))
        self.assertFalse(identity.exists())

    def test_rejects_option_injection_and_foreign_or_unpinned_host_keys(self):
        for host, key in (('-oProxyCommand=bad', self.host_key),
                          (self.host, '* ssh-ed25519 ' + 'A' * 68),
                          (self.host, self.host_key + '\nexample.invalid ssh-ed25519 ' + 'A' * 68),
                          (self.host, self.host_key.replace('ssh-ed25519', 'ssh-rsa'))):
            with self.subTest(host=host, key=key), self.assertRaises(ValueError):
                with ssh.invocation(host, key, self.identity):
                    self.fail('Unexpected SSH invocation')

    def test_receipt_must_bind_open_pair_run_stage_and_tested_recovery(self):
        commit, rollback = 'a' * 40, 'b' * 40
        with tempfile.TemporaryDirectory() as temp:
            request = Path(temp)
            pins = dict(commit=commit, runId=12, attempt=2, backend={'manifestSha256': 'c' * 64},
                        frontend={'subjectSha256': 'd' * 64})
            (request / 'pins.json').write_bytes(json.dumps(pins).encode())
            (request / 'stage.json').write_bytes(b'stage')
            receipt = dict(schemaVersion=1, kind='zimage-ordinary-pair-v1', status='opened',
                           operationId='release-12-2', commit=commit, runId=12, attempt=2,
                           backendRelease=commit, frontendRelease='release-' + commit[:12],
                           backendManifestSha256='c' * 64, frontendSubjectSha256='d' * 64,
                           stageSha256=hashlib.sha256(b'stage').hexdigest(), rootApprovalSha256='e' * 64,
                           rollbackPair=dict(backend=rollback, frontend='release-' + rollback[:12]),
                           rollbackAcceptanceSha256='f' * 64)
            self.assertEqual(ssh.validate_receipt(json.dumps(receipt).encode(), request, rollback), receipt)
            for key, value in (('status', 'intake-only'), ('attempt', 1), ('stageSha256', '0' * 64),
                               ('frontendRelease', 'release-' + rollback[:12]), ('rollbackAcceptanceSha256', None),
                               ('rollbackPair', dict(backend=commit, frontend='release-' + commit[:12]))):
                with self.subTest(key=key), self.assertRaises((ValueError, TypeError)):
                    ssh.validate_receipt(json.dumps(dict(receipt, **{key: value})).encode(), request, rollback)

    def test_two_simulated_releases_each_capture_and_bind_the_immediately_previous_pair(self):
        live = 'a' * 40
        previous_releases = []
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for batch, next_commit in enumerate(('b' * 40, 'c' * 40), 1):
                request = root / f'request-{batch}'
                request.mkdir()
                for name, _ in handoff.MEMBERS:
                    (request / name).write_bytes(b'fixture')
                pins = dict(commit=next_commit, runId=batch, attempt=1, backend={'manifestSha256': '2' * 64},
                            frontend={'subjectSha256': '3' * 64})
                (request / 'pins.json').write_bytes(json.dumps(pins).encode())
                before = public.capture(public_responses(live).__getitem__)
                baseline = root / f'old-public-{batch}.json'
                baseline.write_bytes(json.dumps(before).encode())
                receipt = root / f'receipt-{batch}.json'

                def nonproduction_transport(argv, *, stdin, stdout, **kwargs):
                    nonlocal live
                    incoming = root / f'wire-{batch}'
                    incoming.mkdir()
                    handoff.receive(stdin, incoming)
                    old = json.loads((incoming / 'rollback.json').read_bytes())
                    self.assertEqual(old, dict(backend=live, frontend='release-' + live[:12]))
                    previous_releases.append(old['backend'])
                    live = next_commit
                    stdout.write(json.dumps(dict(schemaVersion=1, kind='zimage-ordinary-pair-v1', status='opened',
                                                 operationId=f'fixture-release-{batch}', commit=live, runId=batch, attempt=1,
                                                 backendRelease=live, frontendRelease='release-' + live[:12],
                                                 backendManifestSha256='2' * 64, frontendSubjectSha256='3' * 64,
                                                 stageSha256=handoff.file_sha(incoming / 'stage.json'), rootApprovalSha256='4' * 64,
                                                 rollbackPair=old, rollbackAcceptanceSha256='5' * 64)).encode())
                    return SimpleNamespace(returncode=0)

                with patch.object(ssh.subprocess, 'run', side_effect=nonproduction_transport):
                    ssh.publish(request, receipt, host=self.host, known_hosts=self.host_key,
                                key=self.identity, public_baseline=baseline)
                self.assertEqual(public.verify(next_commit, fetch=public_responses(live).__getitem__)['backendRelease'], live)
                self.assertEqual(json.loads(receipt.read_bytes())['rollbackPair']['backend'], before['backendRelease'])
        self.assertEqual(previous_releases, ['a' * 40, 'b' * 40])

    def test_failed_public_observation_and_recovery_receipt_bind_the_original_deployment(self):
        commit, rollback = 'b' * 40, 'a' * 40
        operation, approval = 'zimage-release-1-2', '4' * 64
        connection = dict(host=self.host, known_hosts=self.host_key, key=self.identity)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pins = dict(commit=commit, runId=1, attempt=2, backend={'manifestSha256': '2' * 64},
                        frontend={'subjectSha256': '3' * 64})
            (root / 'pins.json').write_bytes(json.dumps(pins).encode())
            (root / 'stage.json').write_bytes(b'stage')
            baseline = public.capture(public_responses(rollback).__getitem__)
            baseline_path = root / 'baseline.json'
            baseline_path.write_bytes(json.dumps(baseline).encode())
            old = dict(backend=rollback, frontend='release-' + rollback[:12])
            deployed = dict(schemaVersion=1, kind='zimage-ordinary-pair-v1', status='opened', operationId=operation,
                            commit=commit, runId=1, attempt=2, backendRelease=commit, frontendRelease='release-' + commit[:12],
                            backendManifestSha256='2' * 64, frontendSubjectSha256='3' * 64,
                            stageSha256=handoff.file_sha(root / 'stage.json'), rootApprovalSha256=approval, rollbackPair=old,
                            rollbackAcceptanceSha256='5' * 64)
            deployment = root / 'deployment.json'
            deployment.write_bytes(json.dumps(deployed).encode())
            failure = root / 'failure.json'
            hint = public.observe_after_failure(commit, deployed, baseline, fetch=public_responses(rollback).__getitem__)
            hint['deploymentReceiptSha256'] = handoff.file_sha(deployment)
            result = root / 'restoration.json'
            recovery_id = hashlib.sha256(f'{{"approval":"{approval}","operation":"{operation}"}}\n'.encode())
            restored = dict(schemaVersion=1, kind='zimage-ordinary-restoration-v1', status='restored', operationId=operation,
                            restorationOperationId='restore-' + recovery_id.hexdigest()[:48], commit=commit, runId=1,
                            attempt=2, rootApprovalSha256=approval, restoredPair=old, rollbackAcceptanceSha256='5' * 64,
                            publicFailureSha256='6' * 64, publicRestorationSha256='7' * 64)

            def request_restore():
                return ssh.request_restore(root, deployment, failure, result, public_baseline=baseline_path, **connection)

            def transport(argv, *, stdin, stdout, **_):
                self.assertEqual(argv[-1], handoff.COMMAND)
                self.assertEqual(handoff.receive(stdin, root / 'unused'), dict(approvalSha256=approval,
                    packet=dict(repository=handoff.REPO, workflow=handoff.WORKFLOW, commit=commit, runId=1, attempt=2,
                                backendManifestSha256='2' * 64, frontendSubjectSha256='3' * 64)))
                stdout.write(json.dumps(restored).encode())
                return SimpleNamespace(returncode=0)

            with patch.object(ssh.subprocess, 'run', side_effect=transport) as ssh_run:
                failure.write_bytes(json.dumps(dict(hint, deploymentReceiptSha256='0' * 64)).encode())
                with self.assertRaisesRegex(ValueError, 'original release'):
                    request_restore()
                ssh_run.assert_not_called()
                failure.write_bytes(json.dumps(hint).encode())
                restored['restoredPair'] = dict(backend=commit, frontend='release-' + commit[:12])
                with self.assertRaisesRegex(ValueError, 'exact completed receipt'):
                    request_restore()
                self.assertFalse(result.exists())
                restored['restoredPair'] = old
                self.assertEqual(request_restore(), handoff.file_sha(result))
                self.assertEqual(json.loads(result.read_bytes()), restored)
