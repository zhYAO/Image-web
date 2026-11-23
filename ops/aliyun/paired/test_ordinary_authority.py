import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
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
transaction = load('test_backend_transaction', HERE.parent / 'backend/transaction.py')
with patch.object(sys, 'path', [str(HERE.parent), *sys.path]):
    import github_pair_public as public_checks
with patch.object(sys, 'path', [str(HERE.parent / 'backend'), *sys.path]):
    import test_verify as backend_fixture


PROCESS = {'pid': 202, 'startTicks': 11, 'bootId': '00000000-0000-4000-8000-000000000001'}


class AuthorityTest(unittest.TestCase):
    def setUp(self):
        f = Fixture()
        self.packet, self.approval = f.packet, f.a
        self.approval['operation'] = 'zimage-release-1-2'
        self.now = 130
        self.elapsed = 0
        self.files = {authority.TOKEN: b'fixture-only\n'}
        self.read = Mock(side_effect=self.read_file)
        self.trusted = Mock()
        self.writer = Mock(side_effect=self.publish_and_respond)
        self.put(authority.CONFIG, dict(schemaVersion=1, signerPolicy={'repositoryId': 15}, mergePolicy={},
                                         attestationDigests={}))
        tools = SimpleNamespace(receipt=receipt, transaction=SimpleNamespace(atomic_json=self.writer))
        self.driver = authority.Authority(core=core, tools=tools, public=public_checks, read=self.read,
                                          trusted=self.trusted, root=Path('unused'), clock=lambda: self.now,
                                          monotonic=lambda: self.elapsed, sleep=self.tick)
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

    def tick(self, seconds):
        self.elapsed += seconds

    def publish_and_respond(self, path, challenge):
        self.put(path, challenge)
        response = self.verifier_response(challenge)
        self.put(path.with_name(path.name.replace('-challenge', '')), response)

    def verifier_response(self, challenge):
        release = challenge['request']['backendRelease']
        fixture = backend_fixture.VerifierTests()
        fixture.setUp()

        def fetch(path):
            status, headers, body = fixture.fetch(path)
            if path == '/api/health/ready':
                body['version'] = release
            elif path == '/api/meta':
                body['backendRelease'] = release
            return status, headers, body

        output = io.StringIO()
        backend_fixture.verifier.serve(io.StringIO(core.canonical(challenge).decode()), output, fetch, now=lambda: self.now)
        ready, response = (json.loads(body) for body in output.getvalue().splitlines())
        self.assertIs(ready['ready'], True)
        self.assertEqual(fixture.seen, [*backend_fixture.verifier.PATHS, '/api/meta'])
        self.assertNotIn('private@example.test', output.getvalue())
        return response

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
        initial = dict(old, frontendArtifact='e' * 64, process=dict(PROCESS, pid=101))
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
        challenge = core.parse(self.files[self.directory / 'baseline-readonly-challenge.json'])
        self.assertEqual(challenge['request']['backendRelease'], old['backend'])
        with self.assertRaisesRegex(ValueError, 'Live baseline'):
            self.driver.verify_baseline(dict(initial, process={'pid': 102}), self.approval)
        self.put(public, dict(acceptance, routes=['/']))
        with self.assertRaisesRegex(ValueError, 'public readiness'):
            self.driver.verify_baseline(initial, self.approval)
        del self.files[public]
        with self.assertRaises(FileNotFoundError):
            self.driver.verify_baseline(initial, self.approval)

    def test_candidate_and_restoration_get_distinct_host_challenges_for_exact_processes(self):
        self.authorize()
        self.driver.verify_candidate(PROCESS, self.packet, self.approval)
        restored = dict(PROCESS, pid=303, startTicks=21)
        self.driver.verify_restored_candidate(restored, self.packet, self.approval)
        initial, recovery = [call.args[1] for call in self.writer.call_args_list]
        self.assertEqual(initial['process'], PROCESS)
        self.assertEqual(recovery['process'], restored)
        self.assertEqual(recovery['request']['backendRelease'], self.approval['oldPair']['backend'])
        self.assertNotEqual(initial['request']['nonce'], recovery['request']['nonce'])
        self.assertEqual(recovery['request']['expiresAt'], self.approval['expiresAt'])
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.driver.verify_candidate(PROCESS, self.packet, self.approval)
        self.assertEqual(self.writer.call_count, 2)

    def test_verifier_cannot_substitute_challenge_nonce_or_process_start(self):
        self.authorize()
        for change in ('nonce', 'process', 'receipt-nonce'):
            def respond(path, challenge):
                self.put(path, challenge)
                response = self.verifier_response(challenge)
                if change == 'nonce':
                    response['request'] = dict(response['request'], nonce='d' * 64)
                elif change == 'process':
                    response['process'] = dict(response['process'], startTicks=12)
                else:
                    response['receipt'] = dict(response['receipt'], nonce='d' * 64)
                self.put(path.with_name('candidate.json'), response)
            self.files.pop(self.directory / 'candidate-challenge.json', None)
            self.writer.side_effect = respond
            message = 'nonce binding' if change == 'receipt-nonce' else 'fresh challenge and exact live process'
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, message):
                self.driver.verify_candidate(PROCESS, self.packet, self.approval)

    def test_missing_verifier_receipt_times_out_at_the_authorized_expiry(self):
        self.authorize()
        self.writer.side_effect = self.put
        with self.assertRaisesRegex(ValueError, 'did not return a receipt in time'):
            self.driver.verify_candidate(PROCESS, self.packet, self.approval)
        self.assertEqual(self.elapsed, 20)
        self.writer.assert_called_once()

    @unittest.skipUnless(os.name == 'posix', 'Requires the actual POSIX challenge writer')
    def test_live_challenge_crosses_a_private_file_boundary_before_receipt_acceptance(self):
        self.authorize()
        with tempfile.TemporaryDirectory(prefix='ordinary-challenge-fixture-') as tmp:
            directory = Path(tmp)
            self.driver.batch['directory'] = directory
            self.driver.tools.transaction = transaction
            self.driver.read = lambda path, limit, **_: path.read_bytes()

            def independent_verifier(_):
                challenge = directory / 'candidate-challenge.json'
                self.assertEqual(stat.S_IMODE(challenge.stat().st_mode), 0o600)
                response = self.verifier_response(core.parse(challenge.read_bytes()))
                transaction.atomic_json(directory / 'candidate.json', response)

            self.driver.sleep = Mock(side_effect=independent_verifier)
            self.driver.verify_candidate(PROCESS, self.packet, self.approval)
            self.driver.sleep.assert_called_once()

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
