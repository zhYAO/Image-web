import hashlib
from http.client import HTTPSConnection
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import github_pair_public as public


def public_responses(commit):
    frontend = 'release-' + commit[:12]
    response = {path: (200, 'text/html', 'no-store',
                       f'<script src="/frontend-assets/{frontend}/app.js"></script>'.encode())
                for path in public.ROUTES}
    for path, status, body in (
        ('/api/health/ready', 200, {'status': 'ok', 'version': commit}),
        ('/api/meta', 200, {'backendRelease': commit}),
        ('/version.json', 200, {'schemaVersion': 1, 'frontendRelease': frontend}),
        ('/api/auth/session', 401, {'code': 'unauthorized'}),
    ):
        response[path] = (status, 'application/json', 'no-store', json.dumps(body).encode())
    return response


class PublicPairTest(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.frontend = 'release-' + self.sha[:12]
        self.response = public_responses(self.sha)

    def test_public_pair_and_workspace_routes(self):
        report = public.verify(self.sha, fetch=self.response.__getitem__)
        self.assertEqual(report['backendRelease'], self.sha)
        self.assertEqual(report['frontendRelease'], self.frontend)
        self.assertIn('/workspace', report['routes'])

    def test_correct_markers_with_stale_workspace_shell_fail(self):
        good = self.response['/workspace']
        self.response['/workspace'] = good[:3] + (good[3].replace(self.frontend.encode(), b'release-other'),)
        with self.assertRaises(ValueError):
            public.verify(self.sha, fetch=self.response.__getitem__)
        witness = public.capture_failure(self.sha, fetch=self.response.__getitem__)
        self.assertEqual(witness['check']['path'], '/workspace')
        self.assertEqual(witness['check']['failedCheck'], 'body-contract')
        self.assertEqual(witness['check']['bodySha256'], hashlib.sha256(self.response['/workspace'][3]).hexdigest())
        public.validate_failure(witness, dict(backend=self.sha, frontend=self.frontend))

    def test_version_drift_during_public_probe_fails(self):
        def changing(path):
            reply = self.response[path]
            if path == '/workspace':
                head = '/api/meta'
                self.response[head] = self.response[head][:3] + (b'{"backendRelease":"older"}',)
            return reply
        with self.assertRaises(ValueError):
            public.verify(self.sha, fetch=changing)

    def test_public_old_pair_alone_never_proves_actual_restoration(self):
        capture = public.capture(self.response.__getitem__)
        candidate = 'b' * 40
        receipt = dict(status='opened', commit=candidate, operationId='nonprod-test',
                       rollbackPair=dict(backend=self.sha, frontend=self.frontend))
        for source in (public_responses(candidate), self.response):
            result = public.observe_after_failure(candidate, receipt, capture, source.__getitem__)
            self.assertIs(result['recoveryVerified'], False)
            self.assertEqual(result['publicRollbackObservation'] is not None, source is self.response)

    def test_failed_public_observation_requires_matching_deployment_receipt(self):
        capture = public.capture(self.response.__getitem__)
        receipt = dict(status='opened', commit='b' * 40, operationId='nonprod-test',
                       rollbackPair=dict(backend='c' * 40, frontend='release-' + 'c' * 12))
        with self.assertRaisesRegex(ValueError, 'previously measured pair'):
            public.observe_after_failure('b' * 40, receipt, capture, self.response.__getitem__)

    def test_failure_witness_records_observed_http_status_without_raw_response(self):
        path = '/api/health/ready'
        self.response[path] = (503, 'text/html', 'no-store', b'')
        witness = public.capture_failure(self.sha, fetch=self.response.__getitem__)
        self.assertEqual(witness['check'], dict(path=path, failedCheck='status', status=503, mimeMatches=False,
                                              noStore=True, bodyBytes=0, bodySha256=hashlib.sha256(b'').hexdigest()))
        pair = dict(backend=self.sha, frontend=self.frontend)
        public.validate_failure(witness, pair)
        with self.assertRaisesRegex(ValueError, 'exact published pair'):
            public.validate_failure(dict(witness, backendRelease='b' * 40), pair)
        with self.assertRaisesRegex(ValueError, 'contradicts'):
            public.validate_failure(dict(witness, check=dict(witness['check'], status=200)), pair)
        with self.assertRaisesRegex(ValueError, 'observed HTTP response'):
            public.validate_failure(dict(witness, check=dict(witness['check'], bodyBytes=1)), pair)

    def test_cache_token_must_be_exact_and_malformed_json_is_a_body_failure(self):
        path = '/api/meta'
        status, mime, _, body = self.response[path]
        self.response[path] = (status, mime, 'not-no-store', body)
        self.assertEqual(public.capture_failure(self.sha, fetch=self.response.__getitem__)['check']['failedCheck'],
                         'cache-control')
        self.response[path] = (status, mime, 'max-age=0, No-Store', b'{')
        self.assertEqual(public.capture_failure(self.sha, fetch=self.response.__getitem__)['check']['failedCheck'],
                         'body-contract')

    def test_healthy_probe_and_transport_error_do_not_generate_failure_witness(self):
        with self.assertRaisesRegex(ValueError, 'verification passed'):
            public.capture_failure(self.sha, fetch=self.response.__getitem__)

        def timeout(_):
            raise TimeoutError('No HTTPS response')

        with self.assertRaisesRegex(TimeoutError, 'No HTTPS response'):
            public.capture_failure(self.sha, fetch=timeout)

    @unittest.skipUnless(shutil.which('openssl'), 'Local HTTPS fixture requires openssl')
    def test_https_probe_captures_empty_service_unavailable_response(self):
        class Unavailable(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(503)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', '0')
                self.end_headers()

            def log_message(self, *_):
                pass

        with tempfile.TemporaryDirectory() as temp, HTTPServer(('127.0.0.1', 0), Unavailable) as server:
            cert, key = Path(temp) / 'test.pem', Path(temp) / 'test-key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
                            '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
                            '-out', cert, '-keyout', key], check=True, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10)
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(cert, key)
            server.socket = server_context.wrap_socket(server.socket, server_side=True)
            server.timeout = 3
            client_context = ssl.create_default_context(cafile=str(cert))
            def connect_local(_host, timeout):
                return HTTPSConnection('localhost', server.server_port, timeout=timeout, context=client_context)

            connect = Mock(side_effect=connect_local)
            http = SimpleNamespace(client=SimpleNamespace(HTTPSConnection=connect))
            worker = Thread(target=server.handle_request, daemon=True)
            worker.start()
            try:
                with patch.object(public, 'http', http):
                    probe = public.capture_failure(self.sha)
                connect.assert_called_once_with(public.HOST, timeout=10)
                self.assertEqual((probe['check']['path'], probe['check']['status'], probe['check']['bodyBytes']),
                                 ('/api/health/ready', 503, 0))
            finally:
                worker.join(timeout=5)
