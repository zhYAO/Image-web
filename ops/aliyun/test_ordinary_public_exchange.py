from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest

import github_pair_handoff as handoff
import github_pair_public as public
import ordinary_public_exchange as wire


OLD = 'a' * 40
NEW = 'b' * 40


def batch(old=OLD, new=NEW):
    return dict(commit=new, runId=10, attempt=2, packetSha256='c' * 64, rootApprovalSha256='d' * 64,
                rollbackPair=dict(backend=old, frontend='release-' + old[:12]))


def responses(commit):
    frontend = 'release-' + commit[:12]
    records = {'/api/health/ready': dict(status='ok', version=commit), '/api/meta': dict(backendRelease=commit),
               '/version.json': dict(schemaVersion=1, frontendRelease=frontend),
               '/api/auth/session': dict(code='unauthorized')}

    def fetch(path):
        status, mime = public.CONTRACTS[path]
        body = (wire.encode(records[path]) if path in records else f'/frontend-assets/{frontend}/'.encode())
        return status, mime, 'no-store', body

    return fetch


def connection(phase, make_reply, verify, *, release_batch=None, limit=120):
    receiver, observer = socket.socketpair()
    with receiver, observer, ThreadPoolExecutor(max_workers=1) as workers:
        deadline = time.monotonic() + limit
        recv = wire.Frames(receiver.fileno(), receiver.fileno(), deadline=deadline)
        send = wire.Frames(observer.fileno(), observer.fileno(), deadline=deadline)
        result = workers.submit(wire.receive_observation, recv, batch=release_batch or batch(), phase=phase, verify=verify)
        try:
            challenge = send.read(wire.MAX_SUBJECT)
            send.write(make_reply(challenge, deadline), wire.MAX_REPLY)
        finally:
            observer.shutdown(socket.SHUT_WR)
        return result.result()


@unittest.skipIf(os.name != 'posix', 'SSH descriptor rehearsal requires POSIX')
class WireTests(unittest.TestCase):
    def setUp(self):
        self.verified = []

    def attest(self, subject, bundle):
        self.assertEqual(bundle, b'fixture-only')
        self.verified.append(wire.decode(subject))

    def response(self, challenge, _, *, commit):
        return wire.reply(wire.observe(challenge, fetch=responses(commit)), b'fixture-only')

    def test_observer_checks_candidate_and_targeted_restoration_separately(self):
        for phase, commit in [('candidate', NEW), ('restored', OLD)]:
            result = connection(phase, lambda *args: self.response(*args, commit=commit), self.attest)
            self.assertEqual(result['backendRelease'], commit)
        self.assertNotEqual(*(entry['challenge']['nonce'] for entry in self.verified))

    def test_initial_contract_failure_cannot_be_reused_as_restored(self):
        failure = connection('candidate', lambda *args: self.response(*args, commit=OLD), self.attest)
        self.assertEqual(failure['check']['path'], '/api/health/ready')

        def replay(challenge, _):
            record = dict(self.verified[0], challenge=challenge)
            return wire.reply(record, b'fixture-only')

        with self.assertRaisesRegex(ValueError, 'Restored pair must pass'):
            connection('restored', replay, self.attest)

    def test_replay_and_cross_batch_response_refused_before_signature(self):
        connection('candidate', lambda *args: self.response(*args, commit=NEW), self.attest)
        recorded = self.verified[0]
        for key, value in [('nonce', recorded['challenge']['nonce']), ('attempt', 3),
                           ('rootApprovalSha256', 'f' * 64), ('packetSha256', 'e' * 64), ('phase', 'restored')]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'exact observer challenge'):
                def mismatched(challenge, _):
                    subject = wire.observe(challenge, fetch=responses(NEW))
                    subject['challenge'] = dict(challenge, **{key: value})
                    return wire.reply(subject, b'fixture-only')
                connection('candidate', mismatched, self.attest)
        self.assertEqual(len(self.verified), 1)

    def test_invalid_signature_and_unobserved_transport_error_are_hard_failures(self):
        def refuse(*_):
            raise ValueError('untrusted certificate')

        def unreachable(_):
            raise TimeoutError('HTTPS transport timeout')

        with self.assertRaisesRegex(ValueError, 'untrusted certificate'):
            connection('candidate', lambda *args: self.response(*args, commit=NEW), refuse)
        with self.assertRaises(TimeoutError):
            connection('candidate', lambda ch, _: wire.observe(ch, fetch=unreachable), self.attest)

    def test_frame_read_and_write_timeout(self):
        peer, receiver = socket.socketpair()
        with peer, receiver:
            frames = wire.Frames(receiver.fileno(), receiver.fileno(), deadline=time.monotonic() + 0.02)
            with self.assertRaisesRegex(ValueError, 'timed out'):
                frames.read(wire.MAX_REPLY)
            frames.deadline = time.monotonic() + 0.02
            with self.assertRaisesRegex(ValueError, 'timed out'):
                frames.write('c' * 1_000_000, 2_000_000)


