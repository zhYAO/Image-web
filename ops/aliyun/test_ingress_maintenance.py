"""Candidate-config policy fixtures; real Linux nginx -t/HTTP is a separate gate."""
from pathlib import Path
import re
import unittest
import uuid

HERE = Path(__file__).resolve().parent


def source(name):
    path = HERE / name
    return path.read_text() if path.exists() else ''


def mapped(name, value):
    match = re.search(r'map [^\n]+ \$' + name + r' \{\n(.*?)\n\}',
                      source('ingress-maintenance-maps.conf'), re.S)
    if not match:
        raise AssertionError('Missing maintenance map ' + name)
    default = None
    for line in match[1].splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, result = line[:-1].rsplit(None, 1)
        key = key.strip('"\'')
        if key == 'default':
            default = result.strip('"\'')
        elif key.startswith('~'):
            found = re.search(key[1:], value)
            if found:
                return re.sub(r'\$(\d+)', lambda item: found.group(int(item.group(1))), result.strip('"\''))
        elif key == value:
            return result
    return default


def blocked(closed, checking, method, uri, opened=False, frontend=False, request_uri=None):
    probe = mapped('zimage_ingress_probe', method + ':' + uri)
    frontend_probe = mapped('zimage_frontend_probe', method + ':' + (request_uri if request_uri is not None else uri))
    return mapped('zimage_ingress_blocked', f'{int(opened)}:{int(closed)}:{int(checking)}:{probe}:{int(frontend)}:{frontend_probe}') == '1'


