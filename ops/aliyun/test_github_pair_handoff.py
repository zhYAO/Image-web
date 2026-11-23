from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

import github_pair_handoff as handoff
import github_hosted_stage_shadow as stage


class HandoffTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.request = Path(self.tmp.name) / 'request'
        self.request.mkdir()
        self.release = 'a' * 40
        self.now = 1764000020
        self.repo = dict(id=handoff.REPO_ID, full_name=handoff.REPO)
        self.policy = dict(repositoryId=handoff.REPO_ID, workflowId=22, workflow=handoff.WORKFLOW,
                           signerWorkflow=handoff.REPO + '/.github/workflows/attest-stage.yml', signerSHA='b' * 40,
                           baselineSHA='c' * 40, migrationLedgerSha256='d' * 64,
                           jobNames={'isolated-stage': 'hosted-shadow', 'attest-stage': 'attest-stage / sign'})
        self.run = dict(id=10, run_attempt=2, workflow_id=22, path=handoff.WORKFLOW,
                        event='push', head_branch='main', head_sha=self.release,
                        repository=self.repo, head_repository=self.repo, status='in_progress', conclusion=None,
                        run_started_at=datetime.fromtimestamp(self.now - 15, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
        self.jobs = dict(total_count=2, jobs=[dict(name=name, run_id=10, run_attempt=2,
                                                  head_sha=self.release, status='completed', conclusion='success')
                                              for name in self.policy['jobNames'].values()])
        self.branch = dict(name='main', protected=True, commit=dict(sha=self.release))
        self.data = {handoff.API + '/branches/main': self.branch,
                     handoff.API + '/actions/runs/10/attempts/2': self.run,
                     handoff.API + '/actions/runs/10/attempts/2/jobs?per_page=100': self.jobs}
        self.get = Mock(side_effect=self.data.__getitem__)
        self.candidate = dict(commit=self.release, runId=10, attempt=2, lane='browser-shadow',
                              frontendNamespace='release-' + self.release[:12])
        for name, field in (('backend', 'manifestSha256'), ('frontend', 'subjectSha256')):
            raw = name.encode()
            (self.request / (name + '.zip')).write_bytes(raw)
            self.candidate[name] = {'artifactSha256': hashlib.sha256(raw).hexdigest(), field: 'e' * 64}
        (self.request / 'pins.json').write_text(json.dumps(self.candidate), encoding='utf-8')
        (self.request / 'config.json').write_bytes(b'{}')
        self.rollback = dict(backend='b' * 40, frontend='release-' + 'b' * 12)
        (self.request / 'rollback.json').write_bytes(json.dumps(self.rollback).encode())
        self.expected = {k: self.policy[k] for k in ('repositoryId', 'workflow', 'signerWorkflow',
                                                      'signerSHA', 'baselineSHA', 'migrationLedgerSha256')}
        self.expected.update(repository=handoff.REPO, sourceRef='refs/heads/main', event='push',
                             sourceSHA=self.release, runId=10, attempt=2,
                             backendSha256=self.candidate['backend']['artifactSha256'],
                             frontendSha256=self.candidate['frontend']['artifactSha256'])
        self.subject = json.dumps(dict(self.expected, schemaVersion=1, kind=stage.KIND,
                                       productionReady=False)).encode()
        (self.request / 'stage.json').write_bytes(self.subject)
        (self.request / 'stage.bundle.jsonl').write_bytes(b'test-bundle')
        self.verify = Mock(return_value=dict(
            verified_subject_sha256=hashlib.sha256(self.subject).hexdigest(),
            verified_certificate={'runInvocationURI': f'https://github.com/{handoff.REPO}/actions/runs/10/attempts/2'},
            verified_predicate_type=stage.PREDICATE))
        self.intake = Mock()
        self.intake.read_json.side_effect = lambda path: json.loads(path.read_bytes())
        self.intake.hosted_namespace.side_effect = lambda pins, mode: (
            pins['lane'] == 'browser-shadow' and pins['frontendNamespace'] == 'release-' + pins['commit'][:12]
            and mode == 'hosted-shadow')
        self.intake.evaluate.return_value = dict(immutablePairVerified=True, productionReady=False,
                                                 commit=self.release, runId=10, attempt=2)

    def admit(self, seen=frozenset()):
        return handoff.admit(self.request, policy=self.policy, get=self.get, verify=self.verify,
                             intake=self.intake, now=self.now, seen=seen)

    def test_channel_exact_members_and_bounds(self):
        out = io.BytesIO()
        handoff.send(self.request, out)
        packet = out.getvalue()
        oversize = handoff.MAGIC + handoff.LENGTH.pack(4097)
        for n, body in enumerate((packet, packet[:-1], packet + b'x', oversize, b'other')):
            target = Path(self.tmp.name) / str(n)
            target.mkdir()
            with self.subTest(n=n):
                if n == 0:
                    handoff.receive(io.BytesIO(body), target)
                    self.assertEqual({p.name: p.read_bytes() for p in target.iterdir()},
                                     {p.name: p.read_bytes() for p in self.request.iterdir()})
                else:
                    with self.assertRaises(ValueError):
                        handoff.receive(io.BytesIO(body), target)

    def test_same_attempt_signature_and_pair(self):
        result = self.admit()
        self.verify.assert_called_once_with(payload=self.subject, bundle=b'test-bundle', expected=self.expected)
        self.assertEqual(result['packet']['commit'], self.release)
        self.assertEqual(result['replayKey'], (handoff.REPO_ID, 10, 2))
        self.assertEqual(result['rollbackPair'], self.rollback)
        self.assertEqual(self.get.call_args.args, (handoff.API + '/branches/main',))

    def test_interactive_publication_and_restoration_stop_before_the_observer_response(self):
        selector = {'packet': {'commit': self.release}, 'approvalSha256': 'a' * 64}
        for name, payload, send, expected in [('publication', self.request, handoff.send, None),
                                              ('restoration', selector, handoff.send_restoration, selector)]:
            with self.subTest(name=name):
                target = Path(self.tmp.name) / name
                target.mkdir()
                wire = io.BytesIO()
                send(payload, wire, interactive=True)
                request = wire.getvalue()
                with self.assertRaisesRegex(ValueError, 'Unknown pair handoff protocol'):
                    handoff.receive(io.BytesIO(request), target)
                first_response = b'observer-response'
                stream = io.BytesIO(request + first_response)
                self.assertEqual(handoff.receive(stream, target, interactive=True), expected)
                self.assertEqual(stream.read(), first_response)

    def test_interactive_restore_requires_explicit_terminator(self):
        wire = io.BytesIO()
        handoff.send_restoration({'packet': {}}, wire, interactive=True)
        for tail in (b'', b'x' * len(handoff.REQUEST_END)):
            body = wire.getvalue()[:-len(handoff.REQUEST_END)] + tail
            with self.subTest(tail=tail), self.assertRaises(ValueError):
                handoff.receive(io.BytesIO(body), self.request, interactive=True)

    def test_restoration_frame_is_bounded_and_does_not_materialize_files(self):
        selector = {'packet': {'commit': self.release}, 'approvalSha256': 'a' * 64}
        stream = io.BytesIO()
        handoff.send_restoration(selector, stream)
        frame = stream.getvalue()
        target = Path(self.tmp.name) / 'unused'
        self.assertEqual(handoff.receive(io.BytesIO(frame), target), selector)
        malformed = b'{"packet":null,"packet":{}}'
        for wire in (frame[:-1], frame + b'x', handoff.RESTORE_MAGIC + handoff.LENGTH.pack(handoff.RESTORE_CAP + 1),
                     handoff.RESTORE_MAGIC + handoff.LENGTH.pack(len(malformed)) + malformed,
                     handoff.RESTORE_MAGIC + handoff.LENGTH.pack(4) + b'null'):
            with self.subTest(wire=wire), self.assertRaises(ValueError):
                handoff.receive(io.BytesIO(wire), target)
        self.assertFalse(target.exists())

    def test_tampered_archive_rejected_before_signer(self):
        (self.request / 'frontend.zip').write_bytes(b'wrong archive')
        with self.assertRaises(ValueError):
            self.admit()
        self.verify.assert_not_called()

    def test_mixed_public_rollback_pair_is_rejected_before_signer(self):
        (self.request / 'rollback.json').write_bytes(json.dumps(dict(self.rollback, frontend='release-other')).encode())
        with self.assertRaisesRegex(ValueError, 'distinct same-commit pair'):
            self.admit()
        self.verify.assert_not_called()

    def test_wrong_job_attempt_or_failed_signer_rejected(self):
        for key, value in (('run_attempt', 1), ('conclusion', 'failure')):
            job = self.jobs['jobs'][1]
            previous = job[key]
            job[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.admit()
            job[key] = previous
        self.verify.assert_not_called()

    def test_replayed_or_unverified_subject_rejected_before_extraction(self):
        with self.assertRaises(ValueError):
            self.admit(seen={(handoff.REPO_ID, 10, 2)})
        self.verify.return_value['verified_subject_sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            self.admit()
        self.intake.evaluate.assert_not_called()

    def test_new_main_while_admitting_refuses_old_candidate(self):
        def validated(*args):
            self.branch['commit']['sha'] = 'f' * 40
            return self.intake.evaluate.return_value
        self.intake.evaluate.side_effect = validated
        with self.assertRaises(ValueError):
            self.admit()
