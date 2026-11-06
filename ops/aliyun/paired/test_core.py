import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('paired_core', HERE / 'core.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def policy():
    return {'schemaVersion': 1, 'operationId': 'paired-test-20261106', 'projectRef': 'klmiycyesxnpinxpeqep',
            'expiresAt': 10000, 'oldBackend': 'a'*40, 'newBackend': 'b'*40,
            'oldFrontend': 'release-aaaaaaaaaaaa', 'newFrontend': 'release-bbbbbbbbbbbb',
            'oldFrontendArtifact': '1'*64, 'backendManifestSha256': '2'*64,
            'frontendCandidateSha256': '3'*64, 'frontendPayloadSha256': '4'*64,
            'migrationSha256': '5'*64, 'migrationPayloadSha256': '6'*64,
            'databaseBeforeSha256': '7'*64, 'databaseAfterSha256': '8'*64,
            'workerSha256': '9'*64, 'configurationSha256': 'c'*64,
            'ingressSha256': 'd'*64, 'browserVerifierSha256': 'e'*64}


class Crash(BaseException): pass


class World:
    """Deterministic external-system fixture, not used by the CLI."""
    def __init__(self, p):
        self.p = p
        self.backend, self.frontend, self.sequence = p['oldBackend'], p['oldFrontend'], 4
        self.process = {'pid': 12, 'startTicks': 111, 'bootId': '00000000-0000-0000-0000-000000000001'}
        self.mode, self.ingress, self.mutating, self.stopped = 'open', 'open', 0, False
        self.fence = None
        self.old_artifact=p['oldFrontendArtifact']
        self.crash_at, self.effects = None, []
        self.policy_digest = c.digest(p)

    def effect(self, name):
        self.effects.append(name)
        if self.crash_at == name: raise Crash(name)

    def snapshot(self):
        return {'backend': self.backend, 'frontend': self.frontend, 'frontendSequence': self.sequence,
                'frontendArtifact':self.old_artifact if self.frontend==self.p['oldFrontend'] else 'f'*64,
                'process': None if self.stopped else copy.deepcopy(self.process), 'nodeMode': self.mode,
                'ingressMode': self.ingress, 'fence': self.fence, 'configurationSha256': self.p['configurationSha256'],
                'ingressSha256': self.p['ingressSha256']}

    def validate_backend(self, release, expected_manifest):
        if release != self.p['newBackend'] or expected_manifest != self.p['backendManifestSha256']: raise ValueError('candidate')

    def seal(self, record):
        self.fence = record['operationId']; self.ingress = 'sealed'; self.effect('seal')

    def drain(self, record, process):
        self.mode = 'draining'; self.effect('drain')
        if self.mutating or self.stopped or self.process != process: raise ValueError('not drained exact process')

    def stop(self, record, process):
        if self.mode != 'draining' or self.mutating or self.process != process: raise ValueError('unsafe stop')
        self.stopped = True; self.effect('stop')

    def select_backend(self, record):
        if not self.stopped or self.ingress != 'sealed': raise ValueError('unsafe selection')
        self.backend = self.p['newBackend']; self.effect('select_backend')

    def start(self, record, release):
        if not self.stopped: raise ValueError('already running')
        self.mode = 'checking'; self.ingress = 'checking'; self.stopped = False
        self.process = dict(self.process, pid=self.process['pid']+1, startTicks=self.process['startTicks']+100)
        self.effect('start')
        return self.snapshot()

    def resume_checks(self, record, process):
        if self.stopped or self.process != process or self.mode != 'draining' or self.ingress != 'sealed': raise ValueError('unsafe resume')
        self.mode = 'checking'; self.ingress = 'checking'; self.effect('resume_checks')
        return self.snapshot()

    def prepare_frontend(self, record, approval):
        if approval['artifactId'] != 'f'*64: raise ValueError('wrong formal artifact')
        self.effect('prepare_frontend')

    def publish_frontend(self, record, approval):
        self.sequence += 1; self.effect('frontend_sequence')
        self.frontend = self.p['newFrontend']; self.effect('frontend_pointer')
        return self.snapshot()

    def probe(self, record): self.effect('probe')

    def open(self, record, process):
        if self.stopped or self.process != process or self.mode != 'draining': raise ValueError('unsafe opening')
        self.mode = 'open'; self.effect('node_open')
        self.ingress = 'open'; self.fence = None; self.effect('ingress_open')

    def hold(self, record):
        self.ingress = 'sealed'; self.fence = record['operationId']; self.mode = 'draining'; self.effect('hold')


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.p = policy(); self.now = 1000
        self.world = World(self.p)
        self.j = c.Journal(Path(self.temp.name), owner_uid=os.getuid())
        self.co = c.Coordinator(self.p, self.world, self.j, clock=lambda: self.now,
                                receipt_validator=lambda receipt, request, **kw: receipt if receipt == {'valid': request['nonce']} else (_ for _ in ()).throw(ValueError('receipt')))

    def proof(self, stage, nonce=None):
        r = self.j.load()
        return {'schemaVersion': 1, 'kind': 'zimage-paired-database-v1', 'operationId': self.p['operationId'],
                'policySha256': c.digest(self.p), 'projectRef': self.p['projectRef'], 'checkedAt': self.now,
                'stage': stage, 'contractSha256': self.p['databaseBeforeSha256' if stage=='before' else 'databaseAfterSha256'],
                'workerSha256': self.p['workerSha256'], 'configurationSha256': self.p['configurationSha256'],
                'financialRowsSha256': '0'*64, 'activeJobs': 0, 'activeLeases': 0, 'quotaWithinFree': True,
                'migrationNonce': nonce if nonce is not None else (r or {}).get('migrationNonce'),
                'migrationSha256': self.p['migrationSha256'], 'migrationPayloadSha256': self.p['migrationPayloadSha256']}

    def auth(self):
        request = self.co.challenge()
        return self.co.accept_auth({'valid': request['nonce']})

    def sealed(self):
        self.co.begin(); self.auth(); self.co.seal()

    def dispatched(self):
        self.sealed(); return self.co.authorize_migration(self.proof('before'))

    def candidate(self):
        self.dispatched(); self.co.accept_database(self.proof('after')); self.co.start_candidate(); self.auth()

    def approved(self):
        return {'schemaVersion': 1, 'operationId': self.p['operationId'], 'policySha256': c.digest(self.p),
                'backendRelease': self.p['newBackend'], 'namespace': self.p['newFrontend'], 'artifactId': 'f'*64,
                'candidateSha256': self.p['frontendCandidateSha256'], 'payloadSha256': self.p['frontendPayloadSha256'],
                'manifestSha256': 'a'*64, 'archiveSha256': 'b'*64, 'acceptanceSha256': 'c'*64}

    def final(self):
        return {'schemaVersion': 1, 'operationId': self.p['operationId'], 'policySha256': c.digest(self.p),
                'checkedAt': self.now, 'pairStateSha256': c.digest(self.world.snapshot()),
                'acceptanceSha256': 'd'*64, 'chatAvailability': 'approved-disabled', 'newPaidCallsEnabled': False}

    def test_begin_has_no_external_effect_and_binds_process_sequence(self):
        r=self.co.begin()
        self.assertEqual(r['phase'], 'baseline_pending')
        self.assertEqual(r['initial'], self.world.snapshot())
        self.assertEqual(self.world.effects, [])

    def test_happy_path_changes_two_pointers_only_behind_seal_and_records_open_intent(self):
        self.candidate(); self.co.select_frontend(self.approved());self.auth()
        self.assertEqual(self.world.ingress, 'checking')
        self.assertFalse(self.j.load()['writesMayHaveOpened'])
        r=self.co.open(self.proof('after'), self.final())
        self.assertEqual(r['phase'],'opened'); self.assertTrue(r['writesMayHaveOpened'])
        self.assertEqual(self.world.ingress,'open')
        self.assertLess(self.world.effects.index('stop'), self.world.effects.index('select_backend'))
        phases=[v['record']['phase'] for v in self.j.events()]
        self.assertLess(phases.index('opening'), phases.index('opened'))

    def test_policy_rejects_same_schema_unknown_fields_and_nonfinite(self):
        for update in [{'databaseAfterSha256':self.p['databaseBeforeSha256']}, {'arbitraryCommand':'x'}, {'expiresAt':float('nan')}, {'schemaVersion':True}]:
            with self.subTest(update=update), self.assertRaises(ValueError): c.validate_policy(dict(self.p, **update), self.now)

    def test_migration_dispatch_never_repeats_even_if_database_still_before(self):
        request=self.dispatched()
        self.assertEqual(request['payloadSha256'], self.p['migrationPayloadSha256'])
        with self.assertRaises(ValueError): self.co.authorize_migration(self.proof('before'))
        with self.assertRaises(ValueError): self.co.cancel(self.proof('before'))
        self.assertNotIn('start', self.world.effects)

    def test_unknown_migration_response_does_not_start_candidate(self):
        self.dispatched()
        with self.assertRaises(ValueError): self.co.start_candidate()
        self.assertEqual(self.world.ingress,'sealed'); self.assertTrue(self.world.stopped)

    def test_wrong_database_contract_nonce_or_financial_hash_stays_sealed(self):
        for update in [{'contractSha256':'a'*64},{'migrationNonce':'e'*64},{'financialRowsSha256':'1'*64}, {'activeLeases':1}, {'quotaWithinFree':False}, {'checkedAt':0}]:
            with self.subTest(update=update):
                # each rejection is read-only and can be reconciled with a later proof
                if self.j.load() is None:self.dispatched()
                with self.assertRaises(ValueError): self.co.accept_database(dict(self.proof('after'), **update))
                self.assertEqual(self.world.ingress,'sealed')

    def test_real_drain_failure_keeps_process_running_and_does_not_stop(self):
        self.co.begin();self.auth();self.world.mutating=1
        with self.assertRaises(ValueError):self.co.seal()
        self.assertFalse(self.world.stopped);self.assertNotIn('stop',self.world.effects)
        self.assertEqual(self.world.ingress,'sealed')

    def test_process_aba_and_frontend_sequence_aba_reject_before_sealing(self):
        for field in ['process','sequence']:
            with self.subTest(field=field):
                if self.j.load() is None:self.co.begin();self.auth()
                if field=='process':self.world.process['startTicks']+=1
                else:self.world.sequence+=1
                with self.assertRaises(ValueError):self.co.seal()
                self.assertNotIn('stop',self.world.effects)

    def test_auth_is_fresh_process_bound_and_nonce_not_reusable(self):
        self.co.begin();q=self.co.challenge();self.now+=121
        with self.assertRaises(ValueError):self.co.accept_auth({'valid':q['nonce']})
        self.now-=121;self.auth()
        with self.assertRaises(ValueError):self.co.accept_auth({'valid':q['nonce']})

    def test_expired_baseline_does_not_begin_maintenance(self):
        self.co.begin();self.auth();self.now+=121
        with self.assertRaises(ValueError):self.co.seal()
        self.assertEqual(self.world.ingress,'open')

    def test_expired_verified_baseline_can_renew_without_sealing_or_reusing_old_receipt(self):
        self.co.begin(); old = self.co.challenge(); self.co.accept_auth({'valid': old['nonce']})
        self.now += 121
        with self.assertRaises(ValueError): self.co.seal()
        renewed = self.co.challenge()
        self.assertNotEqual(renewed['nonce'], old['nonce'])
        self.assertEqual(self.j.load()['phase'], 'baseline_pending')
        self.assertEqual(self.j.load()['challengeCount'], 2)
        self.assertEqual(self.world.effects, [])
        self.assertEqual(self.world.ingress, 'open')
        with self.assertRaises(ValueError): self.co.accept_auth({'valid': old['nonce']})
        with self.assertRaises(ValueError): self.co.seal()
        self.co.accept_auth({'valid': renewed['nonce']}); self.co.seal()
        self.assertEqual(self.j.load()['phase'], 'sealed')

    def test_verified_baseline_renewal_keeps_round_limit_and_rechecks_exact_live_pair(self):
        self.co.begin()
        for _ in range(8): self.auth()
        with self.assertRaises(ValueError): self.co.challenge()
        self.assertEqual(self.j.load()['challengeCount'], 8)
        self.assertEqual(self.world.effects, [])

    def test_verified_baseline_renewal_rejects_process_drift_without_journal_change(self):
        self.co.begin(); self.auth()
        before = (self.j.root / 'state.json').read_bytes()
        self.world.process['startTicks'] += 1
        with self.assertRaises(ValueError): self.co.challenge()
        self.assertEqual((self.j.root / 'state.json').read_bytes(), before)
        self.assertEqual(self.world.effects, [])

    def test_pre_dispatch_cancel_requires_fresh_old_database_and_auth_before_reopening(self):
        self.sealed();r=self.co.cancel(self.proof('before'))
        self.assertEqual(r['phase'],'recovery_auth_pending');self.assertEqual(self.world.ingress,'checking')
        self.auth();r=self.co.open_recovered(self.proof('before'),self.final())
        self.assertEqual(r['phase'],'recovered');self.assertEqual(self.world.backend,self.p['oldBackend'])

    def failed_started_candidate(self):
        self.dispatched(); self.co.accept_database(self.proof('after'))
        self.world.crash_at = 'start'
        # Runtime/health failure, rather than abrupt process loss, invokes hold.
        original = self.world.effect
        def effect(name):
            if name == 'start': raise RuntimeError('legacy readiness incompatible')
            original(name)
        self.world.effect = effect
        with self.assertRaises(RuntimeError): self.co.start_candidate()
        self.world.effect = original; self.world.crash_at = None

    def test_reconcile_started_candidate_rechecks_snapshot_and_database_without_restarting(self):
        self.failed_started_candidate()
        before_starts = self.world.process['pid']
        snap = c.digest(self.world.snapshot())
        r = self.co.reconcile_candidate(self.proof('after'), snap)
        self.assertEqual(r['phase'], 'candidate_auth_pending')
        self.assertEqual(self.world.process['pid'], before_starts)
        self.assertEqual(self.world.ingress, 'checking')
        self.assertFalse(r['writesMayHaveOpened'])
        with self.assertRaises(ValueError): self.co.select_frontend(self.approved())
        self.auth()
        self.assertEqual(self.j.load()['phase'], 'candidate_verified')
        with self.assertRaises(ValueError): self.co.reconcile_candidate(self.proof('after'), snap)

    def test_reconcile_started_candidate_rejects_stale_snapshot_and_changed_funds(self):
        self.failed_started_candidate()
        before = (self.j.root / 'state.json').read_bytes()
        with self.assertRaises(ValueError): self.co.reconcile_candidate(self.proof('after'), 'f' * 64)
        with self.assertRaises(ValueError): self.co.reconcile_candidate(dict(self.proof('after'), financialRowsSha256='f' * 64), c.digest(self.world.snapshot()))
        self.assertEqual((self.j.root / 'state.json').read_bytes(), before)
        self.assertEqual(self.world.ingress, 'sealed')

    def test_reconcile_failure_after_intent_keeps_sealed_and_cannot_replay(self):
        self.failed_started_candidate()
        def fail(record,process): raise RuntimeError('readiness failure')
        self.world.resume_checks=fail
        with self.assertRaises(RuntimeError): self.co.reconcile_candidate(self.proof('after'),c.digest(self.world.snapshot()))
        self.assertEqual(self.j.load()['blockedFrom'],'candidate_reconcile_intent')
        self.assertEqual(self.world.ingress,'sealed')
        with self.assertRaises(ValueError): self.co.reconcile_candidate(self.proof('after'),c.digest(self.world.snapshot()))

    def test_frontend_approval_cannot_claim_old_or_arbitrary_candidate(self):
        self.candidate()
        with self.assertRaises(ValueError):self.co.select_frontend(dict(self.approved(),candidateSha256='9'*64))
        self.assertEqual(self.world.frontend,self.p['oldFrontend'])

    def test_failure_at_every_mutating_boundary_never_automatically_restores_or_reopens(self):
        for boundary in ['seal','drain','stop','select_backend','start','prepare_frontend','frontend_sequence','frontend_pointer','probe','node_open','ingress_open']:
            with self.subTest(boundary=boundary):
                with tempfile.TemporaryDirectory() as tmp:
                    self.j=c.Journal(Path(tmp),owner_uid=os.getuid());self.world=World(self.p)
                    self.co=c.Coordinator(self.p,self.world,self.j,clock=lambda:self.now,receipt_validator=lambda x,q,**kw:x)
                    self.world.crash_at=boundary
                    with self.assertRaises(Crash):
                        self.co.begin();self.auth();self.co.seal();self.co.authorize_migration(self.proof('before'))
                        self.co.accept_database(self.proof('after'));self.co.start_candidate();self.auth()
                        self.co.select_frontend(self.approved());self.auth();self.co.open(self.proof('after'),self.final())
                    r=self.j.load()
                    self.assertNotEqual(r['phase'],'opened')
                    if boundary in ['node_open','ingress_open']:self.assertTrue(r['writesMayHaveOpened'])
                    self.assertEqual(sum(x=='start' for x in self.world.effects),int(boundary in ['start','prepare_frontend','frontend_sequence','frontend_pointer','probe','node_open','ingress_open']))
                    # Repeating the interrupted command is rejected from its durable intent.
                    with self.assertRaises(ValueError):self.co.begin()

    def test_bad_final_approval_cannot_open(self):
        self.candidate();self.co.select_frontend(self.approved());self.auth()
        with self.assertRaises(ValueError):self.co.open(self.proof('after'),dict(self.final(),newPaidCallsEnabled=True))
        self.assertEqual(self.world.ingress,'checking')

    def test_journal_tamper_or_missing_event_is_detected(self):
        self.co.begin();self.auth()
        path=self.j.root/'state.json';value=json.loads(path.read_bytes());value['record']['phase']='opened';path.write_text(json.dumps(value))
        with self.assertRaises(ValueError):self.j.load()

    def test_frontend_selection_requires_a_new_fresh_auth_round_before_open(self):
        self.candidate();r=self.co.select_frontend(self.approved())
        self.assertEqual(r['phase'],'pair_auth_pending')
        with self.assertRaises(ValueError):self.co.open(self.proof('after'),self.final())
        self.auth();self.now+=121
        with self.assertRaises(ValueError):self.co.open(self.proof('after'),self.final())

    def test_challenge_rounds_are_bounded_even_when_no_requests_succeed(self):
        self.co.begin()
        for _ in range(8):self.co.challenge()
        with self.assertRaises(ValueError):self.co.challenge()

    def test_interrupted_event_state_commit_does_not_replay(self):
        self.co.begin();old=(self.j.root/'state.json').read_bytes();self.co.challenge()
        (self.j.root/'state.json').write_bytes(old)
        with self.assertRaises(ValueError):self.j.load()

    def test_review_frontend_preparation_crash_is_not_replayable(self):
        self.candidate();self.world.crash_at='prepare_frontend'
        with self.assertRaises(Crash):self.co.select_frontend(self.approved())
        self.assertEqual(self.j.load()['phase'],'frontend_prepare_intent')
        with self.assertRaises(ValueError):self.co.select_frontend(self.approved())
        self.assertEqual(self.world.effects.count('prepare_frontend'),1)

    def test_review_wrong_old_artifact_policy_cannot_begin_or_recover(self):
        wrong=dict(self.p,oldFrontendArtifact='0'*64)
        co=c.Coordinator(wrong,self.world,self.j,clock=lambda:self.now,receipt_validator=lambda *args,**kw:None)
        with self.assertRaises(ValueError):co.begin()
        self.sealed();self.world.old_artifact='0'*64
        with self.assertRaises(ValueError):self.co.cancel(self.proof('before'))

    def test_status_journal_read_does_not_create_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);journal=c.Journal(root,owner_uid=os.getuid())
            self.assertIsNone(journal.load())
            self.assertEqual(list(root.iterdir()),[])


if __name__=='__main__':unittest.main()
