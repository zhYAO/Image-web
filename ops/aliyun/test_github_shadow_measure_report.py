import json
import subprocess
import unittest

from github_shadow_measure_report import BASELINE, LEDGER, NETWORK, SCOPE, report
from github_shadow_stage_build import build


class HandoffTest(unittest.TestCase):
    def setUp(self):
        self.argv = ['/reviewed/supervisor', '--prepared-protected-shadow', '/private/pair',
                     'a'*40, '119d835f091fe31d0383062f37bebd070c5297ad']
        self.context = dict(repository='zhYAO/Image-web', repositoryId=1329578390, sourceRef='refs/heads/main',
                            sourceSHA='a'*40, event='push', workflow='.github/workflows/rehearsal-candidates.yml',
                            runId=1, attempt=2, baselineSHA=BASELINE, migrationLedgerSha256=LEDGER,
                            backendSha256='b'*64, frontendSha256='c'*64)
        self.evidence = dict(commit='a'*40, dbProfile='m6-diagnostics-no-m7', migrationCount=43,
                             migrationLedgerSha256=LEDGER, scope=SCOPE, browserUiTested=True,
                             productionReady=False, credentialMode='synthetic', reconstructedIsolatedPairRecovery=True,
                             reconstructedCommit=BASELINE, checks=['candidate-health', 'browser-home-login-workspace-logout'])

    def check(self, changes=None, network=NETWORK, status=0, teardown='Protected host teardown verified.'):
        evidence = json.dumps(dict(self.evidence, **(changes or {})))
        return report(subprocess.CompletedProcess(self.argv, status, (network+'\n'+teardown+'\n'+evidence+'\n').encode()),
                      argv=self.argv, context=self.context)

    def test_existing_signer_builder_accepts_only_shadow_output(self):
        ctx = dict(self.context, signerWorkflow='trusted/workflow', signerSHA='a'*40)
        digests = {k:ctx.pop(k) for k in ('backendSha256','frontendSha256')}
        self.assertIs(json.loads(build(self.check(), trusted_context=ctx,
                                       measured_artifacts=digests))['productionReady'], False)

    def test_no_legacy_or_incomplete_proof(self):
        for kwargs in (dict(status=1), dict(network=''), dict(teardown='Diagnostic host teardown verified.'), dict(changes=dict(scope='isolated-container-browser-only')),
                       dict(changes=dict(browserUiTested=False)), dict(changes=dict(reconstructedIsolatedPairRecovery=False)),
                       dict(changes=dict(migrationCount=42)), dict(changes=dict(commit='b'*40))):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.check(**kwargs)

    def test_only_pinned_supervisor_invocation_binds_context(self):
        for index, value in ((-4, 'diagnostic'), (-2, 'f'*40), (-1, 'c'*40)):
            old = self.argv[index]
            self.argv[index] = value
            try:
                with self.subTest(index=index), self.assertRaises(ValueError):
                    self.check()
            finally:
                self.argv[index] = old
