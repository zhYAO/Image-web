"""Frozen-policy/config fixtures, not a replacement for Ubuntu nginx -t/HTTP QA."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
CONFIG = (Path(__file__).with_name('split.nginx.conf')).read_text()
POLICY = json.loads((ROOT / 'doc/separation/route-policy.json').read_text())


def entries(name):
    match = re.search(r'map [^\n]+ \$' + name + r' \{\n(.*?)\n\}', CONFIG, re.S)
    if not match:
        raise AssertionError('Missing actual nginx map: ' + name)
    result = []
    for line in match[1].splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parsed = re.fullmatch(r'("[^"]*"|\x27[^\x27]*\x27|\S+)\s+(.*?)\s*;', line)
        if not parsed:
            raise AssertionError('Unsupported fixture map entry: ' + line)
        result.append(tuple(value[1:-1] if value[:1] in ('"', "'") else value for value in parsed.groups()))
    return result


def mapped(name, source):
    default = ''
    for key, value in entries(name):
        if key == 'default':
            default = value
        elif key.startswith('~*'):
            if re.search(key[2:], source, re.I): return value
        elif key.startswith('~'):
            if re.search(key[1:], source): return value
        elif not key.startswith('~') and key.lower() == source.lower():
            return value
    return default


class SplitIngress(unittest.TestCase):
    def test_map_regex_tokens_with_brace_quantifiers_are_quoted(self):
        # Nginx's lexer treats unquoted braces as config syntax before PCRE.
        self.assertFalse(re.search(r'(?m)^\s*~[^\s\x27\"]*[{}]', CONFIG),
                         'Map regex quantifiers must be quoted for nginx tokenization')

    def test_all_frozen_public_and_client_routes_have_exact_documents(self):
        expected = {'/': '/index.html', '/home': '/home/index.html', '/terms': '/terms/index.html',
                    '/privacy': '/privacy/index.html', '/create': '/create/index.html'}
        for route, document in expected.items():
            self.assertEqual(mapped('zimage_split_document', route), document)
            if route != '/': self.assertEqual(mapped('zimage_split_document', route + '/'), document)
        for path in ['/workspace', '/assets', '/account', '/login', '/auth', '/auth/verify', '/auth/reset',
                     '/sessions/10000000-0000-4000-8000-000000000001']:
            self.assertEqual(mapped('zimage_split_document', path), '/app.html')
            self.assertEqual(mapped('zimage_split_document', path + '/'), '/app.html')
        for scene in POLICY['validSceneIds']:
            self.assertEqual(mapped('zimage_split_document', '/create/' + scene), '/app.html')
            self.assertEqual(mapped('zimage_split_document', '/create/' + scene + '/'), '/app.html')

    def test_unknown_retired_api_and_missing_resources_never_fall_back(self):
        for path in ['/create/batch', '/create/invalid', '/create/PRODUCT-MAIN', '/create/detail/extra',
                     '/sessions/a_b', '/sessions/a/b', '/account/private', '/api', '/api/missing',
                     '/missing.js', '/assets/missing.js', '/index.html', '/app.html', '/missing']:
            self.assertEqual(mapped('zimage_split_document', path), '/__zimage_missing_document__')
        self.assertIn('try_files $zimage_split_document =404;', CONFIG)
        self.assertNotIn('try_files $uri /index.html', CONFIG)
        self.assertIn('location ~ ^/create/batch/?$', CONFIG)
        self.assertIn('add_header X-Robots-Tag noindex always;', CONFIG)
        self.assertIn('proxy_intercept_errors off;', CONFIG)  # upstream 410 remains 410

    def test_legacy_aliases_keep_queries_and_exact_scene_parsing(self):
        for path in ['/chat', '/chat/', '/image']:
            self.assertEqual(mapped('zimage_split_redirect', path), '/workspace')
        for path in ['/skills', '/skills/', '/skills/old-card']:
            self.assertEqual(mapped('zimage_split_redirect', path), '/create')
        for path in ['/skills/a/b', '/chat/private']:
            self.assertEqual(mapped('zimage_split_redirect', path), '')
        self.assertIn('return 308 $zimage_split_redirect$is_args$args;', CONFIG)
        for query in ['scene=', 'scene=batch', 'x=1&scene=detail&template=a%26b', '%73%63%65%6e%65=clone']:
            self.assertEqual(mapped('zimage_split_scene_query', query), '1')
        self.assertEqual(mapped('zimage_split_scene_query', 'utm_source=fixture'), '0')

    def test_next_protocol_headers_and_query_retain_original_backend_request(self):
        self.assertEqual(mapped('zimage_split_flight_header', ''), '0')
        for value in ['1', '%5B%22route%22%5D', 'segment', '/workspace', 'action-id']:
            self.assertEqual(mapped('zimage_split_flight_header', value), '1')
        for query in ['_rsc=abc', '_rsc=', 'task=old&_rsc=flight&view=results']:
            self.assertEqual(mapped('zimage_split_flight_query', query), '1')
        self.assertEqual(mapped('zimage_split_flight_query', 'not_rsc=1'), '0')
        self.assertEqual(mapped('zimage_split_legacy', '0:0'), '0')
        for key in ['1:0', '0:1', '1:1']:
            self.assertEqual(mapped('zimage_split_legacy', key), '1')
        for header in ['rsc', 'next_router_state_tree', 'next_router_prefetch', 'next_router_segment_prefetch',
                       'next_url', 'next_action', 'next_hmr_refresh']:
            self.assertIn('$http_' + header, CONFIG)
        self.assertIn('location ^~ /_next/ { proxy_pass http://127.0.0.1:3100; }', CONFIG)
        legacy = CONFIG.split('location @zimage_split_legacy {', 1)[1].split('}', 1)[0]
        self.assertIn('proxy_pass http://127.0.0.1:3100;', legacy)
        self.assertNotIn('rewrite ', legacy)
        self.assertNotIn('proxy_set_header RSC', CONFIG)

    def test_api_and_sse_transport_stays_same_origin_and_never_retries(self):
        for path in ['= /api', '^~ /api/']:
            self.assertIn('location ' + path + ' { proxy_pass http://127.0.0.1:3100; }', CONFIG)
        for directive in ['proxy_buffering off;', 'proxy_cache off;', 'proxy_next_upstream off;',
                          'proxy_ignore_client_abort off;', 'proxy_read_timeout 300s;', 'proxy_send_timeout 300s;',
                          'proxy_set_header X-Forwarded-For $remote_addr;', 'proxy_set_header Forwarded \x27\x27;']:
            self.assertIn(directive, CONFIG)
        self.assertNotIn('Access-Control-Allow-Origin', CONFIG)
        self.assertNotIn('proxy_ignore_headers', CONFIG)

    def test_upload_multipart_envelope_has_an_exact_route_budget(self):
        upload = CONFIG.split('location = /api/uploads {', 1)[1].split('}', 1)[0]
        self.assertIn('client_max_body_size 10496k;', upload)
        self.assertIn('proxy_pass http://127.0.0.1:3100;', upload)
        self.assertEqual(10496 * 1024, 10 * 1024 * 1024 + 256 * 1024)
        self.assertNotIn('proxy_next_upstream ', upload)  # inherit off, no replay

    def test_namespaced_assets_only_cache_successful_resources_and_html_never_immutable(self):
        self.assertEqual(mapped('zimage_split_asset_policy', '/frontend-assets/ns/app.html'), 'no-store')
        self.assertEqual(mapped('zimage_split_asset_policy', '/frontend-assets/ns/version.json'), 'no-store')
        for status in ['200', '206', '304']:
            self.assertIn('immutable', mapped('zimage_split_asset_cache', status + ':immutable'))
            self.assertEqual(mapped('zimage_split_asset_cache', status + ':no-store'), 'no-store')
        for status in ['301', '302', '403', '404', '405', '410', '500', '503']:
            self.assertEqual(mapped('zimage_split_asset_cache', status + ':immutable'), 'no-store')
        self.assertIn('alias /opt/zimage/frontend/assets/$zimage_ns/$zimage_file;', CONFIG)
        self.assertIn('application/javascript js mjs;', CONFIG)
        self.assertIn('text/css css;', CONFIG)
        self.assertIn('root /opt/zimage/frontend/current;', CONFIG)
        gate = Path(__file__).with_name('ingress-maintenance-server.conf').read_text()
        self.assertIn('include /etc/nginx/zimage-ingress-maintenance-server.conf;', CONFIG)
        self.assertEqual(len(re.findall(r'(?m)^\s*open_file_cache\s+off\s*;', gate)), 1)
        self.assertIn('add_header Cache-Control no-store always;', CONFIG)
        self.assertNotIn('font/otf', CONFIG)

    def test_ambiguous_and_encoded_path_boundaries_fail_closed(self):
        self.assertIn('merge_slashes off;', CONFIG)
        for path in ['//workspace', '/sessions//owner', '/create%2fdetail', '/%5cworkspace', '/work%00space',
                     '/api/../', '/api/%2e%2E/', '/api/.%2e', '/api/./auth/session', '/workspace?x=1//2']:
            expected = '0' if '?' in path else '1'
            self.assertEqual(mapped('zimage_split_invalid_path', path), expected)
        self.assertEqual(mapped('zimage_split_invalid_path', '/workspace?template=%2fkeep'), '0')
        self.assertIn('if ($zimage_split_invalid_path) { return 404; }', CONFIG)
        self.assertIn('if ($uri ~ "(^|/)\\.") { return 404; }', CONFIG)
        for path in ['/.release/manifest.json', '/frontend-assets/ns/.release/file-index.json', '/.env', '/commerce/.secret']:
            self.assertIsNotNone(re.search(r'(^|/)\.', path))


if __name__ == '__main__': unittest.main()
