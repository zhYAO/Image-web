import unittest
from unittest.mock import Mock, patch

import github_shadow_sign as sign


class SignerJobTest(unittest.TestCase):
    def setUp(self):
        self.env = dict(GITHUB_REPOSITORY=sign.REPO, GITHUB_REPOSITORY_ID=str(sign.REPO_ID),
                        GITHUB_EVENT_NAME='push', GITHUB_REF='refs/heads/main',
                        GITHUB_REF_PROTECTED='true', RUNNER_ENVIRONMENT='github-hosted',
                        GITHUB_WORKFLOW_REF=sign.REPO + '/' + sign.WORKFLOW + '@refs/heads/main',
                        GITHUB_WORKFLOW_SHA='a' * 40, GITHUB_SHA='a' * 40,
                        GITHUB_RUN_ID='11', GITHUB_RUN_ATTEMPT='2', SIGNER_SHA='b' * 40,
                        BACKEND_ID='101', FRONTEND_ID='102', REPORT_ID='103',
                        GH_TOKEN='test-token', OBJECT_HOSTS='results-receiver.actions.githubusercontent.com')
        self.transport = Mock()
        self.transport.return_value.get.return_value = dict(id=88, path=sign.WORKFLOW, state='active')

    def test_uses_independent_workflow_identity_and_exact_attempt(self):
        with patch.object(sign, 'statement', return_value=b'statement') as statement:
            self.assertEqual(sign.prepare(self.env, self.transport), b'statement')
        self.transport.return_value.get.assert_called_once_with(
            '/repos/zhYAO/Image-web/actions/workflows/rehearsal-candidates.yml')
        args = statement.call_args.kwargs
        self.assertEqual(args['ids'], dict(backend=101, frontend=102, report=103))
        self.assertEqual(args['stage_job_name'], 'hosted-shadow')
        self.assertEqual(args['workflow_id'], 88)
        self.assertEqual(args['expected']['attempt'], 2)
        self.assertEqual(args['expected']['signerSHA'], 'b' * 40)

    def test_rejects_other_caller_before_opening_network(self):
        for key, value in (('GITHUB_EVENT_NAME', 'workflow_dispatch'),
                           ('GITHUB_REF_PROTECTED', 'false'), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                           ('GITHUB_WORKFLOW_REF', sign.REPO + '/.github/workflows/ci.yml@refs/heads/main'),
                           ('GITHUB_WORKFLOW_SHA', 'c' * 40), ('REPORT_ID', '01')):
            with self.subTest(key=key), self.assertRaises(ValueError):
                sign.prepare(dict(self.env, **{key: value}), self.transport)
        self.transport.assert_not_called()

    def test_rejects_disabled_workflow(self):
        self.transport.return_value.get.return_value['state'] = 'disabled_manually'
        with patch.object(sign, 'statement') as statement, self.assertRaises(ValueError):
            sign.prepare(self.env, self.transport)
        statement.assert_not_called()
