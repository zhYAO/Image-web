"""Offline metadata-only GitHub workflow regression tests."""
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / '.github/workflows/rehearsal-candidates.yml'
HERE = Path(__file__).resolve().parent


class GithubRehearsal(unittest.TestCase):
    def test_main_push_has_two_jobs_and_same_run_review_without_production(self):
        text = WORKFLOW.read_text()
        self.assertIn('  push:\n    branches: [main]', text)
        self.assertEqual(text.count("(github.event_name == 'push' || inputs.component =="), 2)
        self.assertIn('needs: [backend, frontend]', text)
        self.assertIn('MATCH_BACKEND_SHA="$GITHUB_SHA"', (HERE / 'github-rehearsal.sh').read_text())
        for value in ('secrets.', 'pull_request_target', 'candidate_run_id'):
            self.assertNotIn(value, text)
        self.assertIn('needs: [backend, frontend, same-run-review, authenticated-staging]', text)
        self.assertIn("vars.ZIMAGE_PAIRED_PRODUCTION == 'true'", text)
        self.assertIn('group: zimage-production-release', text)

    def test_only_staging_expands_its_queue_without_canceling_running_jobs(self):
        # Concurrency is repository-wide and group names are case-insensitive.
        expected = {
            ('rehearsal-candidates.yml', 'authenticated-staging'): 'zimage-release-staging',
            ('rehearsal-candidates.yml', 'approved-production'): 'zimage-production-release',
            ('ci.yml', 'deploy'): 'zimage-production-release',
            ('ci.yml', 'rollback'): 'zimage-production-release',
        }
        found = {}
        for path in sorted(WORKFLOW.parent.iterdir()):
            if path.suffix not in ('.yml', '.yaml'):
                continue
            lines = path.read_text().splitlines()
            job = None
            for index, line in enumerate(lines):
                if re.fullmatch(r'  [a-zA-Z0-9_-]+:', line):
                    job = line.strip()[:-1]
                if not re.fullmatch(r'\s*concurrency:\s*', line):
                    continue
                indent = len(line) - len(line.lstrip())
                fields = {}
                for option in lines[index + 1:]:
                    if not option.strip() or option.lstrip().startswith('#'):
                        continue
                    if len(option) - len(option.lstrip()) <= indent:
                        break
                    key, _, value = option.strip().partition(':')
                    fields[key] = value.strip().strip("'\"")
                group = fields.get('group', '').lower()
                if group not in expected.values():
                    continue
                self.assertEqual(indent, 4, 'release concurrency must be job-level')
                policy = {'group': group, 'cancel-in-progress': 'false'}
                if group == 'zimage-release-staging':
                    policy['queue'] = 'max'
                self.assertEqual(fields, policy)
                found[(path.name, job)] = group
        self.assertEqual(found, expected)

    def test_out_of_order_builds_do_not_displace_newest_main_in_staging(self):
        # Offline model of staging under GitHub's documented pending policy, not a hosted
        # scheduler test. The real review controller below decides eligibility.
        def pending_after_ready(arrivals, queue):
            pending = []
            for ready in arrivals:
                if queue == 'single':
                    pending.clear()
                pending.append(ready)
            return pending

        self.assertEqual(pending_after_ready(('C', 'B'), 'single'), ['B'])
        for arrivals in (('C', 'B'), ('B', 'C')):
            with self.subTest(arrivals=arrivals):
                # A is already running. Both pending entries must survive.
                self.assertCountEqual(pending_after_ready(arrivals, 'max'), ('B', 'C'))
                eligible = []
                for run in arrivals:
                    result, summary = self.review(stale=(run == 'B'))
                    if run == 'B':
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('Stale main run', result.stderr)
                        self.assertIsNone(summary)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn('no production approval', summary)
                        eligible.append(run)
                self.assertEqual(eligible, ['C'])

    def review(self, *, branch='refs/heads/main', event='push', stale=False, wrong_attempt=False, wrong_digest=False,
               wrong_run=False, wrong_sha=False):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sha, digest = 'a' * 40, 'b' * 64
            run, attempt = '42', '2'
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}', GITHUB_REPOSITORY='zhYAO/Image-web',
                       GITHUB_REF=branch, GITHUB_REF_PROTECTED='true', GITHUB_EVENT_NAME=event, GITHUB_SHA=sha,
                       GITHUB_RUN_ID=run, GITHUB_RUN_ATTEMPT=attempt, GITHUB_STEP_SUMMARY=str(root / 'summary'),
                       BACKEND_ID='1', FRONTEND_ID='2')
            for component in ('BACKEND', 'FRONTEND'):
                for suffix in ('ARTIFACT_DIGEST', 'ARCHIVE_SHA', 'RECEIPT_SHA'):
                    env[f'{component}_{suffix}'] = digest
            for i, component in enumerate(('backend', 'frontend'), start=1):
                value = dict(id=i, name=f'rehearsal-{component}-{sha}-{run}-{1 if wrong_attempt else attempt}',
                             digest='sha256:' + ('c' * 64 if wrong_digest else digest), expired=False,
                             workflow_run=dict(id=(43 if wrong_run else 42), head_branch='main',
                                               head_sha=('f' * 40 if wrong_sha else sha)))
                (root / f'{i}.json').write_text(json.dumps(value))
            expected_head = 'd' * 40 if stale else sha
            gh = root / 'gh'
            gh.write_text(f'''#!/bin/bash
case "$2" in
  */commits/main) echo {expected_head} ;;
  */artifacts/1) cat "{root}/1.json" ;;
  */artifacts/2) cat "{root}/2.json" ;;
  *) exit 4 ;;
esac
''')
            gh.chmod(0o755)
            output = subprocess.run(['bash', str(HERE / 'github-rehearsal-review.sh'), '--metadata-only'], env=env,
                                    capture_output=True, text=True, check=False)
            return output, (root / 'summary').read_text() if (root / 'summary').is_file() else None

    def test_exact_pair_can_be_summarized_but_not_approved(self):
        result, summary = self.review()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('no production approval', summary)
        self.assertIn('run 42 attempt 2', summary)

    def test_wrong_main_run_attempt_digest_or_git_origin_stays_ineligible(self):
        for args in (dict(stale=True), dict(wrong_attempt=True), dict(wrong_digest=True), dict(wrong_run=True),
                     dict(wrong_sha=True), dict(branch='refs/heads/topic'), dict(event='pull_request')):
            with self.subTest(args=args):
                result, summary = self.review(**args)
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(summary)
