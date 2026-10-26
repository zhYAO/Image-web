import http.server
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import unittest
import uuid


SCRIPT = pathlib.Path(__file__).with_name('verify-release.py')
SHA = 'a' * 40
BATCH_ID = '00000000-0000-4000-8000-000000000003'
EXPECTED = {
    ('GET', '/api/health/ready'): 200,
    ('POST', '/api/creative-batches'): 410,
    ('POST', f'/api/creative-batches/{BATCH_ID}'): 410,
    ('POST', '/api/internal/creative-batch-worker'): 410,
    ('GET', '/create/batch'): 404,
    ('GET', '/api/account'): 401,
    ('GET', '/api/auth/session'): 401,
    ('GET', '/'): 200,
    ('GET', '/home'): 200,
    ('GET', '/assets'): 200,
    ('GET', '/create'): 200,
    ('GET', '/create/product-set'): 200,
    ('GET', '/create/detail'): 200,
    ('GET', '/create/clone'): 200,
    ('GET', '/create/product-main'): 200,
    ('GET', '/create/apparel-catalog'): 200,
    ('GET', '/login'): 200,
    ('GET', '/auth'): 200,
    ('GET', '/auth/verify'): 200,
    ('GET', '/auth/reset'): 200,
}
UNCACHED = {path for (method, path) in EXPECTED if path == '/api/health/ready' or method == 'POST'}


