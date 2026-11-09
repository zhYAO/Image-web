import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest


def load():
    spec = importlib.util.spec_from_file_location('frontend_operation', Path(__file__).with_name('frontend_operation.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrontendOperationTests(unittest.TestCase):
    def setUp(self):
        self.client = load()
        self.source = 'a' * 40
        self.operation = 'flow-front-10-20-deploy'

    def test_gate_rejects_wrong_branch_or_wrong_status_author(self):
        ref = {'object': {'sha': self.source}}
        status = {'context': 'yunxiao/quality', 'state': 'success', 'creator': {'id': 42},
                  'description': 'Flow run 10', 'target_url': self.client.QUALITY_RUN_URL + '10'}
        for branch, entries in ((ref, [status]), ({'object': {'sha': 'f' * 40}}, [status]),
                                (ref, [dict(status, creator={'id': 99}), status]), (ref, [dict(status, state='pending')])):
            with self.subTest(branch=branch, entries=entries):
                replies = iter([branch, entries])
                if branch == ref and entries == [status]:
                    self.client.require_main(self.source, '42', lambda _: next(replies))
                else:
                    with self.assertRaises(self.client.OperationError):
                        self.client.require_main(self.source, '42', lambda _: next(replies))

    def test_disconnect_only_queries_and_never_submits_again(self):
        absent = {'schemaVersion': 1, 'operationId': self.operation, 'state': 'absent'}
        replies = iter([(0, absent), (255, None), (0, absent)])
        calls = []

        def call(mode):
            calls.append(mode)
            return next(replies)

        with self.assertRaisesRegex(self.client.OperationError, 'status'):
            self.client.apply_once(self.operation, call)
        self.assertEqual(calls, ['query', 'apply', 'query'])

    def test_replay_returns_existing_journal_without_apply(self):
        committed = {'schemaVersion': 1, 'operationId': self.operation, 'state': 'committed'}
        calls = []

        def call(mode):
            calls.append(mode)
            return 0, committed

        self.assertEqual(self.client.apply_once(self.operation, call), committed)
        self.assertEqual(calls, ['query'])

    def test_only_apply_includes_exact_selected_release_scope(self):
        args = SimpleNamespace(operation=self.operation, approval_sha256='b' * 64, action='rollback',
                               target='reviewed-old', backend='c' * 40, source=self.source, archive_sha256=None)
        query = self.client.request_header(args, 'query')
        self.assertNotIn('action', query)
        apply = self.client.request_header(args, 'apply')
        self.assertEqual(apply, dict(query, mode='apply', action='rollback', namespace='reviewed-old',
                                     expectedBackend='c' * 40, sourceSHA=self.source, archiveSha256=None))

    def test_connected_rejection_keeps_original_error_and_does_not_resubmit(self):
        absent = {'schemaVersion': 1, 'operationId': self.operation, 'state': 'absent'}
        replies = iter([(0, absent), (1, None), (0, absent)])
        calls = []

        def call(mode):
            calls.append(mode)
            return next(replies)

        with self.assertRaisesRegex(self.client.OperationError, 'status'):
            self.client.apply_once(self.operation, call)
        self.assertEqual(calls, ['query', 'apply', 'query'])