def fixture_selector():
    packet = dict(repository=handoff.REPO, workflow=handoff.WORKFLOW, commit=NEW, runId=10, attempt=2,
                  backendManifestSha256='e' * 64, frontendSubjectSha256='f' * 64)
    return dict(packet=packet, approvalSha256=batch()['rootApprovalSha256'])


def fixed_stdio_fixture(state):
    """Exercise the fixed command's v5 wire reader without installing a receiver."""
    if os.environ.get('SSH_ORIGINAL_COMMAND') != handoff.COMMAND:
        raise ValueError('Exact fixed command required')
    frames = wire.Frames(0, 1, deadline=time.monotonic() + 116)
    with tempfile.TemporaryDirectory() as scratch:
        selector = handoff.receive(SimpleNamespace(read=frames.read_bytes), Path(scratch), interactive=True)
    if selector != fixture_selector():
        raise ValueError('Fixture submission differs from the reviewed selector')
    commit = os.environ['GITHUB_SHA']
    gh = Path(shutil.which('gh')).resolve()

    def verify(subject, bundle):
        policy = dict(gh=gh, roots=state / 'roots.jsonl', signer_sha=commit, source_sha=commit,
                      source_ref=os.environ['GITHUB_REF'], run=int(os.environ['GITHUB_RUN_ID']),
                      attempt=int(os.environ['GITHUB_RUN_ATTEMPT']))
        wire.verify_github(subject, bundle, **policy)
        for bad in (dict(run=policy['run'] + 1), dict(attempt=policy['attempt'] + 1), dict(signer_sha='f' * 40)):
            try:
                wire.verify_github(subject, bundle, **(policy | bad))
            except ValueError:
                continue
            raise AssertionError('Unexpected GitHub workflow identity accepted')

    fixture_batch = dict(batch(), packetSha256=hashlib.sha256(wire.encode(selector['packet']) + b'\n').hexdigest())
    result = wire.receive_observation(frames, batch=fixture_batch, phase='restored', verify=verify)
    frames.write(dict(rehearsal=True, observationSha256=hashlib.sha256(wire.encode(result)).hexdigest()), wire.MAX_SUBJECT)


def hosted(state):
    """Exercise actual GitHub signing over the private fixed-command stdio fixture."""
    argv = [sys.executable, '-B', __file__, '--fixed-stdio-fixture', str(state)]
    with subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0,
                          env=dict(os.environ, SSH_ORIGINAL_COMMAND=handoff.COMMAND)) as peer:
        deadline = time.monotonic() + 116
        try:
            handoff.send_restoration(fixture_selector(), peer.stdin, interactive=True)
            frames = wire.Frames(peer.stdout.fileno(), peer.stdin.fileno(), deadline=deadline)
            challenge = frames.read(wire.MAX_SUBJECT)
            if challenge['phase'] != 'restored':
                raise ValueError('Fixture observer expected a restoration challenge')
            subject = wire.observe(challenge, fetch=responses(OLD))
            (state / 'observation.tmp').write_bytes(wire.encode(subject))
            (state / 'observation.tmp').rename(state / 'observation.json')
            bundle_path = state / 'bundle.jsonl'
            while not bundle_path.exists():
                if time.monotonic() >= deadline or peer.poll() is not None:
                    raise TimeoutError('Hosted observer did not sign the fixture observation')
                time.sleep(0.1)
            with bundle_path.open('rb') as bundle:
                frames.write(wire.reply(subject, bundle.read(wire.MAX_BUNDLE + 1)), wire.MAX_REPLY)
            result = frames.read(wire.MAX_SUBJECT)
            digest = hashlib.sha256(wire.encode(subject['public'])).hexdigest()
            if result != dict(rehearsal=True, observationSha256=digest) or peer.wait(timeout=5):
                raise ValueError('Fixed stdio peer returned an unexpected fixture result')
        finally:
            if peer.poll() is None:
                peer.kill()
    (state / 'passed').write_text(digest, encoding='ascii')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--hosted':
        hosted(Path(sys.argv[2]).resolve())
    elif len(sys.argv) == 3 and sys.argv[1] == '--fixed-stdio-fixture':
        fixed_stdio_fixture(Path(sys.argv[2]).resolve())
    else:
        unittest.main()
