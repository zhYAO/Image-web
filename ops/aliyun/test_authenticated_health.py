import importlib.util
import io
import pathlib
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

    def test_checks_authenticated_account_sessions_and_credits(self):
        bodies = [Response('{"id":"user-1","status":"active"}'),
                  Response('{"sessions":[]}'), Response('{"balance":0}')]
        with patch.object(health.urllib.request, 'build_opener') as build:
            request = build.return_value.open
            request.side_effect = bodies
            self.assertEqual(health.check('https://example.test', 'session=value'), 'user-1')
        self.assertEqual(request.call_count, 3)
        self.assertTrue(all(call.args[0].headers.get('Cookie') == 'session=value'
                            for call in request.call_args_list))

    def test_rejects_an_expired_session(self):
        error = urllib.error.HTTPError('https://example.test/api/account', 401, 'Unauthorized', {}, None)
        with patch.object(health.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = error
            with self.assertRaisesRegex(RuntimeError, 'HTTP 401'):
                health.check('https://example.test', 'session=value')
