import hashlib
import json
import unittest

from github_shadow_head import KIND, RELEASE, observation
from github_hosted_stage_shadow import PREDICATE


class HeadTest(unittest.TestCase):
    def setUp(self):
        self.expected = dict.fromkeys(RELEASE, 'p')
        self.expected.update(repository='zhYAO/Image-web', repositoryId=32, sourceRef='refs/heads/main',
                             event='push', runId=42, attempt=2, signerWorkflow='stage', signerSHA='a'*40)
        repo = 'https://github.com/independent/observer'
        self.policy = dict(observerRepositoryId='52', observerRepositoryURI=repo,
                           observerSourceRef='refs/heads/main', observerCallerURI=repo+'/caller',
                           observerCallerSHA='b'*40, observerSignerURI=repo+'/signer',
                           observerSignerSHA='c'*40, stageSignerURI='https://github.com/independent/stage/signer',
                           stageSignerWorkflow='stage', stageSignerSHA='a'*40, stageCallerWorkflowId=9,
                           stageJobNames={'isolated-stage':'isolated / test', 'attest-stage':'isolated / sign'})
        self.cert = dict(sourceRepositoryIdentifier='52', sourceRepositoryURI=repo,
                         sourceRepositoryRef='refs/heads/main', buildConfigURI=repo+'/caller', buildConfigDigest='b'*40,
                         buildSignerURI=repo+'/signer', buildSignerDigest='c'*40, runnerEnvironment='github-hosted',
                         issuer='https://token.actions.githubusercontent.com', runInvocationURI=repo+'/actions/runs/3/attempts/1')
        peer = dict(node='node-1', nonce='d'*64, generation=3, rollbackBackendSHA='e'*40, rollbackFrontendSHA='f'*40,
                    rollbackBackendManifestSha256='a'*64, rollbackFrontendArtifactSha256='b'*64,
                    rollbackFrontendConfigFingerprint='c'*64)
        self.local = dict(peer, highestSeenGeneration=2, challengeIssuedAt=90, challengeExpiresAt=140)
        jobs = [dict(name=n, runId=42, attempt=2, status='completed', conclusion='success')
                for n in self.policy['stageJobNames'].values()]
        self.statement = dict({k:self.expected[k] for k in RELEASE}, **peer, schemaVersion=1, kind=KIND,
                              protected=True, productionReady=False, observedAt=100, expiresAt=130,
                              runStartedAt=95, callerWorkflowId=9, jobs=jobs)

    def check(self, statement=None, cert=None, now=110, seen=()):
        body = json.dumps(statement or self.statement).encode()
        verified = dict(verified_subject_sha256=hashlib.sha256(body).hexdigest(),
                        verified_predicate_type=PREDICATE, verified_certificate=cert or self.cert)
        return observation(body, verified=verified, policy=self.policy, expected=self.expected,
                           local=self.local, now=now, seen=seen)

    def test_gives_wire_callback_shape(self):
        self.assertEqual([j['name'] for j in self.check()['jobs']], ['isolated-stage', 'attest-stage'])

    def test_stale_replayed_or_wrong_hub(self):
        for kwargs in (dict(now=130), dict(seen={(32,42,2)}),
                       dict(cert=dict(self.cert, sourceRepositoryIdentifier='53')),
                       dict(cert=dict(self.cert, buildSignerDigest='a'*40)),
                       dict(cert=dict(self.cert, runInvocationURI='https://github.com/fake/fake/actions/runs/3/attempts/1'))):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.check(**kwargs)
        self.local['highestSeenGeneration'] = 3
        with self.assertRaises(ValueError):
            self.check()

    def test_rejects_wrong_pair_and_mixed_attempt(self):
        jobs = self.statement['jobs']
        for change in (dict(frontendSha256='foreign'), dict(rollbackBackendSHA='a'*40),
                       dict(nonce='a'*64), dict(protected=False), dict(callerWorkflowId=10),
                       dict(jobs=[jobs[0], dict(jobs[1], attempt=1)])):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.check(statement=dict(self.statement, **change))

    def test_rejects_variant_of_same_rollback_sources(self):
        for key in ('rollbackBackendManifestSha256', 'rollbackFrontendArtifactSha256',
                    'rollbackFrontendConfigFingerprint'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(statement=dict(self.statement, **{key:'0'*64}))