class IngressMaintenance(unittest.TestCase):
    def test_gate_owns_the_single_cache_directive_in_each_candidate_server(self):
        directive = r'(?m)^\s*open_file_cache\s+off\s*;'
        self.assertEqual(len(re.findall(directive, source('ingress-maintenance-server.conf'))), 1)
        for name in ('legacy-gated.nginx.conf', 'split.nginx.conf'):
            self.assertFalse(re.search(directive, source(name)),
                             name + ' must inherit the single cache directive from its gate include')

    def test_open_preserves_existing_method_and_path_handling(self):
        for method in ('GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'):
            for uri in ('/', '/api/chat', '/_next/image', '/api/credits', '/unknown'):
                self.assertFalse(blocked(False, False, method, uri, opened=True))

    def test_draining_closes_every_new_application_request(self):
        for method in ('GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'):
            for uri in ('/', '/api/meta', '/api/chat', '/api/credits/pricing', '/_next/image',
                        '/_next/static/chunks/old.js', '/workspace', '/api/sessions'):
                self.assertTrue(blocked(True, False, method, uri))

    def test_checking_only_allows_fixed_read_probes_and_built_assets(self):
        allowed = ('/api/health/ready', '/api/meta', '/api/public-config', '/api/auth/session',
                   '/api/account', '/api/sessions', '/api/credits/pricing', '/login',
                   '/_next/static/chunks/old.js')
        for method in ('GET', 'HEAD'):
            for uri in allowed:
                self.assertFalse(blocked(True, True, method, uri), (method, uri))
        for method, uri in [('POST', '/api/account'), ('OPTIONS', '/api/meta'),
                            ('GET', '/api/credits'), ('GET', '/api/credits/ledger'),
                            ('GET', '/api/credits/pricing/'), ('GET', '/api/account/private'),
                            ('GET', '/_next/image'), ('GET', '/workspace'), ('GET', '/')]:
            self.assertTrue(blocked(True, True, method, uri), (method, uri))

    def test_orphan_checking_flag_fails_closed(self):
        for uri in ('/api/health/ready', '/api/account', '/_next/image', '/'):
            self.assertTrue(blocked(False, True, 'GET', uri))

    def test_frontend_probe_requires_its_marker_and_exact_sealed_checking_tuple(self):
        paths = ('/', '/version.json', '/frontend-assets/web-1/assets/main-a1.js',
                 '/frontend-assets/web-1/assets/lazy.mjs', '/frontend-assets/web-1/assets/main.css')
        for method in ('GET', 'HEAD'):
            for uri in paths:
                with self.subTest(method=method, uri=uri):
                    self.assertFalse(blocked(True, True, method, uri, frontend=True))
                    self.assertTrue(blocked(True, True, method, uri))
                    for opened, closed, checking in ((False, False, False), (False, False, True),
                                                     (False, True, False), (True, True, True),
                                                     (True, False, True), (True, True, False)):
                        self.assertTrue(blocked(closed, checking, method, uri, opened=opened, frontend=True))

    def test_frontend_probe_never_admits_mutations_or_other_read_routes(self):
        for method in ('POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS', 'TRACE'):
            for uri in ('/', '/version.json', '/frontend-assets/web-1/assets/main.js'):
                self.assertTrue(blocked(True, True, method, uri, frontend=True), (method, uri))
        for uri in ('/workspace', '/api/credits', '/api/credits/ledger', '/_next/image',
                    '/frontend-assets/web-1/app.html', '/frontend-assets/web-1/version.json',
                    '/frontend-assets/web-1/assets/icon.svg', '/frontend-assets/web-1/assets/main.js.map',
                    '/frontend-assets/web-1/assets/', '/frontend-assets/web-1/.release/manifest.json',
                    '/frontend-assets/' + 'a' * 129 + '/main.js'):
            self.assertTrue(blocked(True, True, 'GET', uri, frontend=True), uri)

    def test_frontend_probe_checks_raw_uri_before_normalization_and_rejects_queries(self):
        self.assertIn('map "$request_method:$request_uri" $zimage_frontend_probe', source('ingress-maintenance-maps.conf'))
        for normalized, raw in (('/', '/?preview=1'), ('/', '/?_rsc=1'),
                                ('/version.json', '/version.json?x=1'),
                                ('/frontend-assets/web-1/main.js', '/frontend-assets/web-1/assets/../main.js'),
                                ('/frontend-assets/web-1/main.js', '/frontend-assets/web-1/%2e%2e/main.js'),
                                ('/frontend-assets/web-1/main.js', '/frontend-assets/web-1/%6dain.js'),
                                ('/frontend-assets/web-1/main.js', '/frontend-assets/web-1//main.js'),
                                ('/frontend-assets/web-1/main.js', '/frontend-assets/web-1/main.js?x=1'),
                                ('/frontend-assets/web-1/main.js', '/frontend-assets/web-1%2fmain.js')):
            self.assertTrue(blocked(True, True, 'GET', normalized, frontend=True, request_uri=raw), raw)

    def test_frontend_marker_does_not_change_existing_api_checking_or_open_rules(self):
        for frontend in (False, True):
            for method in ('GET', 'HEAD'):
                for uri in ('/api/meta', '/api/public-config', '/login', '/_next/static/chunks/main.js'):
                    self.assertFalse(blocked(True, True, method, uri, frontend=frontend))
            for method in ('GET', 'POST', 'PATCH', 'DELETE'):
                for uri in ('/', '/workspace', '/api/chat', '/frontend-assets/web-1/main.js'):
                    self.assertFalse(blocked(False, False, method, uri, opened=True, frontend=frontend))

    def test_missing_or_contradictory_flags_fail_closed(self):
        for uri in ('/api/health/ready', '/api/account', '/_next/image', '/'):
            self.assertTrue(blocked(False, False, 'GET', uri))
            self.assertTrue(blocked(True, False, 'GET', uri, opened=True))
            self.assertTrue(blocked(True, True, 'GET', uri, opened=True))
            self.assertTrue(blocked(False, True, 'GET', uri, opened=True))

    def test_legacy_and_split_candidates_both_install_gate_before_proxy(self):
        for name in ('legacy-gated.nginx.conf', 'split.nginx.conf'):
            config = source(name)
            self.assertIn('include /etc/nginx/zimage-ingress-maintenance-maps.conf;', config)
            gate = 'include /etc/nginx/zimage-ingress-maintenance-server.conf;'
            self.assertIn(gate, config)
            self.assertLess(config.index(gate), config.index('proxy_pass'))
            self.assertIn('proxy_next_upstream off;', config)
            self.assertIn('proxy_intercept_errors off;', config)

    def test_fixed_flags_and_parseable_retryable_response(self):
        config = source('ingress-maintenance-server.conf')
        self.assertIn('if (-f /etc/zimage/ingress-open.json)', config)
        self.assertIn('open_file_cache off;', config)
        self.assertIn('if (-f /etc/zimage/ingress-maintenance.json)', config)
        self.assertIn('if (-f /etc/zimage/ingress-checking.json)', config)
        self.assertIn('if (-f /etc/zimage/frontend-checking.json)', config)
        self.assertIn('if ($zimage_ingress_blocked) { return 503; }', config)
        self.assertIn('add_header Cache-Control "private, no-store" always;', config)
        self.assertIn('add_header Retry-After 30 always;', config)
        self.assertIn('"code":"network"', config)
        self.assertIn('"retryable":true', config)
        self.assertNotIn('proxy_pass', config)

    def test_maintenance_correlation_is_a_uuid_matching_body_and_header(self):
        value = mapped('zimage_ingress_correlation', '0123456789abcdef0123456789abcdef')
        parsed = uuid.UUID(value)
        self.assertEqual(parsed.version, 4)
        self.assertEqual(parsed.variant, uuid.RFC_4122)
        config = source('ingress-maintenance-server.conf')
        self.assertIn('"correlationId":"$zimage_ingress_correlation"', config)
        self.assertIn('add_header X-Correlation-Id $zimage_ingress_correlation always;', config)
