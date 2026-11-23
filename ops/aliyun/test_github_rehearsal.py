"""Offline metadata-only GitHub workflow regression tests."""
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
from textwrap import dedent
import unittest
from unittest.mock import call, patch

WORKFLOW = Path(__file__).resolve().parents[2] / '.github/workflows/rehearsal-candidates.yml'
HERE = Path(__file__).resolve().parent


class GithubRehearsal(unittest.TestCase):
    def test_main_push_signs_exact_pair_before_the_only_publication_job(self):
        text = WORKFLOW.read_text(encoding='utf-8')
        self.assertIn('  push:\n    branches: [main]', text)
        self.assertEqual(text.count("(github.event_name == 'push' || inputs.component =="), 2)
        self.assertIn('needs: [backend, frontend]', text)
        self.assertIn('MATCH_BACKEND_SHA="$GITHUB_SHA"', (HERE / 'github-rehearsal.sh').read_text())
        measurement, publish = text.split('\n  publish-pair:\n', 1)
        for value in ('secrets.', 'pull_request_target', 'candidate_run_id'):
            self.assertNotIn(value, measurement)
        self.assertIn('needs: [backend, frontend, hosted-shadow]', measurement)
        self.assertRegex(measurement, r'attest-stage\.yml@[a-f0-9]{40}')
        self.assertIn('needs: [backend, frontend, hosted-shadow, attest-stage]', publish)
        self.assertIn("vars.ZIMAGE_PAIRED_SSH_RELEASE == 'true'", publish)
        self.assertIn('group: zimage-production-release', publish)
        self.assertIn('steps.report.outputs.artifact-id', measurement)
        self.assertIn('steps.descriptor.outputs.artifact-id', measurement)
        self.assertIn('secrets.ZIMAGE_PAIR_SSH_KEY', publish)
        self.assertNotIn('secrets.DEPLOY_SSH_KEY', publish)
        self.assertLess(publish.index('Verify the exact public pair selected for rollback'),
                        publish.index('Publish through the fixed ECS command'))
        self.assertLess(publish.index('Publish through the fixed ECS command'),
                        publish.index('Verify the new pair through public HTTPS'))
        self.assertNotIn('ZIMAGE_PAIR_ROLLBACK_SHA', publish)
        self.assertIn('--capture-current', publish)
        self.assertIn('--observe-failed-public', publish)
        self.assertIn("failure() && steps.public_acceptance.outcome == 'failure'", publish)


    def test_main_only_production_environment_gate_is_before_artifacts_and_credentials(self):
        workflow = WORKFLOW.read_text(encoding='utf-8')
        _, publish = workflow.split('\n  publish-pair:\n', 1)
        step = publish.split('      - name: Recheck the main-only production environment\n', 1)[1]
        gate = dedent(step.split("          /usr/bin/python3 -I - <<'PY'\n", 1)[1]
                      .split('\n          PY\n', 1)[0])
        self.assertIn("github.event_name == 'push'", publish)
        self.assertIn("github.ref == 'refs/heads/main' && github.ref_protected", publish)
        self.assertIn('environment: production', publish)
        self.assertLess(publish.index('Recheck the main-only production environment'),
                        publish.index('Freeze the signed same-run publication handoff'))
        self.assertLess(publish.index('--source-digest "$GITHUB_SHA"'),
                        publish.index('secrets.ZIMAGE_PAIR_SSH_KEY'))
        endpoint = 'repos/zhYAO/Image-web/environments/production'

        environment = {
            'name': 'production', 'can_admins_bypass': False,
            'deployment_branch_policy': {'custom_branch_policies': True, 'protected_branches': False},
            'protection_rules': [{'type': 'branch_policy', 'id': 17}],
        }
        main = {'name': 'main', 'type': 'branch', 'id': 42}
        allow = {'total_count': 1, 'branch_policies': [main]}

        def run(fixtures):
            with patch.object(subprocess, 'check_output', side_effect=fixtures) as gh:
                exec(compile(gate, '<production environment gate>', 'exec'), {})
            self.assertEqual(gh.call_args_list, [
                call(['gh', 'api', '--method', 'GET', endpoint], timeout=15),
                call(['gh', 'api', '--method', 'GET', endpoint + '/deployment-branch-policies?per_page=100'],
                     timeout=15),
            ])

        run([json.dumps(environment), json.dumps(allow)])
        refused = [
            ('admin bypass allowed', {**environment, 'can_admins_bypass': True}, allow),
            ('admin bypass absent', {k: v for k, v in environment.items() if k != 'can_admins_bypass'}, allow),
            ('reviewers still required', {**environment, 'protection_rules':
                                          environment['protection_rules'] + [{'type': 'required_reviewers'}]}, allow),
            ('protected branches instead of exact main', {**environment, 'deployment_branch_policy':
                                                          {'custom_branch_policies': False, 'protected_branches': True}}, allow),
            ('tag named main', environment, {**allow, 'branch_policies': [{**main, 'type': 'tag'}]}),
            ('wildcard', environment, {**allow, 'branch_policies': [{**main, 'name': 'ma*'}]}),
            ('extra tag', environment, {'total_count': 2, 'branch_policies': [main, {**main, 'type': 'tag'}]}),
            ('hidden rule on another page', environment, {**allow, 'total_count': 2}),
            ('missing rule', environment, {'total_count': 0, 'branch_policies': []}),
            ('API failure', environment, subprocess.CalledProcessError(1, 'gh')),
            ('invalid API JSON', environment, '<html>503</html>'),
        ]
        for label, first, second in refused:
            with self.subTest(label=label), self.assertRaisesRegex(SystemExit, 'Refusing paired publication'):
                run([json.dumps(first), second if isinstance(second, (str, Exception)) else json.dumps(second)])

    def test_publish_and_legacy_jobs_share_a_non_canceling_queue(self):
        # Concurrency is repository-wide and group names are case-insensitive.
        expected = {
            ('rehearsal-candidates.yml', 'publish-pair'): 'zimage-production-release',
            ('ci.yml', 'deploy'): 'zimage-production-release',
            ('ci.yml', 'rollback'): 'zimage-production-release',
        }
        found = {}
        for path in sorted(WORKFLOW.parent.iterdir()):
            if path.suffix not in ('.yml', '.yaml'):
                continue
            lines = path.read_text(encoding='utf-8').splitlines()
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
                self.assertEqual(fields, policy)
                found[(path.name, job)] = group
        self.assertEqual(found, expected)

    def test_legacy_deploy_and_rollback_are_ineligible_in_pair_mode(self):
        text = (WORKFLOW.parent / 'ci.yml').read_text(encoding='utf-8')
        for job in ('deploy', 'rollback'):
            block = text.split(f'\n  {job}:\n', 1)[1]
            self.assertIn("vars.ZIMAGE_PAIRED_SSH_RELEASE != 'true'", block.splitlines()[1])

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
