import importlib.util
from pathlib import Path
import unittest
import io
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backend_verify', Path(__file__).with_name('verify.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class VerifierTests(unittest.TestCase):
    def setUp(self):
        self.request = {'schemaVersion': 1, 'operationId': 'operation-1', 'backendRelease': 'a' * 40, 'pid': 101,
                        'nonce': 'b' * 64, 'createdAt': 1000, 'expiresAt': 1120}
        self.seen = []
        self.bad = None
    def fetch(self, path):
        self.seen.append(path)
        body = {'/api/health/ready': {'status': 'ok', 'version': 'a' * 40}, '/api/meta': {'schemaVersion': 1, 'backendRelease': 'a' * 40, 'api': {'major': 1, 'minor': 0}, 'capabilities': ['runtime.meta.v1']},
                '/api/auth/session': {'id': '00000000-0000-4000-8000-000000000001'},
                '/api/account': {'id': '00000000-0000-4000-8000-000000000001', 'status': 'active', 'displayName': None, 'email': 'private@example.test'},
                '/api/sessions': {'sessions': []}, '/api/credits/pricing': self.catalog()}[path]
        if path == self.bad: return 503, {}, {}
        headers = {'cache-control': 'private, no-store'}
        if path == '/api/credits/pricing': headers['x-zimage-readonly-probe'] = 'catalog-v1'
        return 200, headers, body
    def catalog(self):
        return {'version': '2026-10-12.1', 'enabled': False, 'prices': [
            {'operation': 'image', 'provider': 'seedream', 'model': 'doubao-seedream-5.0-pro',
             'resolution': '2K', 'unitMinor': 30, 'label': 'Seedream 5.0 Pro'}]}
    def test_real_readonly_suite_binds_nonce_pid_version_without_private_data(self):
        result = verifier.verify(self.request, self.fetch, now=lambda: 1001)
        self.assertEqual(self.seen, [*verifier.PATHS, '/api/meta'])
        self.assertEqual(result['requestSha256'], verifier.request_digest(self.request))
        self.assertEqual(result['nonce'], 'b' * 64)
        self.assertEqual(result['verifierProtocol'], 'zimage-backend-readonly-v2')
        self.assertIs(result['catalogReady'], True)
        self.assertNotIn('dependenciesReady', result)
        self.assertNotIn('/api/credits', self.seen)
        self.assertNotIn('/api/credits/ledger', self.seen)
        self.assertNotIn('private@example.test', str(result))
        self.assertNotIn('00000000-0000-4000-8000-000000000001', str(result))
    def test_every_readonly_route_failure_prevents_receipt(self):
        for path in verifier.PATHS:
            self.bad = path
            with self.assertRaises(RuntimeError): verifier.verify(self.request, self.fetch, now=lambda: 1001)
    def test_expired_request_and_version_mismatch_never_succeed(self):
        with self.assertRaises(ValueError): verifier.verify(self.request, self.fetch, now=lambda: 1121)
        self.request['backendRelease'] = 'c' * 40
        with self.assertRaises(RuntimeError): verifier.verify(self.request, self.fetch, now=lambda: 1001)
    def test_redirects_and_arbitrary_destinations_are_not_supported(self):
        with patch.object(verifier.urllib.request, 'build_opener') as build_opener:
            build_opener.return_value.open.side_effect = AssertionError('Blocked any unexpected network call')
            fetch = verifier.public_fetch('session=opaque')
        with self.assertRaises(ValueError): fetch('https://attacker.test/')
        with self.assertRaises(ValueError): fetch('/api/chat')
        with self.assertRaises(ValueError): fetch('/api/credits')
        with self.assertRaises(ValueError): fetch('/api/credits/ledger')

    def test_catalog_requires_strict_response_marker_even_for_a_valid_fallback_dto(self):
        for marker in [None, '', 'catalog-v0', 'catalog-v1, catalog-v1']:
            def unmarked(path):
                status, headers, body = self.fetch(path)
                if path == '/api/credits/pricing':
                    headers.pop('x-zimage-readonly-probe')
                    if marker is not None: headers['x-zimage-readonly-probe'] = marker
                return status, headers, body
            with self.subTest(marker=marker), self.assertRaises(RuntimeError):
                verifier.verify(self.request, unmarked, now=lambda: 1001)

    def test_fixed_get_transport_marks_only_catalog_and_never_contacts_wallet_routes(self):
        seen = []
        class Response:
            status, headers = 200, {'Cache-Control': 'no-store', 'X-Zimage-Readonly-Probe': 'catalog-v1'}
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, limit): return b'{}'
        class Opener:
            def open(self, request, timeout):
                seen.append(request)
                self.timeout = timeout
                return Response()
        with patch.object(verifier.urllib.request, 'build_opener', return_value=Opener()):
            fetch = verifier.public_fetch('session=private-cookie-value')
        for path in verifier.PATHS: fetch(path)
        for path in ['/api/credits', '/api/credits/ledger']:
            with self.assertRaises(ValueError): fetch(path)
        self.assertEqual([request.full_url for request in seen], [verifier.ORIGIN + path for path in verifier.PATHS])
        for request, path in zip(seen, verifier.PATHS):
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.data)
            self.assertEqual(request.get_header('X-zimage-readonly-probe'), 'catalog-v1' if path == '/api/credits/pricing' else None)
    def test_private_public_cache_and_account_switch_are_rejected(self):
        def cached(path):
            status, _, body = self.fetch(path)
            return status, {'cache-control': 'public, max-age=60'}, body
        with self.assertRaises(RuntimeError): verifier.verify(self.request, cached, now=lambda: 1001)
        def changed(path):
            status, headers, body = self.fetch(path)
            if path == '/api/account': body['id'] = 'other-account'
            return status, headers, body
        with self.assertRaises(RuntimeError): verifier.verify(self.request, changed, now=lambda: 1001)

    def test_malformed_success_dtos_never_mint_a_receipt(self):
        for path, body in [('/api/auth/session', {'id': '-' * 36}), ('/api/account', {'id': '00000000-0000-4000-8000-000000000001', 'status': 'active'}),
                           ('/api/meta', {'schemaVersion': 1, 'backendRelease': 'a' * 40}), ('/api/sessions', {}), ('/api/credits/pricing', {}),
                           ('/api/meta', {'schemaVersion': True, 'backendRelease': 'a' * 40, 'api': {'major': 1, 'minor': 0}, 'capabilities': []}),
                           ('/api/meta', {'schemaVersion': 1, 'backendRelease': 'a' * 40, 'api': {'major': True, 'minor': 0}, 'capabilities': []}),
                           ('/api/credits/pricing', {'availableMinor': True, 'frozenMinor': -1, 'spentMinor': 2**60})]:
            def malformed(route): return (200, {'cache-control': 'no-store'}, body) if route == path else self.fetch(route)
            with self.subTest(path=path):
                with self.assertRaises(RuntimeError): verifier.verify(self.request, malformed, now=lambda: 1001)

    def test_catalog_dto_matches_strict_domain_price_types_without_coercion(self):
        catalog = self.catalog()
        self.assertTrue(verifier.validate_body('/api/credits/pricing', catalog))
        self.assertTrue(verifier.validate_body('/api/credits/pricing', dict(catalog, prices=[])))
        for field, value in [('version', None), ('enabled', 0), ('prices', {}), ('extra', True)]:
            with self.subTest(field=field):
                self.assertFalse(verifier.validate_body('/api/credits/pricing', dict(catalog, **{field: value})))
        for field, value in [('operation', 'wallet'), ('provider', ''), ('model', ''), ('resolution', None),
                             ('unitMinor', True), ('unitMinor', 0), ('unitMinor', -1), ('unitMinor', 1.5),
                             ('unitMinor', 2**53), ('label', None), ('count', 1)]:
            price = dict(catalog['prices'][0], **{field: value})
            with self.subTest(field=field, value=value):
                self.assertFalse(verifier.validate_body('/api/credits/pricing', dict(catalog, prices=[price])))
        for field in catalog['prices'][0]:
            price = dict(catalog['prices'][0]); del price[field]
            with self.subTest(missing=field):
                self.assertFalse(verifier.validate_body('/api/credits/pricing', dict(catalog, prices=[price])))
        def malformed(path):
            status, headers, body = self.fetch(path)
            if path == '/api/credits/pricing': body['prices'][0]['unitMinor'] = True
            return status, headers, body
        with self.assertRaises(RuntimeError): verifier.verify(self.request, malformed, now=lambda: 1001)

    def test_stdio_reuses_one_fetch_session_across_candidate_and_recovery_nonces(self):
        recovery = dict(self.request, nonce='c' * 64, pid=102)
        source = io.StringIO(json.dumps(self.request) + '\n' + json.dumps(recovery) + '\n')
        output = io.StringIO()
        verifier.serve(source, output, self.fetch, now=lambda: 1001)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(lines[0], {'schemaVersion': 1, 'ready': True})
        self.assertEqual([line['nonce'] for line in lines[1:]], ['b' * 64, 'c' * 64])
        self.assertEqual(self.seen, [*verifier.PATHS, '/api/meta'] * 2)
        self.assertNotIn('private@example.test', output.getvalue())

    def test_stdio_failure_is_redacted_and_next_nonce_can_still_be_verified(self):
        source = io.StringIO('{}\n' + json.dumps(self.request) + '\n')
        output = io.StringIO()
        verifier.serve(source, output, self.fetch, now=lambda: 1001)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(lines[1], {'schemaVersion': 1, 'verificationFailed': True})
        self.assertEqual(lines[2]['nonce'], self.request['nonce'])

    def test_stdio_rejects_oversized_or_partial_input(self):
        for payload in ['x' * 4097 + '\n', json.dumps(self.request)]:
            output = io.StringIO()
            verifier.serve(io.StringIO(payload), output, self.fetch, now=lambda: 1001)
            self.assertEqual(json.loads(output.getvalue().splitlines()[-1]), {'schemaVersion': 1, 'verificationFailed': True})


if __name__ == '__main__': unittest.main()
