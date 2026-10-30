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


def blocked(closed, checking, method, uri, opened=False):
    probe = mapped('zimage_ingress_probe', method + ':' + uri)
    return mapped('zimage_ingress_blocked', f'{int(opened)}:{int(closed)}:{int(checking)}:{probe}') == '1'


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
