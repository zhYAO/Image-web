from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import tempfile
import unittest

import core
from ordinary_journal import JournalGate, PHASES
from test_ordinary import Fixture


class TestOrdinaryJournal(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'deploy.lock').touch(mode=0o600)
        (self.root / 'ordinary-operations').mkdir(0o700)

    def gate(self):
        return JournalGate(self.root, core, owner_uid=os.getuid())

    def append(self, gate, phase, *, operation='release-first', approval='a' * 64):
        gate.journal(dict(operation=operation, rootApprovalSha256=approval, phase=phase))

    def test_shared_inode_and_complete_operation_forbids_same_id_but_not_new(self):
        g = self.gate()
        with g.lock(), (self.root / 'deploy.lock').open('rb') as legacy:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(legacy.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            g.assert_clear('release-first')
            for phase in PHASES:
                self.append(g, phase)
        g = self.gate()
        with g.lock():
            with self.assertRaisesRegex(ValueError, 'already used'):
                g.assert_clear('release-first')
            g.assert_clear('release-second')

    def test_each_unfinished_phase_blocks_new_process_and_sticky_open_uncertainty(self):
        for index, phase in enumerate(PHASES[:-1]):
            with self.subTest(phase=phase):
                # Each interruption gets its own complete isolated root.
                if index: self.setUp()
                g = self.gate()
                with g.lock():
                    g.assert_clear('release-first')
                    for subphase in PHASES[:index + 1]:
                        self.append(g, subphase)
                reopened = self.gate()
                with reopened.lock(), self.assertRaisesRegex(ValueError, 'reconcile'):
                    reopened.assert_clear('release-second')

    def test_preflight_no_journal_and_wrong_phase_or_changed_approval_rejected(self):
        g = self.gate()
        with self.assertRaisesRegex(ValueError, 'must be held'):
            g.assert_clear('release-first')
        with g.lock():
            g.assert_clear('release-first')
            self.assertEqual(list((self.root / 'ordinary-operations').iterdir()), [])
            with self.assertRaisesRegex(ValueError, 'phase'):
                self.append(g, 'opened')
            self.append(g, 'seal-intent')
            with self.assertRaisesRegex(ValueError, 'approval'):
                self.append(g, 'backend-intent', approval='b' * 64)

    def test_missing_or_foreign_lock_and_torn_or_forged_journal_fail_closed(self):
        lock = self.root / 'deploy.lock'
        lock.unlink()
        lock.symlink_to(self.root / 'ordinary-operations')
        with self.assertRaisesRegex(ValueError, 'Untrusted'):
            with self.gate().lock(): self.fail('foreign lock')
        lock.unlink()
        lock.touch(mode=0o600)
        g = self.gate()
        with g.lock():
            g.assert_clear('release-first')
            self.append(g, 'seal-intent')
        (self.root / 'ordinary-operations/release-first/state.json').unlink()
        reopened = self.gate()
        with reopened.lock(), self.assertRaisesRegex(ValueError, 'Interrupted journal'):
            reopened.assert_no_unresolved()

    def test_real_coordinator_and_filesystem_journal_on_open_uncertainty(self):
        gate = self.gate()

        class Operations(Fixture):
            @contextmanager
            def lock(self):
                with gate.lock(), super().lock():
                    yield

            def assert_clear(self, operation):
                self.call('assert-clear')
                gate.assert_clear(operation)

            def journal(self, event):
                self.call(event['phase'])
                gate.journal(event)

        adapter = Operations()
        adapter.fail = 'open'
        with self.assertRaisesRegex(ValueError, 'injected failure'):
            adapter.run()
        operation = self.root / 'ordinary-operations' / adapter.a['operation']
        retained = core.Journal(operation, owner_uid=os.getuid()).load()
        self.assertEqual(retained['phase'], 'writes-may-open')
        self.assertTrue(adapter.state['sealed'])
        second_writer = self.gate()
        with second_writer.lock(), self.assertRaisesRegex(ValueError, 'reconcile'):
            second_writer.assert_no_unresolved()

    def test_at_retention_ceiling_no_new_claim_or_write(self):
        from unittest.mock import patch
        g = self.gate()
        with patch('ordinary_journal.MAX_RETAINED_OPERATIONS', 2):
            for op in ('release-first', 'release-second'):
                with g.lock():
                    g.assert_clear(op)
                    for phase in PHASES:
                        self.append(g, phase, operation=op)
            with g.lock():
                self.assertEqual(g.assert_no_unresolved(), 2)
                with self.assertRaisesRegex(ValueError, 'capacity reached'):
                    g.assert_clear('release-third')
                with self.assertRaises(ValueError):
                    self.append(g, 'seal-intent', operation='release-third')
            self.assertEqual({p.name for p in g.operations.iterdir()}, {'release-first', 'release-second'})
