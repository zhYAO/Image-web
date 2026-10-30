import importlib.util
import io
import pathlib
import runpy
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('authenticated_health', pathlib.Path(__file__).with_name('authenticated_health.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class Response:
    status = 200

    def __init__(self, body):
        self.body = io.BytesIO(body.encode())

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self, *args):
        return self.body.read(*args)


class AuthenticatedHealth(unittest.TestCase):
    def test_requires_secure_cookie_and_https(self):
        for base, cookie in [('http://localhost', 'cookie=value'), ('https://example.test', ''),
                             ('https://example.test', 'bad\nheader')]:
            with self.assertRaises(ValueError):
                health.check(base, cookie)

    def test_checks_account_and_sessions_without_initializing_a_wallet(self):
        bodies = [Response('{"id":"user-1","status":"active"}'),
                  Response('{"sessions":[]}'), Response('{"balance":0}')]
        with patch.object(health.urllib.request, 'build_opener') as build:
            request = build.return_value.open
            request.side_effect = bodies
            self.assertEqual(health.check('https://example.test', 'session=value'), 'user-1')
        self.assertEqual([call.args[0].full_url for call in request.call_args_list],
                         ['https://example.test/api/account', 'https://example.test/api/sessions'])
        self.assertTrue(all(call.args[0].headers.get('Cookie') == 'session=value'
                            for call in request.call_args_list))

    def test_success_output_omits_identity_cookie_and_wallet_claims(self):
        output = io.StringIO()
        with patch.dict(health.os.environ, {'ZIMAGE_HEALTH_BASE': 'https://example.test',
                                          'ZIMAGE_AUTH_COOKIE': 'session=sensitive-value'}, clear=True), \
             patch.object(health.urllib.request, 'build_opener') as build, \
             patch('sys.stdout', output):
            build.return_value.open.side_effect = [
                Response('{"id":"private-user-id","status":"active"}'),
                Response('{"sessions":[]}'),
                Response('{"balance":0}'),
            ]
            runpy.run_path(str(pathlib.Path(health.__file__)), run_name='__main__')
        self.assertEqual(output.getvalue(), 'Authenticated account and sessions healthy\n')

    def test_rejects_an_expired_session(self):
        error = urllib.error.HTTPError('https://example.test/api/account', 401, 'Unauthorized', {}, None)
        with patch.object(health.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = error
            with self.assertRaisesRegex(RuntimeError, 'HTTP 401'):
                health.check('https://example.test', 'session=value')
