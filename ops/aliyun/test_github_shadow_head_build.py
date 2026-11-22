import hashlib
import unittest

from github_shadow_head import PAIR_PINS, PAIR_SOURCES, observation
from github_shadow_head_build import build
from github_hosted_stage_shadow import PREDICATE
from github_shadow_pins import pins


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.policy = dict(repositoryId=10, workflowId=11, workflow='.github/workflows/release.yml',
                           signerWorkflow='t/stage/.github/workflows/stage.yml', signerSHA='a'*40,
                           baselineSHA='b'*40, migrationLedgerSha256='c'*64,
                           jobNames={'isolated-stage': 'qual / staged', 'attest-stage': 'qual / signed'})
        self.measured = dict(runId=42, attempt=2, sourceSHA='d'*40,
                             backendSha256='e'*64, frontendSha256='f'*64)
        repo = dict(id=10, full_name='zhYAO/Image-web')
        self.run = dict(id=42, run_attempt=2, workflow_id=11, path=self.policy['workflow'], event='push',
                        head_branch='main', head_sha='d'*40, repository=repo, head_repository=repo,
                        status='completed', conclusion='success', run_started_at='1970-01-01T00:01:35Z')
        self.jobs = dict(total_count=2, jobs=[dict(name=n, run_id=42, run_attempt=2,
                         head_sha='d'*40, status='completed', conclusion='success')
                         for n in self.policy['jobNames'].values()])
        self.challenge = dict(node='n1', nonce='a'*64, generation=2, challengeIssuedAt=90, challengeExpiresAt=150,
                              **{k:'b'*40 for k in PAIR_SOURCES}, **{k:'c'*64 for k in PAIR_PINS})
        self.branch = dict(name='main', protected=True, commit=dict(sha='d'*40))

    def make(self):
        return build(policy=self.policy, measured=self.measured, run=self.run, jobs=self.jobs,
                     challenge=self.challenge, observe_main=lambda:self.branch, clock=lambda:100)

    def test_canonical_bytes_interoperate_with_offline_policy(self):
        body = self.make()
        self.assertEqual(body, self.make())
        repo = 'https://github.com/t/observer'
        policy = dict(stageSignerWorkflow=self.policy['signerWorkflow'], stageSignerSHA='a'*40,
                      stageSignerURI='stage', stageCallerWorkflowId=11, stageJobNames=self.policy['jobNames'],
                      observerRepositoryId='99', observerRepositoryURI=repo, observerSourceRef='refs/heads/main',
                      observerCallerURI=repo+'/caller', observerCallerSHA='b'*40, observerSignerURI=repo+'/signer',
                      observerSignerSHA='c'*40)
        certificate = dict(sourceRepositoryIdentifier='99', sourceRepositoryURI=repo, sourceRepositoryRef='refs/heads/main',
                           buildConfigURI=repo+'/caller', buildConfigDigest='b'*40, buildSignerURI=repo+'/signer',
                           buildSignerDigest='c'*40, issuer='https://token.actions.githubusercontent.com',
                           runnerEnvironment='github-hosted', runInvocationURI=repo+'/actions/runs/99/attempts/1')
        verified_fixture = dict(verified_subject_sha256=hashlib.sha256(body).hexdigest(),
                                verified_predicate_type=PREDICATE, verified_certificate=certificate)
        exp = pins(policy=self.policy, release=self.measured, run=self.run, jobs=self.jobs)['expected']
        result = observation(body, verified=verified_fixture, policy=policy, expected=exp,
                             local=dict(self.challenge, highestSeenGeneration=1), now=101, seen=())
        self.assertEqual(result['expected'], exp)

    def test_stage_or_branch_drift_rejected(self):
        self.branch['commit']['sha'] = 'c'*40
        with self.assertRaises(ValueError):
            self.make()
        self.branch['commit']['sha'] = 'd'*40
        self.run['head_branch'] = 'diagnostic'
        with self.assertRaises(ValueError):
            self.make()
        self.run['head_branch'] = 'main'
        self.jobs['jobs'][0]['conclusion'] = 'skipped'
        with self.assertRaises(ValueError):
            self.make()

    def test_caller_supplied_digest_or_branch_rejected(self):
        for key in ('backendSha256', 'protected'):
            self.challenge[key] = 'untrusted'
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.make()
            del self.challenge[key]
