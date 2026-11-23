import json
import unittest

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
