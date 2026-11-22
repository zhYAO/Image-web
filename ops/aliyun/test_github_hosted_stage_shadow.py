import hashlib
import json
import unittest

from github_hosted_stage_shadow import JOBS_REQUIRED, KIND, PREDICATE, shadow


class ShadowTest(unittest.TestCase):
    def setUp(self):
        self.pins = dict(repository='zhYAO/Image-web', repositoryId=71,
                         sourceRef='refs/heads/main', sourceSHA='a'*40, event='push',
                         workflow='release.yml', signerWorkflow='trusted/stage/.github/workflows/stage.yml',
                         signerSHA='b'*40, runId=45079209122, attempt=2, backendSha256='c'*64,
                         frontendSha256='d'*64, baselineSHA='e'*40, migrationLedgerSha256='f'*64)
        self.jobs = [dict(name=name, runId=45079209122, attempt=2, status='completed', conclusion='success')
                     for name in JOBS_REQUIRED]

    def check(self, changes=None, **kwargs):
        content = dict(self.pins, schemaVersion=1, kind=KIND, productionReady=False)
        content.update(changes or {})
        payload = json.dumps(content).encode()
        values = dict(expected=self.pins, verified_subject_sha256=hashlib.sha256(payload).hexdigest(),
                      verified_certificate={'runInvocationURI': 'https://github.com/zhYAO/Image-web/actions/runs/45079209122/attempts/2'},
                      verified_predicate_type=PREDICATE, jobs=self.jobs, run_started_at=10, now=11, seen=set())
        values.update(kwargs)
        return shadow(payload, **values)

    def test_success_is_shadow_only(self):
        self.assertEqual(self.check(), dict(shadowVerified=True, productionReady=False,
                                            replayKey=(71, 45079209122, 2)))

    def test_pin_drift_or_unknown_fields(self):
        for field in self.pins:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check({field: 'wrong'})
        with self.assertRaises(ValueError):
            self.check({'extra': True})

    def test_digest_ttl_and_replay(self):
        for changes in (dict(verified_subject_sha256=None), dict(now=9), dict(now=7211),
                        dict(seen={(71, 45079209122, 2)})):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.check(**changes)

    def test_jobs_must_be_unique_green_and_same_attempt(self):
        for jobs in (self.jobs[:1], self.jobs + self.jobs[:1],
                     [dict(self.jobs[0], attempt=1), self.jobs[1]],
                     [self.jobs[0], dict(self.jobs[1], conclusion='skipped')]):
            with self.subTest(jobs=jobs), self.assertRaises(ValueError):
                self.check(jobs=jobs)

    def test_certificate_invocation_and_predicate(self):
        for override in (
            dict(verified_certificate=None), dict(verified_certificate={}),
            dict(verified_certificate={'runInvocationURI': 'https://github.com/zhYAO/Image-web/actions/runs/45079209122/attempts/1'}),
            dict(verified_certificate={'runInvocationURI': 'https://github.com/elsewhere/project/actions/runs/45079209122/attempts/2'}),
            dict(verified_predicate_type='https://example.test/other'),
        ):
            with self.subTest(override=override), self.assertRaises(ValueError):
                self.check(**override)

    def test_diagnostic_and_promotion_shapes_rejected(self):
        for override in (dict(kind='diagnostic-attestation'), dict(productionReady=True),
                         dict(productionReady=0)):
            with self.subTest(override=override), self.assertRaises(ValueError):
                self.check(override)

    def test_reject_duplicate_keys(self):
        payload = b'{"schemaVersion":1,"schemaVersion":1}'
        with self.assertRaises(ValueError):
            shadow(payload, expected=self.pins, jobs=self.jobs, now=11,
                   verified_certificate={}, verified_predicate_type=PREDICATE,
                   run_started_at=10, seen=set(),
                   verified_subject_sha256=hashlib.sha256(payload).hexdigest())


class GhAdapterTest(ShadowTest):
    def adapter(self, defect='', signed=None):
        from subprocess import CompletedProcess
        from github_hosted_stage_shadow import from_gh

        signed = signed or dict(self.pins, schemaVersion=1, kind=KIND, productionReady=False)
        payload = json.dumps(signed).encode()
        digest = hashlib.sha256(payload).hexdigest()
        cert = {'runInvocationURI': 'https://github.com/zhYAO/Image-web/actions/runs/45079209122/attempts/2'}
        gh = {'verificationResult': {'statement': {
            '_type': 'https://in-toto.io/Statement/v1', 'predicateType': PREDICATE,
            'predicate': {}, 'subject': [{'name': 'stage.json', 'digest': {'sha256': digest}}],
        }, 'signature': {'certificate': cert}}}
        argv = ['gh', 'attestation', 'verify', 'stage.json', '--repo', self.pins['repository'],
                '--signer-workflow', self.pins['signerWorkflow'], '--signer-digest', self.pins['signerSHA'],
                '--source-ref', self.pins['sourceRef'], '--source-digest', self.pins['sourceSHA'],
                '--deny-self-hosted-runners', '--predicate-type', PREDICATE, '--format', 'json']
        if defect == 'missing-invocation':
            cert.clear()
        if defect == 'digest':
            gh['verificationResult']['statement']['subject'][0]['digest']['sha256'] = '0'*64
        if defect == 'wrong-predicate':
            gh['verificationResult']['statement']['predicateType'] = 'https://example.test/other'
        if defect == 'missing-pin':
            argv[7:9] = []
        result = CompletedProcess(argv, int(defect == 'nonzero'),
                                  json.dumps([gh, {}] if defect == 'mixed' else [gh]))
        return from_gh(result, payload=payload, subject_path='stage.json', expected=self.pins)

    def test_gh_adapter_returns_bound_shape(self):
        self.assertEqual(self.adapter()['verified_predicate_type'], PREDICATE)

    def test_gh_adapter_rejects_invalid_result_and_diagnostic(self):
        for defect in ('missing-invocation', 'digest', 'wrong-predicate', 'missing-pin', 'nonzero', 'mixed'):
            with self.subTest(defect=defect), self.assertRaises(ValueError):
                self.adapter(defect)
        with self.assertRaises(ValueError):
            self.adapter(signed=dict(schemaVersion=1, kind='nonpromotable-browser-shadow',
                                     productionReady=False, repository=self.pins['repository'],
                                     workflow='diagnostic-branch-workflow-ref', commit='a'*40,
                                     runId='45079209122', attempt='2', backendTransportSha256='b'*64,
                                     frontendDiagnosticSha256='c'*64, migrationLedgerSha256='d'*64,
                                     migrationCount=43, diagnostics=['synthetic-credentials', 'no-m7',
                                         'loopback-nginx-chromium', 'reconstructed-pair-recovery']))
