"""Offline security/integration assertions for the fixed review branch."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
WORKFLOW = HERE.parents[1] / '.github/workflows/review-branch-diagnostic.yml'
SCRIPT = HERE / 'github-review-branch-diagnostic.sh'
BRANCH = 'refs/heads/codex/zimage-github-actions-review-20261120'
REPO = 'zhYAO/Image-web'
WORKFLOW_REF = f'{REPO}/.github/workflows/review-branch-diagnostic.yml@{BRANCH}'


class BranchDiagnostic(unittest.TestCase):
    def test_workflow_has_only_fixed_push_and_no_release_context(self):
        body = WORKFLOW.read_text()
        self.assertIn('branches: [codex/zimage-github-actions-review-20261120]', body)
        self.assertIn('runs-on: ubuntu-22.04', body)
        self.assertIn('persist-credentials: false', body)
        self.assertIn('env -i', body)
        for forbidden in ('workflow_dispatch', 'pull_request', 'environment:', 'upload-artifact',
                          'outputs:', 'secrets.', 'vars.', 'self-hosted', 'GH_TOKEN', 'ZIMAGE_PAIRED_'):
            self.assertNotIn(forbidden, body)
        self.assertNotIn('github-rehearsal-review.sh', body)
        self.assertNotIn('github-paired-controller', SCRIPT.read_text())

    def test_release_fixture_has_no_production_authority(self):
        script = SCRIPT.read_text()
        self.assertIn('release-transport.py unpack', script)
        self.assertIn('three-layer-release.py assemble', script)
        self.assertIn('m["productionReady"] is False', script)
        self.assertIn('isolated-release-rehearsal.mjs', script)
        self.assertIn('git merge-base --is-ancestor "$baseline" "$GITHUB_SHA"', script)
        self.assertLess(script.index('ZIMAGE_REHEARSAL_MODE admission-only'),
                        script.index('git merge-base --is-ancestor "$baseline" "$GITHUB_SHA"'))
        self.assertIn('git fetch --no-tags --deepen=32 origin "$GITHUB_SHA"', script)
        self.assertIn('git worktree add --detach "$base_checkout" "$baseline"', script)
        self.assertIn('test "$candidate_digest" != "$baseline_digest"', script)
        self.assertIn('unshare --net --mount --pid --fork --mount-proc --kill-child', script)
        self.assertIn('review-schema3-admission.py', script)
        gate = (HERE / 'review-schema3-admission.py').read_text()
        for required in ('socket.SO_PEERCRED', 'private_status', 'smoke.child_setup', '/usr/sbin/nginx',
                         'network_isolated', 'ingress-maintenance-maps.conf'):
            self.assertIn(required, gate)
        self.assertIn("NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:1'", gate)
        self.assertIn("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_rehearsal_only'", gate)
        for forbidden in ('github-paired-controller', 'www.zimage.store', 'GH_TOKEN', 'systemctl', 'SUPABASE_SECRET_KEY'):
            self.assertNotIn(forbidden, gate)
        runtime = (HERE / 'isolated-release-rehearsal.mjs').read_text()
        self.assertIn("server.listen(0, '127.0.0.1')", runtime)
        self.assertIn("productionReady: false", runtime)
        for forbid in ('github-paired-controller', '/opt/zimage', 'https://www.zimage.store', 'GH_TOKEN', 'id-token'):
            self.assertNotIn(forbid, runtime)

    def test_wrong_provenance_rejected_before_git_or_build(self):
        for field, value in (('GITHUB_REPOSITORY', 'fork/not-zimage'), ('GITHUB_EVENT_NAME', 'pull_request'),
                             ('GITHUB_REF', 'refs/heads/main'), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                             ('GITHUB_WORKFLOW_REF', f'{REPO}/.github/workflows/ci.yml@{BRANCH}')):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                env = dict(os.environ, GITHUB_REPOSITORY=REPO, GITHUB_EVENT_NAME='push',
                           GITHUB_REF=BRANCH, GITHUB_SHA='a' * 40, GITHUB_RUN_ID='1', GITHUB_RUN_ATTEMPT='1',
                           GITHUB_WORKFLOW_REF=WORKFLOW_REF, RUNNER_ENVIRONMENT='github-hosted', RUNNER_OS='Linux')
                env[field] = value
                out = subprocess.run(['bash', str(SCRIPT)], cwd=temp, env=env, capture_output=True, text=True)
                self.assertNotEqual(out.returncode, 0)
                self.assertEqual(out.stderr, '')


if __name__ == '__main__':
    unittest.main()
