import hashlib
import json
import unittest

from github_hosted_stage_shadow import FIELDS, JOBS_REQUIRED, PREDICATE, shadow
from github_shadow_stage_build import ARTIFACTS, CHECKS, IDS, REPORT_KIND, build


class SignerBuildTest(unittest.TestCase):
    def setUp(self):
        self.context = {k:'a'*40 for k in FIELDS - ARTIFACTS}
        self.context.update(repository='zhYAO/Image-web', repositoryId=4, runId=5, attempt=6,
                            sourceRef='refs/heads/main', event='push', migrationLedgerSha256='b'*64)
        self.digests = {k:'d'*64 for k in ARTIFACTS}
        self.report = dict({k:self.context[k] for k in IDS}, **self.digests, schemaVersion=1,
                           kind=REPORT_KIND, productionReady=False, checks=dict.fromkeys(CHECKS, True))

    def pack(self, changes=None):
        raw = json.dumps(dict(self.report, **(changes or {}))).encode()
        return build(raw, trusted_context=self.context, measured_artifacts=self.digests)

    def test_interoperates_with_shadow_policy(self):
        wire = self.pack()
        self.assertEqual(wire, self.pack())
        cert = {'runInvocationURI':'https://github.com/zhYAO/Image-web/actions/runs/5/attempts/6'}
        jobs = [dict(name=k, runId=5, attempt=6, status='completed', conclusion='success')
                for k in JOBS_REQUIRED]
        self.assertIs(shadow(wire, expected=dict(self.context, **self.digests), verified_certificate=cert,
            verified_subject_sha256=hashlib.sha256(wire).hexdigest(), verified_predicate_type=PREDICATE,
            jobs=jobs, run_started_at=1, now=2, seen=set())['productionReady'], False)

    def test_rejects_missing_untrusted_or_diagnostic_stage(self):
        for bad in (None, b''):
            with self.assertRaises(ValueError):
                build(bad, trusted_context=self.context, measured_artifacts=self.digests)
        for changes in (dict(kind='nonpromotable-browser-shadow'), dict(productionReady=True),
                        dict(attempt=5), dict(sourceRef='refs/heads/diagnostic'),
                        dict(frontendSha256='e'*64), dict(checks={}),
                        dict(checks=dict(self.report['checks'], noM7=1))):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.pack(changes)
