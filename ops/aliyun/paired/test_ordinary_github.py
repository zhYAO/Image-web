import base64
from copy import deepcopy
import hashlib
import json
import unittest
from unittest.mock import Mock

import ordinary_github as gh


class ObserveTests(unittest.TestCase):
    def setUp(self):
        self.commit, self.head = 'a' * 40, 'b' * 40
        self.workflow_file = b'name: fixture reviewed workflow\n'
        self.policy = dict(repository='zhYAO/Image-web', repository_id=gh.REPO_ID, required_check=gh.CHECK_NAME,
                           check_app_id=gh.CHECK_APP_ID, allowed_human_merger_ids=[20], check_workflow_id=40,
                           required_workflow_sha256=hashlib.sha256(self.workflow_file).hexdigest())
        self.packet = dict(repository=self.policy['repository'], workflow=gh.WORKFLOW, commit=self.commit)
        self.pr = dict(number=22, merged=True, merge_commit_sha=self.commit, merged_at='2026-11-23T04:00:01Z',
                       base=dict(ref='main', repo={'id': gh.REPO_ID}), head={'sha': self.head},
                       merged_by={'type': 'User', 'id': 20})
        self.check = dict(id=35, head_sha=self.head, name=gh.CHECK_NAME, app={'id': gh.CHECK_APP_ID},
                          check_suite={'id': 36}, status='completed', conclusion='success',
                          completed_at='2026-11-23T03:55:00Z')
        rule_source = dict(type='ruleset', id=gh.RULESET_ID)
        self.execution = dict(id=41, repository_id=gh.REPO_ID, actor_id=20, ref=gh.MAIN_REF,
                              before_sha='d' * 40, after_sha=self.commit, result='pass', evaluation_result='pass',
                              pushed_at='2026-11-23T04:00:01Z',
                              rule_evaluations=[dict(rule_type=rule, enforcement='active', result='pass', rule_source=rule_source)
                                                for rule in ('pull_request', 'required_status_checks')])
        self.rules = dict(id=gh.RULESET_ID, enforcement='active', bypass_actors=[], updated_at='2026-11-23T03:47:09+00:00')
        self.sources = {
            f'/commits/{self.commit}/pulls?per_page=100': [{'number': 22}],
            '/pulls/22': self.pr,
            f'/commits/{self.head}{gh.CHECK_QUERY}': {'total_count': 1, 'check_runs': [self.check]},
            '/actions/workflows/40/runs?event=pull_request&check_suite_id=36&per_page=100':
                {'total_count': 1, 'workflow_runs': [dict(id=38, head_sha=self.head, check_suite_id=36)]},
            f'/contents/{gh.CHECK_WORKFLOW}?ref={self.commit}': dict(type='file', path=gh.CHECK_WORKFLOW, encoding='base64',
                size=len(self.workflow_file), content=base64.b64encode(self.workflow_file).decode()),
            f'/rulesets/{gh.RULESET_ID}': self.rules,
            gh.SUITES: [dict(id=41, ref=gh.MAIN_REF, after_sha=self.commit)],
            '/rulesets/rule-suites/41': self.execution,
        }
        self.verify = Mock(return_value={'protectedMergeVerified': True, 'productionReady': False})

    def read(self, path):
        self.assertTrue(gh.safe_path(path), path)
        return deepcopy(self.sources[path[len(gh.BASE):]])

    def observe(self):
        return gh.observe(self.packet, get=self.read, policy=self.policy, verify_check=self.verify)

    def test_discovers_exact_pr_check_run_and_ruleset_execution(self):
        evidence = self.observe()
        self.assertEqual(evidence, dict(commit=self.commit, pullRequest=22, checkRunId=35, workflowRunId=38,
                                        ruleSuiteId=41, workflowSha256=self.policy['required_workflow_sha256']))
        self.verify.assert_called_once_with(self.read, policy=self.policy, candidate_sha=self.commit,
                                             pr_number=22, check_id=35, pr_run_id=38)

    def test_current_rules_alone_do_not_prove_protected_merge(self):
        self.sources[gh.SUITES] = []
        with self.assertRaises(ValueError):
            self.observe()
        self.verify.assert_not_called()

    def test_bypass_or_changed_policy_or_wrong_actor_are_rejected(self):
        for obj, key, changed in ((self.execution, 'result', 'bypass'), (self.execution, 'actor_id', 2),
                                   (self.rules, 'updated_at', '2026-11-23T04:01:00Z'),
                                   (self.execution['rule_evaluations'][1], 'enforcement', 'evaluate'),
                                   (self.check['app'], 'id', 1), (self.check, 'conclusion', 'skipped'),
                                   (self.check, 'completed_at', '2026-11-23T04:01:00Z'),
                                   (self.pr, 'merged', False), (self.policy, 'required_workflow_sha256', 'c' * 64)):
            before = obj[key]
            with self.subTest(key=key, value=changed):
                obj[key] = changed
                try:
                    with self.assertRaises(ValueError):
                        self.observe()
                finally:
                    obj[key] = before
        self.verify.assert_not_called()


class ReaderTests(unittest.TestCase):
    def test_tls_reader_does_not_follow_redirects_or_paginated_or_unknown_routes(self):
        connect = Mock()
        client = connect.return_value
        response = client.getresponse.return_value
        headers = {}
        response.getheader.side_effect = lambda name, fallback: headers.get(name, fallback)
        response.read.return_value = json.dumps({'name': 'main'}).encode()
        response.status = 200
        token = 'nonproduction-fixture-token'
        read = gh.read_only(token, connect=connect)
        for path in ('https://other.invalid' + gh.BASE + '/branches/main', gh.BASE + '/actions/secrets',
                     gh.BASE + '/branches/main?ref=other', gh.BASE + '/rulesets/1'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                read(path)
        connect.assert_not_called()
        path = gh.BASE + '/branches/main'
        self.assertEqual(read(path), {'name': 'main'})
        self.assertEqual(connect.call_args.args, ('api.github.com',))
        self.assertEqual(client.request.call_args.args, ('GET', path))
        response.status = 302
        with self.assertRaises(ValueError):
            read(path)
        response.status = 200
        headers['Link'] = '<https://api.github.com/next>; rel="next"'
        with self.assertRaises(ValueError):
            read(path)
