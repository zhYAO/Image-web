from copy import deepcopy
import unittest

from github_hosted_producer_jobs import WORKFLOW, verify

SHA = '8' * 40
RUN, ATTEMPT, REPO, WORKFLOW_ID = 17, 2, 1329578390, 25


class Tests(unittest.TestCase):
    def setUp(self):
        repo = dict(id=REPO, full_name='zhYAO/Image-web')
        self.workflow = dict(path=WORKFLOW, id=WORKFLOW_ID, state='active')
        self.run = dict(path=WORKFLOW, workflow_id=WORKFLOW_ID, id=RUN, run_attempt=ATTEMPT,
                        head_sha=SHA, head_branch='main', status='in_progress', event='push',
                        repository=repo, head_repository=dict(repo))
        self.jobs = dict(total_count=2, jobs=[
            dict(name=name, id=index, run_id=RUN, run_attempt=ATTEMPT, head_sha=SHA,
                 status='completed', conclusion='success')
            for index, name in enumerate(('backend', 'frontend'), 1)])

    def check(self, workflow=None, run=None, jobs=None):
        return verify(workflow or self.workflow, run or self.run, jobs or self.jobs, SHA, RUN, ATTEMPT, REPO)

    def test_accepts_completed_producers_in_exact_current_attempt(self):
        self.assertIsNone(self.check())

    def test_rejects_foreign_run_or_workflow(self):
        for fields in (dict(workflow_id=1), dict(run_attempt=1), dict(head_branch='diag'),
                       dict(event='workflow_run'), dict(head_repository=dict(self.run['repository'], id=3))):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.check(run=dict(self.run, **fields))

    def test_rejects_partial_rerun_duplicate_missing_or_failed_jobs(self):
        for fields in (dict(name='backend'), dict(id=1), dict(run_attempt=1), dict(conclusion='failure')):
            bad = deepcopy(self.jobs)
            bad['jobs'][1].update(fields)
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.check(jobs=bad)
        with self.assertRaises(ValueError):
            self.check(jobs=dict(self.jobs, total_count=3))
