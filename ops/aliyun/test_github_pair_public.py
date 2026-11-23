import json
import unittest

import github_pair_public as public


class PublicPairTest(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.frontend = 'release-' + self.sha[:12]
        self.response = {}
        for path in public.ROUTES:
            self.response[path] = (200, 'text/html', 'no-store',
                                   f'<script src="/frontend-assets/{self.frontend}/app.js"></script>'.encode())
        for path, status, body in (
            ('/api/health/ready', 200, {'status': 'ok', 'version': self.sha}),
            ('/api/meta', 200, {'backendRelease': self.sha}),
            ('/version.json', 200, {'schemaVersion': 1, 'frontendRelease': self.frontend}),
            ('/api/auth/session', 401, {'code': 'unauthorized'}),
        ):
            self.response[path] = (status, 'application/json', 'no-store', json.dumps(body).encode())

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

    def test_version_drift_during_public_probe_fails(self):
        def changing(path):
            reply = self.response[path]
            if path == '/workspace':
                head = '/api/meta'
                self.response[head] = self.response[head][:3] + (b'{"backendRelease":"older"}',)
            return reply
        with self.assertRaises(ValueError):
            public.verify(self.sha, fetch=changing)
