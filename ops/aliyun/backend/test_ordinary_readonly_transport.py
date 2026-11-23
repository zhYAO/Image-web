import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import ordinary_readonly_transport as transport
import receipt
import test_verify as fixture


@unittest.skipUnless(shutil.which('openssl'), 'Requires a native OpenSSL test fixture')
class ObserverTransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory(prefix='zimage-observer-tls-fixture-')
        cls.addClassCleanup(temporary.cleanup)
        cls.directory = Path(temporary.name)
        for identity in ('localhost', 'publisher'):
            subprocess.run(['openssl', 'req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-x509',
                            '-nodes', '-sha256', '-days', '1', '-subj', '/CN=' + identity,
                            '-addext', 'subjectAltName=DNS:' + identity,
                            '-keyout', cls.directory / (identity + '.key'), '-out', cls.directory / (identity + '.pem')],
                           check=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def cert(self, name):
        return self.directory / (name + '.pem')

    def key(self, name):
        return self.directory / (name + '.key')

    def pin(self, name):
        return hashlib.sha256(ssl.PEM_cert_to_DER_cert(self.cert(name).read_text())).hexdigest()

    def setUp(self):
        verified = fixture.VerifierTests()
        verified.setUp()
        operation = 'zimage-release-12-2'
        self.challenge = dict(schemaVersion=1, kind=transport.CHALLENGE, operationId=operation,
                              packetSha256='a' * 64, process=dict(pid=101, startTicks=31,
                              bootId='00000000-0000-4000-8000-000000000001'),
                              request=dict(verified.request, operationId=operation))
        self.verify = Mock(side_effect=lambda challenge: fixture.verifier.verify_ordinary(challenge, verified.fetch, now=lambda: 1001))

    def round_trip(self, *, client_pin, server_pin, challenge):
        with socket.socket() as listener, ThreadPoolExecutor(max_workers=1) as worker:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            listener.settimeout(4)
            port = listener.getsockname()[1]
            server = transport.tls_context(self.cert('publisher'), self.cert('localhost'), self.key('localhost'), server=True)
            client = transport.client(dict(schemaVersion=1, address='127.0.0.1', port=port, serverName='localhost',
                                           peerSha256=server_pin), ca=self.cert('localhost'),
                                      cert=self.cert('publisher'), key=self.key('publisher'))
            deadline = time.monotonic() + 4

            def observe():
                raw, _ = listener.accept()
                with raw:
                    transport.serve_one(raw, context=server, peer=client_pin, verify=self.verify, deadline=deadline)

            future = worker.submit(observe)
            result, observer_error = None, None
            try:
                result = client(challenge, deadline=deadline)
            except (OSError, ValueError) as error:
                result = error
            try:
                future.result(timeout=5)
            except (OSError, ValueError) as error:
                observer_error = error
            return result, observer_error

    def test_native_tls_only_returns_redacted_receipt_for_exact_challenge(self):
        result, error = self.round_trip(client_pin=self.pin('publisher'), server_pin=self.pin('localhost'),
                                        challenge=self.challenge)
        self.assertIsNone(error)
        self.verify.assert_called_once_with(self.challenge)
        request = self.challenge['request']
        self.assertEqual(result['process'], self.challenge['process'])
        receipt.validate_receipt(result['receipt'], request, operation=request['operationId'],
                                 release=request['backendRelease'], pid=request['pid'], now=1001)
        self.assertNotIn('private@example.test', str(result))

    def test_wrong_pins_and_foreign_frames_are_rejected_before_probe(self):
        publisher, observer = self.pin('publisher'), self.pin('localhost')
        for client, server, challenge in ((publisher, '0' * 64, self.challenge),
                                           ('0' * 64, observer, self.challenge),
                                           (publisher, observer, dict(self.challenge, kind='foreign')),
                                           (publisher, observer, dict(self.challenge, extra='a' * 4096))):
            with self.subTest(case=(client == publisher, server == observer, challenge.get('kind'))):
                result, error = self.round_trip(client_pin=client, server_pin=server, challenge=challenge)
                self.assertIsInstance(result, (OSError, ValueError))
                self.assertIsInstance(error, (OSError, ValueError))
        self.verify.assert_not_called()

    def test_scoped_github_read_over_mutual_tls(self):
        with patch.object(sys, 'path', [str(Path(__file__).resolve().parents[1] / 'paired'), *sys.path]):
            import ordinary_github as github
            import ordinary_github_relay as relay

        path = github.BASE + '/branches/main'
        record = dict(name='main', protected=True, commit={'sha': 'd' * 40})
        upstream = Mock()
        response = upstream.return_value.getresponse.return_value
        response.status = 200
        response.getheader.side_effect = lambda _, default: default
        response.read.return_value = json.dumps(record).encode()
        github_get = github.read_only('non-production-only', connect=upstream)
        with socket.socket() as listener, ThreadPoolExecutor(max_workers=1) as worker:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            listener.settimeout(4)
            server = transport.tls_context(self.cert('publisher'), self.cert('localhost'), self.key('localhost'), server=True)
            client = relay.client(dict(schemaVersion=1, address='127.0.0.1', port=listener.getsockname()[1],
                                       serverName='localhost', peerSha256=self.pin('localhost')),
                                  ca=self.cert('localhost'), cert=self.cert('publisher'), key=self.key('publisher'))
            with self.assertRaises(ValueError):
                client(github.BASE + '/actions/secrets')
            upstream.assert_not_called()

            def observe():
                raw, _ = listener.accept()
                with raw:
                    relay.serve_one(raw, context=server, peer=self.pin('publisher'), get=github_get,
                                    deadline=time.monotonic() + 4)

            future = worker.submit(observe)
            self.assertEqual(client(path), record)
            future.result(timeout=5)
        self.assertEqual(upstream.call_args.args, ('api.github.com',))
        self.assertEqual(upstream.return_value.request.call_args.args, ('GET', path))

    def test_github_relay_refuses_foreign_hosts_headers_and_query_paths(self):
        with patch.object(sys, 'path', [str(Path(__file__).resolve().parents[1] / 'paired'), *sys.path]):
            import ordinary_github_relay as relay

        get = Mock()
        expected = dict(kind=relay.QUERY, path='/repos/zhYAO/Image-web/branches/main', nonce='a' * 32)
        for query in (dict(expected, path='https://api.github.com' + expected['path']),
                      dict(expected, path=expected['path'] + '?ref=other'),
                      dict(expected, path='/repos/zhYAO/Image-web/actions/secrets'),
                      dict(expected, authorization='not-accepted'), dict(expected, kind='CONNECT'),
                      dict(expected, nonce='a' * 31)):
            with self.subTest(query=query), self.assertRaises(ValueError):
                relay.answer(query, get)
        get.assert_not_called()

    def test_github_probe_requires_rule_history_and_exact_workflow_bytes(self):
        with patch.object(sys, 'path', [str(Path(__file__).resolve().parents[1] / 'paired'), *sys.path]):
            import ordinary_github as gh
            import ordinary_github_relay as relay

        head, run_id, check_id, suite_id = 'a' * 40, 25, 26, 27
        workflow = b'name: fixture\n'
        effective = [dict(type=name, ruleset_id=gh.RULESET_ID) for name in ('pull_request', 'deletion', 'non_fast_forward')]
        effective.append(dict(type='required_status_checks', ruleset_id=gh.RULESET_ID,
                         parameters=dict(strict_required_status_checks_policy=True,
                                         required_status_checks=[dict(context=gh.CHECK_NAME, integration_id=gh.CHECK_APP_ID)])))
        records = {
            '/branches/main': dict(name='main', protected=True, commit={'sha': 'b' * 40}),
            f'/commits/{head}{gh.CHECK_QUERY}': dict(total_count=1, check_runs=[dict(id=check_id, name=gh.CHECK_NAME,
                app={'id': gh.CHECK_APP_ID}, head_sha=head, status='completed', conclusion='success', check_suite={'id': suite_id})]),
            f'/actions/runs/{run_id}': dict(id=run_id, path=gh.CHECK_WORKFLOW, head_sha=head, event='pull_request',
                repository={'id': gh.REPO_ID}, status='completed', conclusion='success', check_suite_id=suite_id, run_attempt=1),
            f'/actions/runs/{run_id}/attempts/1/jobs?per_page=100': dict(total_count=1, jobs=[dict(name=gh.CHECK_NAME,
                run_id=run_id, run_attempt=1, head_sha=head, status='completed', conclusion='success',
                check_run_url=f'https://api.github.com{gh.BASE}/check-runs/{check_id}')]),
            f'/rulesets/{gh.RULESET_ID}': dict(id=gh.RULESET_ID, target='branch', enforcement='active', bypass_actors=[]),
            '/rules/branches/main': effective,
            gh.SUITES: [],
            f'/contents/{gh.CHECK_WORKFLOW}?ref={head}': dict(type='file', path=gh.CHECK_WORKFLOW,
                encoding='base64', size=len(workflow), content=base64.b64encode(workflow).decode()),
        }

        def get(path):
            self.assertTrue(gh.safe_path(path))
            return records[path.removeprefix(gh.BASE)]

        result = relay.probe(get, head=head, run_id=run_id)
        self.assertEqual(result['checkWorkflowSha256'], hashlib.sha256(workflow).hexdigest())
        self.assertEqual(result['mainRuleSuiteCount'], 0)
        self.assertIs(result['releaseAuthority'], False)
        records[gh.SUITES] = [dict(ref='refs/heads/unrelated')]
        with self.assertRaises(ValueError):
            relay.probe(get, head=head, run_id=run_id)

    def test_github_observer_reads_rotated_local_credential_per_allowed_lookup(self):
        with patch.object(sys, 'path', [str(Path(__file__).resolve().parents[1] / 'paired'), *sys.path]):
            import ordinary_github_relay as relay

        token = Path('observer-local-fixture') / 'github.token'
        path = '/repos/zhYAO/Image-web/branches/main'
        first, second = Mock(return_value={'generation': 1}), Mock(return_value={'generation': 2})
        get = relay.observer_reader(token)
        with patch.object(relay, 'read_private', side_effect=[b'fixture-first\n', b'fixture-second\n',
                          FileNotFoundError]) as local, patch.object(relay.github, 'read_only', side_effect=[first, second]) as upstream:
            with self.assertRaises(ValueError):
                get('/repos/zhYAO/Image-web/actions/secrets')
            local.assert_not_called()
            self.assertEqual(get(path), {'generation': 1})
            self.assertEqual(get(path), {'generation': 2})
            with self.assertRaises(FileNotFoundError):
                get(path)
        self.assertEqual(local.call_count, 3)
        self.assertEqual([call.args for call in upstream.call_args_list], [('fixture-first',), ('fixture-second',)])
        first.assert_called_once_with(path)
        second.assert_called_once_with(path)

    @unittest.skipUnless(os.name == 'posix', 'Requires the POSIX private credential reader')
    def test_private_token_rotation_uses_current_inode_and_refuses_broader_mode(self):
        with patch.object(sys, 'path', [str(Path(__file__).resolve().parents[1] / 'paired'), *sys.path]):
            import ordinary_github_relay as relay

        with tempfile.TemporaryDirectory(prefix='github-observer-identity-fixture-') as temp:
            token, pending = Path(temp) / 'github.token', Path(temp) / 'next-token'

            def replace(body, mode):
                pending.write_bytes(body)
                pending.chmod(mode)
                pending.replace(token)

            path = '/repos/zhYAO/Image-web/branches/main'
            get = relay.observer_reader(token)
            with patch.object(relay.github, 'read_only', return_value=lambda _: {'read': True}) as api:
                replace(b'fixture-first\n', 0o600)
                self.assertEqual(get(path), {'read': True})
                replace(b'fixture-second\n', 0o600)
                self.assertEqual(get(path), {'read': True})
                replace(b'fixture-third\n', 0o640)
                with self.assertRaisesRegex(ValueError, 'Private observer file required'):
                    get(path)
            self.assertEqual([call.args for call in api.call_args_list], [('fixture-first',), ('fixture-second',)])
