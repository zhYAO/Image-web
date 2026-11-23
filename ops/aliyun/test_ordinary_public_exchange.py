from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import shutil
import socket
import sys
import time
import unittest

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


def hosted(state):
    """Exercise actual GitHub signing with a fixture batch and responses."""
    commit = os.environ['GITHUB_SHA']
    gh = Path(shutil.which('gh')).resolve()

    def make_reply(challenge, deadline):
        subject = wire.observe(challenge, fetch=responses(OLD))
        with (state / 'observation.tmp').open('xb') as output:
            output.write(wire.encode(subject))
        (state / 'observation.tmp').rename(state / 'observation.json')
        while time.monotonic() < deadline:
            if (state / 'bundle.jsonl').exists():
                return wire.reply(subject, (state / 'bundle.jsonl').read_bytes())
            time.sleep(0.1)
        raise TimeoutError('Hosted observer did not sign the public observation')

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

    result = connection('restored', make_reply, verify, limit=116)
    if result['backendRelease'] != OLD:
        raise ValueError('Fixture restored pair differs')
    (state / 'passed').write_text(hashlib.sha256(wire.encode(result)).hexdigest(), encoding='ascii')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--hosted':
        hosted(Path(sys.argv[2]).resolve())
    else:
        unittest.main()
