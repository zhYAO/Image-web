"""Exercise the real TLS handshake while replacing only the TCP destination port."""
import http.server
import importlib.util
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULES = (load('release_tls_helper', 'release.py'), load('release_tls_routes', 'verify-release.py'))
SHA = 'a' * 40
ORIGIN = 'https://www.zimage.store'


class LocalIngressTLS(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        cls.certificates = {}
        for hostname in ('www.zimage.store', 'wrong.invalid'):
            cert = Path(cls.directory.name) / (hostname + '.crt')
            key = Path(cls.directory.name) / (hostname + '.key')
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-days', '1', '-subj', '/CN=' + hostname,
                            '-addext', 'subjectAltName=DNS:' + hostname,
                            '-keyout', str(key), '-out', str(cert)],
                           capture_output=True, check=True, timeout=10)
            cls.certificates[hostname] = (cert, key)

    def start_server(self, hostname='www.zimage.store'):
        self.requests = []
        self.sni = []
        self.auth_code = 'unauthorized'
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def respond(self):
                self.rfile.read(int(self.headers.get('Content-Length', '0')))
                owner.requests.append((self.path, dict(self.headers)))
                status = 200
                if self.path == '/api/health/ready':
                    body = json.dumps({'version': SHA}).encode()
                elif self.path in ('/api/account', '/api/auth/session'):
                    status = 401
                    body = json.dumps({'code': owner.auth_code}).encode()
                elif self.command == 'POST':
                    status, body = 410, b'{"code":"gone"}'
                elif self.path == '/create/batch':
                    status, body = 404, b'{}'
                elif self.path == '/login':
                    body = b'<link href="/_next/static/fixture.css">'
                else:
                    body = b'fixture'
                self.send_response(status)
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)

            do_GET = respond
            do_POST = respond

            def log_message(self, *_):
                pass

        cert, key = self.certificates[hostname]
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        context.set_servername_callback(lambda sock, name, ctx: self.sni.append(name))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        server.socket = context.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addresses = []
        original = socket.create_connection

        def connect(address, *args, **kwargs):
            self.addresses.append(address)
            if address != ('127.0.0.1', 443):
                raise OSError('public DNS unavailable in server test context')
            return original(('127.0.0.1', server.server_port), *args, **kwargs)

        return connect, ssl.create_default_context(cafile=str(cert))

    def invoke(self, module):
        if module.__name__ == 'release_tls_helper':
            module.verify(ORIGIN, SHA)
        else:
            module.verify(ORIGIN, SHA, timeout=1)

    def test_server_checks_use_loopback_tls_with_correct_host_sni_and_no_credentials(self):
        connect, context = self.start_server()
        env = {'HTTPS_PROXY': 'http://unused.invalid:9999', 'https_proxy': 'http://unused.invalid:9999'}
        for module in MODULES:
            with self.subTest(module=module.__name__), patch.object(socket, 'create_connection', connect), patch.object(ssl, 'create_default_context', return_value=context), patch.dict(os.environ, env):
                try:
                    self.invoke(module)
                except Exception as error:
                    self.fail('Local TLS must not depend on public DNS or proxy: ' + type(error).__name__)
        self.assertEqual(set(self.addresses), {('127.0.0.1', 443)})
        self.assertEqual(set(self.sni), {'www.zimage.store'})
        for _, headers in self.requests:
            self.assertEqual(headers['Host'], 'www.zimage.store')
            self.assertFalse({k.lower() for k in headers} & {'authorization', 'cookie', 'apikey'})

    def test_local_tls_rejects_a_trusted_certificate_for_the_wrong_hostname(self):
        connect, context = self.start_server('wrong.invalid')
        for module in MODULES:
            with self.subTest(module=module.__name__), patch.object(socket, 'create_connection', connect), patch.object(ssl, 'create_default_context', return_value=context):
                with self.assertRaises(Exception):
                    self.invoke(module)
        self.assertEqual(set(self.addresses), {('127.0.0.1', 443)})
        self.assertEqual(self.requests, [])

    def test_local_tls_rejects_an_untrusted_certificate(self):
        connect, _ = self.start_server()
        for module in MODULES:
            with self.subTest(module=module.__name__), patch.object(socket, 'create_connection', connect):
                with self.assertRaises(Exception):
                    self.invoke(module)
        self.assertEqual(set(self.addresses), {('127.0.0.1', 443)})
        self.assertEqual(self.requests, [])

    def test_external_mode_keeps_normal_public_resolution_instead_of_pinning_loopback(self):
        module = MODULES[1]
        attempts = []

        def connect(address, *args, **kwargs):
            attempts.append(address)
            raise OSError('no external request is allowed in this test')

        with patch.object(socket, 'create_connection', connect), patch.dict(os.environ, {'HTTPS_PROXY': '', 'https_proxy': ''}):
            try:
                module.verify(ORIGIN, SHA, timeout=1, public_only=True)
            except TypeError:
                self.fail('The external verification mode is missing')
            except RuntimeError:
                pass
        self.assertEqual(attempts, [('www.zimage.store', 443)])

    def test_root_helper_rejects_arbitrary_401_json(self):
        connect, context = self.start_server()
        self.auth_code = 'network'
        with patch.object(socket, 'create_connection', connect), patch.object(ssl, 'create_default_context', return_value=context):
            with self.assertRaisesRegex(RuntimeError, 'requires unauthorized error'):
                MODULES[0].verify(ORIGIN, SHA)
