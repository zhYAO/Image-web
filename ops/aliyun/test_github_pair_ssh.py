import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import github_pair_ssh as ssh


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
