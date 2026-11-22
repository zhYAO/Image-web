import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

from github_shadow_head import PAIR_PINS, PAIR_SOURCES
from github_shadow_wire import HEADER, MAGIC
from ordinary_shadow_preflight import run
from github_hosted_stage_shadow import FIELDS, JOBS_REQUIRED, KIND, PREDICATE

sys.path.insert(0, str(Path(__file__).parent / 'paired'))
import core
from ordinary_journal import JournalGate, PHASES


class PreflightTest(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name).resolve()
        (self.root / 'deploy.lock').touch(mode=0o600)
        self.history = self.root / 'ordinary-operations'
        self.history.mkdir(mode=0o700)
        self.gate = JournalGate(self.root, core, owner_uid=os.getuid())
        self.data = dict(**{k:'a'*40 for k in PAIR_SOURCES}, **{k:'b'*64 for k in PAIR_PINS})
        self.read = Mock(return_value=self.data)
        self.observer, self.verifier = Mock(), Mock()
        self.packet = HEADER.pack(MAGIC, 1, 1, 1, 1) + b'abcd'

    def check(self):
        return run(self.packet, gate=self.gate, operation='release-shadow', expected_baseline=self.data,
                   read_baseline=self.read, observe=self.observer, verify=self.verifier)

    def seed(self, op, phases):
        with self.gate.lock():
            self.gate.assert_clear(op)
            for phase in phases:
                self.gate.journal(dict(operation=op, rootApprovalSha256='e'*64, phase=phase))

    def test_unresolved_and_reused_stop_before_observer(self):
        for phase, op in ((PHASES, 'release-shadow'), (PHASES[:1], 'release-foreign')):
            with self.subTest(op=op):
                self.seed(op, phase)
                self.assertEqual(self.check()['reason'], 'ordinary-gate-unavailable')
                self.read.assert_not_called()
                self.observer.assert_not_called()
                self.verifier.assert_not_called()

    def test_live_baseline_mismatch_stops_before_verify(self):
        self.read.return_value = dict(self.data, rollbackBackendManifestSha256='d'*64)
        self.assertEqual(self.check()['reason'], 'live-baseline-mismatch')
        self.observer.assert_not_called()
        self.verifier.assert_not_called()
        self.assertFalse(list(self.history.iterdir()))

    def test_success_no_journal_and_drift_fails(self):
        ok = {'status':'shadow-verified', 'productionReady':False}
        pins = dict.fromkeys(FIELDS, 'a'*40)
        pins.update(repository='zhYAO/Image-web', repositoryId=5, runId=6, attempt=7,
                    event='push', sourceRef='refs/heads/main', backendSha256='a'*64,
                    frontendSha256='b'*64, migrationLedgerSha256='c'*64)
        payload = json.dumps(dict(pins, schemaVersion=1, kind=KIND, productionReady=False)).encode()
        self.packet = HEADER.pack(MAGIC, len(payload), 1, 1, 1) + payload + b'bcd'
        jobs = [dict(name=k, runId=6, attempt=7, status='completed', conclusion='success')
                for k in JOBS_REQUIRED]
        self.observer.return_value = dict(expected=pins, jobs=jobs, run_started_at=1, now=2, seen=())
        self.verifier.return_value = dict(verified_subject_sha256=hashlib.sha256(payload).hexdigest(),
            verified_certificate={'runInvocationURI':'https://github.com/zhYAO/Image-web/actions/runs/6/attempts/7'},
            verified_predicate_type=PREDICATE)
        self.assertEqual(self.check(), ok)
        self.read.side_effect = [self.data, dict(self.data, rollbackFrontendConfigFingerprint='c'*64)]
        self.assertEqual(self.check()['reason'], 'live-baseline-mismatch')
        self.assertFalse(list(self.history.iterdir()))

    def test_contended_deployment_lock_does_not_wait_or_verify(self):
        import fcntl
        with (self.root / 'deploy.lock').open('rb') as holder:
            fcntl.flock(holder, fcntl.LOCK_EX)
            self.assertEqual(self.check()['reason'], 'ordinary-gate-unavailable')
        self.read.assert_not_called()
        self.observer.assert_not_called()
        self.verifier.assert_not_called()
