"""Offline policy checks for the hosted-only, nonpromotable smoke job."""
from pathlib import Path
import re
import unittest

HERE = Path(__file__).resolve().parent
WORKFLOW = HERE.parents[1] / '.github/workflows/rehearsal-candidates.yml'


class HostedRehearsal(unittest.TestCase):
    def test_secretless_hosted_job_cannot_authorize_production(self):
        text = WORKFLOW.read_text()
        jobs = dict(re.findall(r'^  ([\w-]+):\n(.*?)(?=^  [\w-]+:\n|\Z)', text, re.M | re.S))
        smoke = jobs['isolated-runtime-rehearsal']
        for condition in ("github.event_name == 'push'", "github.ref == 'refs/heads/main'", 'github.ref_protected',
                          "vars.ZIMAGE_PAIRED_AUTOMATION != 'true'", "vars.ZIMAGE_PAIRED_PRODUCTION != 'true'"):
            self.assertIn(condition, smoke)
        self.assertIn('runs-on: ubuntu-22.04', smoke)
        self.assertIn('needs: [backend, frontend, same-run-review]', smoke)
        for forbidden in ('environment:', 'outputs:', 'secrets.', 'upload-artifact', 'self-hosted'):
            self.assertNotIn(forbidden, smoke)
        self.assertNotIn('isolated-runtime-rehearsal', jobs['publish-pair'])
        before, runtime = smoke.split('name: Test exact release in a disposable local fixture', 1)
        self.assertIn('GH_TOKEN:', before)
        self.assertNotIn('GH_TOKEN', runtime)
        self.assertIn('env -i', runtime)
        self.assertIn('github-hosted-smoke.sh', runtime)

    def test_hosted_shell_guard_is_distinct_from_privileged_modes(self):
        review = (HERE / 'github-rehearsal-review.sh').read_text()
        branch = review.split('if [[ "$phase" == hosted-smoke ]]; then', 1)[1].split('elif', 1)[0]
        for condition in ('== github-hosted', '== Linux', '"${ZIMAGE_PAIRED_BUILD_MODE:-}" != true',
                          '"${ZIMAGE_PAIRED_PRODUCTION:-}" != true'):
            self.assertIn(condition, branch)
        launcher = (HERE / 'github-hosted-smoke.sh').read_text()
        self.assertIn('shadow = intake.hosted_namespace(pins, mode)', launcher)
        self.assertIn('Exact shadow bytes have not passed nonpromotable intake', launcher)
        self.assertNotIn('github-paired-controller', launcher)
        self.assertNotIn('GITHUB_OUTPUT', launcher)


if __name__ == '__main__':
    unittest.main()
