import io
import json
import unittest
from unittest.mock import patch

import test_frontend_release as fixtures


class FlowReleaseTests(unittest.TestCase):
    def setUp(self):
        self.flow = fixtures.load('flow_release')
        self.lab = fixtures.ReleaseTests()
        self.lab.setUp()
        self.addCleanup(self.lab.tearDown)
        self.publisher = self.lab.adapter
        self.old = self.lab.pack()
        self.new = self.lab.pack('web-B')
        self.lab.deploy(self.old)
        self.policy = 'b' * 64
        self.now = 1700000000
        self.document = None
        self.open = True

    def open_window(self):
        if not self.open:
            raise ValueError('Maintenance is active')

    def ticket(self, operation='flow-front-deploy', *, rollback=False):
        target = self.old if rollback else self.new
        return {
            'schemaVersion': 1, 'operationId': operation, 'action': 'rollback' if rollback else 'deploy',
            'namespace': target['assetNamespace'], 'artifactId': target['artifactId'], 'sourceSHA': 'a' * 40,
            'manifestSha256': target['manifestSha256'], 'archiveSha256': None if rollback else target['archiveSha256'],
            'archiveBytes': 0 if rollback else self.archive().getbuffer().nbytes,
            'expectedCurrent': 'web-B' if rollback else 'web-A', 'expectedBackend': 'backend-A',
            'expectedSequence': 2 if rollback else 1, 'policySha256': self.policy,
            'issuedAt': self.now - 1, 'expiresAt': self.now + 60,
        }

    def archive(self):
        with open(self.new['archive'], 'rb') as source:
            return io.BytesIO(source.read())

    def approve(self, ticket):
        self.document = self.lab.m.canonical(ticket)
        return fixtures.sha(self.document)

    def send(self, operation='flow-front-deploy', *, digest=None, archive=None, mode='apply', scope=None):
        if digest is None:
            digest = fixtures.sha(self.document or b'')
        request = {'schemaVersion': 1, 'operationId': operation, 'mode': mode, 'approvalSha256': digest}
        if mode == 'apply':
            ticket = self.ticket(operation, rollback=operation.endswith('rollback'))
            request.update({key: ticket[key] for key in ('action', 'namespace', 'sourceSHA', 'expectedBackend', 'archiveSha256')})
            request.update(scope or {})
        return self.flow.execute(
            self.publisher, request,
            archive if archive is not None else io.BytesIO(), load_approval=lambda _: self.document,
            policy_digest=lambda: self.policy, require_open=self.open_window, clock=lambda: self.now,
        )

    def test_exact_approval_deploys_and_replay_only_reads_original_result(self):
        digest = self.approve(self.ticket())
        self.assertEqual(self.send(mode='query')['state'], 'absent')
        result = self.send(archive=self.archive())
        self.assertTrue(result['success'])
        self.assertEqual(self.publisher.current(), 'web-B')
        self.document = None
        self.open = False
        self.now += 3000
        replay = io.BytesIO(b'unread input')
        self.assertEqual(self.send(digest=digest, archive=replay), result)
        self.assertEqual(replay.tell(), 0)
        with self.assertRaises(ValueError):
            self.send(digest='0' * 64, mode='query')

    def test_rejects_missing_expired_or_changed_approval_before_consuming_archive(self):
        ticket = self.ticket()
        for fields in ({'expiresAt': self.now}, {'expectedSequence': 0}, {'expectedBackend': 'wrong'},
                       {'expectedCurrent': 'other'}, {'policySha256': 'f' * 64}):
            with self.subTest(fields=fields):
                self.approve(dict(ticket, **fields))
                body = self.archive()
                with self.assertRaises(ValueError):
                    self.send(archive=body)
                self.assertEqual(body.tell(), 0)
        self.document = None
        with self.assertRaises(ValueError):
            self.send(archive=self.archive())
        self.approve(ticket)
        self.open = False
        with self.assertRaisesRegex(ValueError, 'Maintenance'):
            self.send(archive=self.archive())
        self.assertFalse((self.publisher.base / 'releases/web-B').exists())
        self.assertEqual(self.publisher.current(), 'web-A')

    def test_wrong_action_or_target_is_rejected_before_reservation(self):
        self.approve(self.ticket())
        for scope in ({'action': 'rollback', 'archiveSha256': None}, {'namespace': 'other'}):
            with self.subTest(scope=scope):
                body = self.archive()
                with self.assertRaisesRegex(ValueError, 'request scope'):
                    self.send(archive=body, scope=scope)
                self.assertEqual(body.tell(), 0)
                self.assertEqual(self.send(mode='query')['state'], 'absent')

    def test_upload_interruption_leaves_a_queryable_reservation(self):
        self.approve(self.ticket())

        class BrokenArchive(io.BytesIO):
            def read(self, size=-1):
                raise ConnectionError('fixture connection closed')

        with self.assertRaises(ConnectionError):
            self.send(archive=BrokenArchive())
        record = self.send(mode='query')
        self.assertEqual(record['state'], 'preparing')
        again = self.archive()
        self.assertEqual(self.send(archive=again), record)
        self.assertEqual(again.tell(), 0)
        self.assertFalse((self.publisher.base / 'releases/web-B').exists())

    def test_tampered_archive_and_manifest_identity_cannot_seal(self):
        self.approve(self.ticket())
        wrong = self.archive().getvalue()
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.send(archive=io.BytesIO(b'X' + wrong[1:]))
        other = 'flow-front-other'
        self.approve(dict(self.ticket(other), sourceSHA='f' * 40, expectedSequence=2))
        with self.assertRaisesRegex(ValueError, 'manifest identity'):
            self.send(other, archive=self.archive(), scope={'sourceSHA': 'f' * 40})
        self.assertFalse((self.publisher.base / 'releases/web-B').exists())
        self.assertEqual(self.publisher.current(), 'web-A')

    def test_approval_is_rechecked_after_the_archive_arrives(self):
        self.approve(self.ticket())
        lab = self

        class LateArchive(io.BytesIO):
            def read(self, size=-1):
                lab.now += 60
                return super().read(size)

        with self.assertRaisesRegex(ValueError, 'validity window'):
            self.send(archive=LateArchive(self.archive().getvalue()))
        self.assertEqual(self.send(mode='query')['state'], 'preparing')
        self.assertFalse((self.publisher.base / 'releases/web-B').exists())

    def test_rollback_requires_a_separate_approval_and_exact_baseline(self):
        self.approve(self.ticket())
        self.send(archive=self.archive())
        operation = 'flow-front-rollback'
        with self.assertRaises(ValueError):
            self.send(operation)
        self.approve(self.ticket(operation, rollback=True))
        result = self.send(operation)
        self.assertEqual(result['state'], 'committed')
        self.assertEqual(self.publisher.current(), 'web-A')
        self.assertEqual(self.publisher.pointer('previous'), 'web-B')

    def test_connection_loss_reports_existing_journal_without_resuming(self):
        self.approve(self.ticket())

        def interrupt(phase):
            if phase == 'after_switch':
                raise KeyboardInterrupt()

        self.publisher.checkpoint = interrupt
        with self.assertRaises(KeyboardInterrupt):
            self.send(archive=self.archive())
        replay = self.send(archive=self.archive())
        self.assertEqual(replay['state'], 'checking')
        self.assertEqual(self.send(mode='query'), replay)
        self.assertEqual(json.loads((self.publisher.base / 'sequence.json').read_bytes()), {'sequence': 2})

    def test_pair_reservation_blocks_flow_before_maintenance_markers_exist(self):
        config = self.lab.root / 'etc'
        config.mkdir()
        (config / 'paired-release-policy.json').write_text('{"operationId":"paired-test"}')
        pair = self.publisher.root / 'paired-operations' / 'paired-test'
        events = pair / 'events'
        events.mkdir(parents=True)
        record = {'kind': 'zimage-paired-release-v1', 'operationId': 'paired-test', 'phase': 'baseline_pending'}
        state = {'sequence': 1, 'previousSha256': None, 'record': record}

        def write_state():
            body = json.dumps(state)
            (pair / 'state.json').write_text(body)
            (events / '0001.json').write_text(body)

        write_state()
        with patch.object(self.flow, 'ETC', config), patch.object(self.flow.release, 'ROOT', self.publisher.root), \
             patch.object(self.flow.release, 'owned'), patch.object(self.flow, 'root_bytes', side_effect=lambda path: path.read_bytes()):
            with self.assertRaisesRegex(ValueError, 'Paired release'):
                self.flow.require_no_active_pair()
            record['phase'] = 'opened'
            write_state()
            self.flow.require_no_active_pair()
            (events / '0002.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Paired release'):
                self.flow.require_no_active_pair()
