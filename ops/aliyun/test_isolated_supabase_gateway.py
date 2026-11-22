from contextlib import closing
import importlib.util
from http.client import HTTPConnection, HTTPSConnection
from pathlib import Path
from threading import Thread
import ssl
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('isolated-supabase-gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class Access(unittest.TestCase):
    def setup_gateway(self, peer='127.0.0.1'):
        server = gateway.Server(('127.0.0.1', 0), peer)
        self.addCleanup(server.server_close)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        return server.server_port

    def request(self, port, method, target, **kwargs):
        conn = HTTPConnection('127.0.0.1', port, timeout=2)
        try:
            conn.request(method, target, **kwargs)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_real_listener_rejects_foreign_paths_protocol_and_source(self):
        port = self.setup_gateway()
        wrong_peer = self.setup_gateway('172.20.0.2')
        with patch.object(gateway, 'HTTPConnection') as upstream:
            for method, target in (
                ('GET', 'http://169.254.169.254/latest/meta-data'),
                ('GET', '//127.0.0.1:2375/version'), ('GET', '/var/run/docker.sock'),
                ('GET', '/api/v3'), ('POST', '/auth/v1/admin/users'),
                ('POST', '/auth/v1/token?grant_type=password&grant_type=refresh_token'),
                ('GET', '/auth/v1/%75ser'), ('CONNECT', '127.0.0.1:2375'),
            ):
                self.assertEqual(self.request(port, method, target)[0], 403)
            self.assertEqual(self.request(wrong_peer, 'GET', '/auth/v1/user')[0], 403)
            upstream.assert_not_called()

    def test_uses_fixed_ip_and_port_and_discards_forwarding_headers(self):
        port = self.setup_gateway()
        with patch.object(gateway, 'HTTPConnection') as connect:
            response = connect.return_value.getresponse.return_value
            response.status = 200
            response.read.return_value = b'{}'
            response.getheader.return_value = 'application/json'
            status, body = self.request(port, 'POST', '/auth/v1/token?grant_type=password',
                                        body=b'{}', headers={'Host': '169.254.169.254',
                                                             'X-Forwarded-Host': 'external.invalid',
                                                             'apikey': 'sb_publishable_fake'})
            self.assertEqual((status, body), (200, b'{}'))
            connect.assert_called_once_with('127.0.0.1', 54321, timeout=5)
            forwarded = connect.return_value.request.call_args.kwargs['headers']
            self.assertEqual(forwarded, {'Accept-Encoding': 'identity', 'apikey': 'sb_publishable_fake'})

    def test_ephemeral_ca_and_exact_ip_san_on_real_tls_listener(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        certs = Path(td.name) / 'tls'
        subprocess.run(['bash', str(Path(__file__).with_name('prepare-isolated-gateway-tls.sh')),
                        str(certs), '127.0.0.1'], check=True)
        self.assertFalse((certs/'ca.key').exists())
        server = gateway.Server(('127.0.0.1', 0), '127.0.0.1')
        server.tls = gateway.tls_context(certs/'gateway.pem', certs/'gateway.key')
        self.addCleanup(server.server_close)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        with closing(HTTPSConnection('127.0.0.1', server.server_port, timeout=2,
                             context=ssl.create_default_context(cafile=str(certs/'ca.pem')))) as client:
            client.request('GET', '/auth/v1/admin/users')
            self.assertEqual(client.getresponse().status, 403)
        with closing(HTTPSConnection('localhost', server.server_port, timeout=2,
                             context=ssl.create_default_context(cafile=str(certs/'ca.pem')))) as client:
            with self.assertRaises(ssl.SSLCertVerificationError):
                client.request('GET', '/auth/v1/user')

    def test_query_contract(self):
        route = '/rest/v1/account_profiles'
        self.assertTrue(gateway.allowed('GET', route + '?select=display_name%2Cstatus&user_id=eq.00000000-0000-4000-8000-000000000000'))
        self.assertFalse(gateway.allowed('GET', route + '?select=%2A&user_id=eq.00000000-0000-4000-8000-000000000000'))
        self.assertFalse(gateway.allowed('GET', '/auth/v1/user?redirect_to=https%3A%2F%2Fexternal.invalid'))
