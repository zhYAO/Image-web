import hashlib
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import core
import ordinary
from test_ordinary import Fixture


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
authority = load('test_host_authority', HERE / 'ordinary-authority.py')
receipt = load('test_backend_receipt', HERE.parent / 'backend/receipt.py')
with patch.object(sys, 'path', [str(HERE.parent), *sys.path]):
    import github_pair_public as public_checks


class AuthorityTest(unittest.TestCase):
    def setUp(self):
        f = Fixture()
        self.packet, self.approval = f.packet, f.a
        self.approval['operation'] = 'zimage-release-1-2'
        self.now = 130
        self.files = {authority.TOKEN: b'fixture-only\n'}
        self.read = Mock(side_effect=self.read_file)
        self.trusted = Mock()
        self.put(authority.CONFIG, dict(schemaVersion=1, signerPolicy={'repositoryId': 15}, mergePolicy={},
                                         attestationDigests={}))
        self.driver = authority.Authority(core=core, tools=SimpleNamespace(receipt=receipt), public=public_checks,
                                          read=self.read, trusted=self.trusted, root=Path('unused'), clock=lambda: self.now)
        self.directory = authority.EVIDENCE / '1-2'
        self.authorization = authority.AUTHORIZATIONS / '1-2.json'
        self.lifecycle = {field: 'e' * 64 for field in authority.LIFECYCLE}
        self.lifecycle.update(operationId=self.approval['operation'], oldBackend=self.approval['oldPair']['backend'],
                              oldFrontend=self.approval['oldPair']['frontend'], newBackend=self.packet['commit'],
                              newFrontend=self.approval['newPair']['frontend'],
                              backendManifestSha256=self.packet['backendManifestSha256'])

    def read_file(self, path, limit, **_):
        if path not in self.files:
            raise FileNotFoundError(path)
        data = self.files[path]
        self.assertLessEqual(len(data), limit)
        return data

    def put(self, path, value):
        data = core.canonical(value)
        self.files[path] = data
        return hashlib.sha256(data).hexdigest()

    def authorize(self):
        self.put(self.authorization, dict(schemaVersion=1, approval=self.approval, sha256=ordinary.sha(self.approval),
                                          stageSha256='f' * 64, lifecycle=self.lifecycle,
                                          lifecycleSha256=core.digest(self.lifecycle)))
        return self.driver.authorization(self.packet)

    def evidence(self, filename, kind, **attributes):
        return self.put(self.directory / filename, dict(schemaVersion=1, kind=kind,
                        packetSha256=self.approval['packetSha256'], operationId=self.approval['operation'],
                        observedAt=self.now, **attributes))

    def public(self, pair):
        return dict(schemaVersion=1, backendRelease=pair['backend'], frontendRelease=pair['frontend'],
                    health='ok', routes=['/', '/login', '/workspace', '/assets', '/account'], anonymousSessionStatus=401)

    def test_authority_is_root_local_and_matches_one_batch_and_lifecycle(self):
        self.read.assert_any_call(authority.TOKEN, 1024, private=True)
        self.assertEqual(self.authorize()['stageSha256'], 'f' * 64)
        self.assertEqual(self.driver.lifecycle_policy(self.packet, self.approval), self.lifecycle)
        self.trusted.assert_any_call(authority.AUTHORIZATIONS, True)
        self.trusted.assert_any_call(self.directory, True)
        with self.assertRaises(FileNotFoundError):
            self.driver.authorization(dict(self.packet, attempt=3))
        with self.assertRaisesRegex(ValueError, 'no exact authorized batch'):
            self.driver.lifecycle_policy(self.packet, self.approval)
        self.lifecycle['newBackend'] = 'a' * 40
        with self.assertRaisesRegex(ValueError, 'lifecycle pair differs'):
            self.authorize()

    def test_operation_identity_cannot_be_reassigned(self):
        self.approval['operation'] = 'zimage-release-1-3'
        self.lifecycle['operationId'] = self.approval['operation']
        with self.assertRaisesRegex(ValueError, 'one journal identity'):
            self.authorize()

    def test_database_observation_requires_exact_project_packet_and_freshness(self):
        self.authorize()
        fields = dict(projectRef=authority.PROJECT, contractSha256=self.approval['databaseSha256'], readOnly=True)
        self.evidence('database.json', 'zimage-ordinary-database-v1', **fields)
        self.assertEqual(self.driver.database_digest(), self.approval['databaseSha256'])
        file = self.directory / 'database.json'
        original = core.parse(self.files[file])
        for change in (dict(projectRef='different'), dict(readOnly=False), dict(observedAt=self.now - 121),
                       dict(packetSha256='f' * 64)):
            with self.subTest(change=change):
                self.put(file, dict(original, **change))
                with self.assertRaises(ValueError):
                    self.driver.database_digest()

    def test_baseline_requires_the_drill_and_public_acceptance_for_the_retained_pair(self):
        old = self.approval['oldPair']
        initial = dict(old, frontendArtifact='e' * 64, process={'pid': 101})
        public = self.directory / 'rollback-public.json'
        acceptance = self.public(old)
        public_digest = self.put(public, acceptance)
        drill_digest = self.put(self.directory / 'rollback-drill.json', dict(schemaVersion=1,
                                kind='zimage-ordinary-rollback-drill-v1', pair=old,
                                retainedArtifact=initial['frontendArtifact'], status='restored',
                                publicAcceptanceSha256=public_digest))
        self.approval['baselineAcceptanceSha256'] = self.evidence('baseline.json', 'zimage-ordinary-baseline-v1',
                                                                 pair=old, snapshotSha256=core.digest(initial),
                                                                 rollbackDrillSha256=drill_digest)
        self.authorize()
        self.driver.verify_baseline(initial, self.approval)
        with self.assertRaisesRegex(ValueError, 'Live baseline'):
            self.driver.verify_baseline(dict(initial, process={'pid': 102}), self.approval)
        self.put(public, dict(acceptance, routes=['/']))
        with self.assertRaisesRegex(ValueError, 'public readiness'):
            self.driver.verify_baseline(initial, self.approval)
        del self.files[public]
        with self.assertRaises(FileNotFoundError):
            self.driver.verify_baseline(initial, self.approval)

    def test_candidate_requires_existing_nonce_and_readonly_receipt_for_exact_process(self):
        self.authorize()
        operation, release = self.approval['operation'], self.packet['commit']
        process = dict(pid=202, start=11)
        request = dict(schemaVersion=1, operationId=operation, backendRelease=release, pid=process['pid'],
                       nonce='a' * 64, createdAt=125, expiresAt=150)
        checks = [dict(path=path, status=200, noStore=True, authenticated=i >= 2)
                  for i, path in enumerate(receipt.PATHS)]
        response = dict(schemaVersion=1, verifierProtocol=receipt.PROTOCOL, operationId=operation,
                        backendRelease=release, pid=process['pid'], nonce=request['nonce'],
                        requestSha256=receipt.request_digest(request), checkedAt=129, checks=checks,
                        authenticatedReadOnly=True, independentPublic=True, catalogReady=True)
        self.evidence('candidate.json', 'zimage-ordinary-candidate-v1', process=process, request=request, receipt=response)
        self.driver.verify_candidate(process, self.packet, self.approval)
        with self.assertRaisesRegex(ValueError, 'exact live process'):
            self.driver.verify_candidate(dict(process, start=12), self.packet, self.approval)
        response['nonce'] = 'b' * 64
        self.evidence('candidate.json', 'zimage-ordinary-candidate-v1', process=process, request=request, receipt=response)
        with self.assertRaisesRegex(ValueError, 'nonce binding'):
            self.driver.verify_candidate(process, self.packet, self.approval)

    def test_restored_claim_requires_exact_public_check_document(self):
        self.authorize()
        pair = self.approval['oldPair']
        snapshot = dict(pair, process={'pid': 303})
        filename = self.directory / 'restored-public-acceptance.json'
        checks_digest = self.put(filename, self.public(pair))
        digest = self.evidence('public-restored.json', 'zimage-ordinary-public-v1', pair=pair,
                               snapshotSha256=core.digest(snapshot), status='passed', checksSha256=checks_digest)
        self.assertEqual(self.driver.verify_public_restoration(self.packet, self.approval, snapshot), digest)
        self.put(filename, self.public(self.approval['newPair']))
        with self.assertRaisesRegex(ValueError, 'public readiness'):
            self.driver.verify_public_restoration(self.packet, self.approval, snapshot)

    def test_public_failure_requires_hash_linked_response_for_the_exact_opened_pair(self):
        self.authorize()
        pair = self.approval['newPair']
        snapshot = dict(pair, process={'pid': 303})
        filename = self.directory / 'failed-public-acceptance.json'
        witness = public_checks.capture_failure(pair['backend'], fetch=lambda _: (503, 'text/html', 'no-store', b''))

        def bind_witness(checks):
            return self.evidence('public-failure.json', 'zimage-ordinary-public-v1', pair=pair,
                                 snapshotSha256=core.digest(snapshot), status='failed', checksSha256=checks)

        expected = bind_witness(core.digest(witness))
        with self.assertRaises(FileNotFoundError):
            self.driver.verify_public_failure(self.packet, self.approval, snapshot)
        self.put(filename, witness)
        self.assertEqual(self.driver.verify_public_failure(self.packet, self.approval, snapshot), expected)
        with self.assertRaisesRegex(ValueError, 'live pair'):
            self.driver.verify_public_failure(self.packet, self.approval, dict(snapshot, process={'pid': 304}))
        witness['check']['status'] = 200
        tampered_digest = self.put(filename, witness)
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.driver.verify_public_failure(self.packet, self.approval, snapshot)
        bind_witness(tampered_digest)
        with self.assertRaisesRegex(ValueError, 'contradicts'):
            self.driver.verify_public_failure(self.packet, self.approval, snapshot)