class PublishedRelease(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.statuses = dict(EXPECTED)
        self.caches = {path: 'no-store' for path in UNCACHED}
        self.version = SHA
        self.invalid_json = False
        self.auth_code = 'unauthorized'
        self.delay = 0
        self.servers = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def handle_check(self):
                length = int(self.headers.get('content-length', '0'))
                owner.requests.append((self.server.server_port, self.command, self.path,
                                       dict(self.headers), self.rfile.read(length)))
                if self.path == '/api/health/ready':
                    time.sleep(owner.delay)
                    body = b'not JSON' if owner.invalid_json else json.dumps({'status': 'ok', 'version': owner.version}).encode()
                elif self.path in ('/api/account', '/api/auth/session'):
                    body = json.dumps({'code': owner.auth_code}).encode()
                elif self.path == '/login':
                    body = ''.join('<script src="' + path + '"></script>' for path in owner.assets).encode()
                else:
                    body = b'{"code":"gone"}'
                self.send_response(owner.statuses.get((self.command, self.path), 500))
                self.send_header('Content-Type', 'application/json')
                if self.path in owner.caches:
                    self.send_header('Cache-Control', owner.caches[self.path])
                self.send_header('Location', '/unexpected-endpoint')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            do_GET = handle_check
            do_POST = handle_check

            def log_message(self, *_):
                pass

        for _ in range(2):
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.daemon_threads = True
            threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
            self.servers.append(server)
        self.bases = [f'http://127.0.0.1:{server.server_port}' for server in self.servers]
        self.assets = ('/_next/static/recovery.css', '/_next/static/recovery-a.js', '/_next/static/recovery-b.js')
        self.statuses.update({('GET', path): 200 for path in self.assets})

    def tearDown(self):
        for server in self.servers:
            server.shutdown()
            server.server_close()

    def run_check(self, sha=SHA, timeout=1, env=None, bases=None, public_only=False, recovery=False):
        # Run the actual CLI handler against real local HTTP servers. Replacing
        # only the two destinations avoids any production request in this suite.
        bootstrap = '''
import importlib.util, sys
spec = importlib.util.spec_from_file_location('verify_release', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.BASES = tuple(sys.argv[2:4])
module.PUBLIC_BASE = sys.argv[3]
args = [sys.argv[4]] + (['--public-recovery'] if sys.argv[6] == 'recovery' else ['--public-only'] if sys.argv[6] == 'yes' else [])
raise SystemExit(module.main(args, timeout=float(sys.argv[5])))
'''
        return subprocess.run([sys.executable, '-c', bootstrap, str(SCRIPT), *(self.bases if bases is None else bases), sha, str(timeout), 'recovery' if recovery else 'yes' if public_only else 'no'],
                              capture_output=True, text=True, timeout=8, env=env)

    def redirecting_proxy_environment(self):
        self.proxy_requests = []
        owner = self

        class RedirectProxy(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                owner.proxy_requests.append(self.path)
                self.send_response(301)
                self.send_header('Location', owner.bases[0] + '/unexpected-endpoint')
                self.end_headers()

            def log_message(self, *_):
                pass

        proxy = http.server.ThreadingHTTPServer(('127.0.0.1', 0), RedirectProxy)
        proxy.daemon_threads = True
        threading.Thread(target=proxy.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        self.servers.append(proxy)
        address = f'http://127.0.0.1:{proxy.server_port}'
        return {**os.environ, 'HTTP_PROXY': address, 'http_proxy': address, 'NO_PROXY': '', 'no_proxy': ''}

    def test_loopback_checks_reach_the_origin_when_an_environment_proxy_redirects_http(self):
        result = self.run_check(env=self.redirecting_proxy_environment())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.requests), 40)
        self.assertEqual(self.proxy_requests, [])

    def test_public_checks_keep_the_environment_proxy_and_reject_its_redirect(self):
        result = self.run_check(env=self.redirecting_proxy_environment(),
                                bases=['http://published.invalid', 'http://published.invalid'])
        self.assertEqual(result.returncode, 1)
        self.assertIn('expected HTTP 200, got 301', result.stderr)
        self.assertEqual(self.requests, [])
        self.assertEqual(self.proxy_requests, ['http://published.invalid/api/health/ready'])

    def test_success_reports_both_destinations_without_credentials_or_paid_requests(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(lines), 40)
        self.assertEqual({line['base'] for line in lines}, set(self.bases))
        for line in lines:
            self.assertEqual(line['status'], EXPECTED[(line['method'], line['path'])])
            self.assertEqual(set(line), {'base', 'method', 'path', 'status', 'cacheControl', 'source'} |
                             ({'expectedVersion', 'actualVersion'} if line['path'] == '/api/health/ready' else set()))
        for server in self.servers:
            observed = {(method, path) for port, method, path, _, _ in self.requests if port == server.server_port}
            self.assertEqual(observed, set(EXPECTED))
        for _, method, _, headers, body in self.requests:
            lowered = {name.lower() for name in headers}
            self.assertFalse(lowered & {'authorization', 'cookie', 'apikey', 'x-worker-secret', 'x-batch-cron-secret'})
            if method == 'POST':
                payload = json.loads(body)
                self.assertEqual(uuid.UUID(payload['requestId']).version, 4)
                self.assertEqual(uuid.UUID(payload['sessionId']).version, 4)
                self.assertEqual(payload['tasks'], [])
                self.assertNotIn('billing', payload)

    def test_external_runner_checks_all_routes_without_touching_server_loopback(self):
        result = self.run_check(public_only=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(lines), 23)
        self.assertEqual({line['source'] for line in lines}, {'external'})
        self.assertEqual({port for port, *_ in self.requests}, {self.servers[1].server_port})
        self.assertEqual({(method, path) for _, method, path, _, _ in self.requests}, set(EXPECTED) | {('GET', p) for p in self.assets})

    def test_recovery_checks_stable_legacy_routes_and_static_assets_without_new_pages(self):
        self.statuses[('GET', '/home')] = 404
        result = self.run_check(recovery=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        observed = {(method, path) for _, method, path, _, _ in self.requests}
        self.assertEqual(observed, {('GET', p) for p in ('/api/health/ready', '/login', '/api/account', '/api/auth/session', *self.assets)})

    def test_external_static_asset_failure_is_a_release_failure(self):
        self.statuses[('GET', self.assets[0])] = 503
        result = self.run_check(public_only=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('expected HTTP 200, got 503', result.stderr)

    def test_an_arbitrary_401_does_not_prove_identity_dependency_health(self):
        self.auth_code = 'network'
        for public_only in (False, True):
            with self.subTest(public_only=public_only):
                result = self.run_check(public_only=public_only)
                self.assertEqual(result.returncode, 1)
                self.assertIn('requires unauthorized error', result.stderr)

    def test_external_runner_still_rejects_wrong_sha_and_backend_unavailability(self):
        self.version = 'b' * 40
        self.assertEqual(self.run_check(public_only=True).returncode, 1)
        self.version = SHA
        self.statuses[('GET', '/api/auth/session')] = 503
        result = self.run_check(public_only=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('GET /api/auth/session: expected HTTP 401, got 503', result.stderr)

    def test_wrong_actual_version_exits_nonzero(self):
        self.version = 'b' * 40
        result = self.run_check()
        self.assertEqual(result.returncode, 1)
        self.assertIn('version mismatch', result.stderr)
        self.assertIn(SHA, result.stderr)
        self.assertIn(self.version, result.stderr)

    def test_any_wrong_status_including_old_authenticated_batch_routes_fails(self):
        for route, correct in EXPECTED.items():
            with self.subTest(route=route):
                self.statuses = dict(EXPECTED)
                self.statuses[route] = 401 if route[0] == 'POST' else 200 if correct != 200 else 503
                result = self.run_check()
                self.assertEqual(result.returncode, 1)
                self.assertIn(f'expected HTTP {correct}', result.stderr)

    def test_health_and_all_http_error_410_responses_require_no_store(self):
        for path in UNCACHED:
            for cache in (None, 'max-age=3600', 'no-store=invalid'):
                with self.subTest(path=path, cache=cache):
                    self.caches = {item: 'no-store' for item in UNCACHED}
                    if cache is None:
                        del self.caches[path]
                    else:
                        self.caches[path] = cache
                    result = self.run_check()
                    self.assertEqual(result.returncode, 1)
                    self.assertIn('requires no-store', result.stderr)

    def test_valid_no_store_directive_is_case_insensitive_and_may_have_other_directives(self):
        self.caches = {path: 'private, No-Store' for path in UNCACHED}
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_malformed_health_json_fails_without_printing_response_body(self):
        self.invalid_json = True
        result = self.run_check()
        self.assertEqual(result.returncode, 1)
        self.assertIn('invalid health JSON', result.stderr)
        self.assertNotIn('not JSON', result.stderr + result.stdout)

    def test_transport_timeout_exits_nonzero(self):
        self.delay = 0.3
        result = self.run_check(timeout=0.03)
        self.assertEqual(result.returncode, 1)
        self.assertIn('request failed', result.stderr)

    def test_redirect_does_not_follow_an_unchecked_endpoint(self):
        self.statuses[('GET', '/api/health/ready')] = 302
        result = self.run_check()
        self.assertEqual(result.returncode, 1)
        self.assertIn('expected HTTP 200', result.stderr)
        self.assertFalse(any(path == '/unexpected-endpoint' for _, _, path, _, _ in self.requests))

    def test_public_page_redirect_fails_without_following_an_unchecked_destination(self):
        self.statuses[('GET', '/home')] = 302
        result = self.run_check()
        self.assertEqual(result.returncode, 1)
        self.assertIn('GET /home: expected HTTP 200, got 302', result.stderr)
        self.assertFalse(any(path == '/unexpected-endpoint' for _, _, path, _, _ in self.requests))

    def test_invalid_expected_sha_fails_before_any_http_request(self):
        for sha in ('short', 'A' * 40, 'a' * 40 + ';echo unsafe'):
            with self.subTest(sha=sha):
                result = self.run_check(sha)
                self.assertEqual(result.returncode, 1)
                self.assertIn('expected SHA must be 40 lowercase hexadecimal characters', result.stderr)
        self.assertEqual(self.requests, [])


if __name__ == '__main__':
    unittest.main()
