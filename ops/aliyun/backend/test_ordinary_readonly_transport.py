from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock

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
