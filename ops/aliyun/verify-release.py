"""Server-local checks over SSH and independent public checks on the CI runner.

Public page checks are anonymous GETs and never submit authentication or generation.
No application credentials are accepted. The three retired POST requests carry
synthetic IDs and an empty task list; an old authenticated route cannot buy work.
Server HTTPS pins only the TCP destination to local Nginx, retaining public Host,
SNI and normal certificate verification. Public modes never use that pinning.
"""

import http.client
import html
import json
import re
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request


BASES = ('http://127.0.0.1:3100', 'https://www.zimage.store')
PUBLIC_BASE = 'https://www.zimage.store'
BATCH_ID = '00000000-0000-4000-8000-000000000003'
CHECKS = (
    ('GET', '/api/health/ready', 200, True),
    ('POST', '/api/creative-batches', 410, True),
    ('POST', f'/api/creative-batches/{BATCH_ID}', 410, True),
    ('POST', '/api/internal/creative-batch-worker', 410, True),
    ('GET', '/create/batch', 404, False),
    ('GET', '/api/account', 401, False),
    ('GET', '/api/auth/session', 401, False),
    ('GET', '/', 200, False),
    ('GET', '/home', 200, False),
    ('GET', '/assets', 200, False),
    ('GET', '/create', 200, False),
    ('GET', '/create/product-set', 200, False),
    ('GET', '/create/detail', 200, False),
    ('GET', '/create/clone', 200, False),
    ('GET', '/create/product-main', 200, False),
    ('GET', '/create/apparel-catalog', 200, False),
    ('GET', '/login', 200, False),
    ('GET', '/auth', 200, False),
    ('GET', '/auth/verify', 200, False),
    ('GET', '/auth/reset', 200, False),
)
RECOVERY_CHECKS = (
    ('GET', '/api/health/ready', 200, True),
    ('GET', '/login', 200, False),
    ('GET', '/api/account', 401, False),
    ('GET', '/api/auth/session', 401, False),
)
EMPTY_BATCH = json.dumps({
    'requestId': '00000000-0000-4000-8000-000000000001',
    'sessionId': '00000000-0000-4000-8000-000000000002',
    'tasks': [],
}).encode()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class LocalIngressHTTPSConnection(http.client.HTTPSConnection):
    """Keep SNI/certificate verification independent of the server's public DNS."""
    def connect(self):
        sock = socket.create_connection(('127.0.0.1', 443), self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname='www.zimage.store')
        except BaseException:
            sock.close()
            raise


class LocalIngressHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, request):
        origin = urllib.parse.urlsplit(request.full_url)
        if origin.hostname != 'www.zimage.store' or origin.port not in (None, 443):
            raise ValueError('Unexpected local ingress origin')
        return self.do_open(LocalIngressHTTPSConnection, request, context=self._context)


def verify(base, expected_sha, timeout=12, public_only=False, recovery=False):
    handlers = [NoRedirect()]
    origin = urllib.parse.urlsplit(base)
    if not public_only and origin.hostname == '127.0.0.1':
        # Verify the local application itself; an inherited HTTP proxy can
        # redirect this loopback request to a different origin. Public checks
        # retain the environment's existing transport and reject redirects.
        handlers.append(urllib.request.ProxyHandler({}))
    elif not public_only and origin.scheme == 'https' and origin.hostname == 'www.zimage.store':
        handlers.extend([urllib.request.ProxyHandler({}),
                         LocalIngressHTTPSHandler(context=ssl.create_default_context())])
    opener = urllib.request.build_opener(*handlers)
    checks = list(RECOVERY_CHECKS if recovery else CHECKS)
    for method, path, expected_status, uncached in checks:
        headers = {'Host': 'www.zimage.store', 'Accept': 'application/json'}
        if method == 'POST':
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(base + path, method=method, headers=headers,
                                         data=EMPTY_BATCH if method == 'POST' else None)
        try:
            try:
                response = opener.open(request, timeout=timeout)
            except urllib.error.HTTPError as error:
                # Expected 410/404/401 statuses still carry headers to inspect.
                response = error
            with response:
                status = response.code
                directives = {value.strip().lower() for value in response.headers.get('Cache-Control', '').split(',')}
                no_store = 'no-store' in directives
                needs_body = (path == '/api/health/ready' and status == 200) or (path in ('/api/account', '/api/auth/session') and status == 401) or (public_only and path == '/login' and status == 200)
                body = response.read(16384) if needs_body else b''
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            raise RuntimeError(f'{method} {path}: request failed ({type(error).__name__})') from error
        if status != expected_status:
            raise RuntimeError(f'{method} {path}: expected HTTP {expected_status}, got {status}')
        if uncached and not no_store:
            raise RuntimeError(f'{method} {path}: requires no-store')
        if public_only and path == '/login':
            page = body.decode('utf-8', errors='replace')
            assets = re.findall(r'(?:src|href)="([^" ]*/_next/static/[^" ]+)"', page)
            if not assets:
                raise RuntimeError('GET /login: no built static assets found')
            for asset in assets[:3]:
                asset = html.unescape(asset)
                if not asset.startswith('/_next/static/'):
                    raise RuntimeError('GET /login: unexpected static asset origin')
                checks.append(('GET', asset, 200, False))
        result = {'base': base, 'method': method, 'path': path, 'status': status,
                  'cacheControl': 'no-store' if no_store else '',
                  'source': 'external' if public_only else 'server_local'}
        if path in ('/api/account', '/api/auth/session'):
            try:
                error = json.loads(body)
            except (ValueError, UnicodeError):
                error = None
            if not isinstance(error, dict) or error.get('code') != 'unauthorized':
                raise RuntimeError(f'{method} {path}: requires unauthorized error')
        if path == '/api/health/ready':
            try:
                health = json.loads(body)
            except (ValueError, UnicodeError) as error:
                raise RuntimeError(f'{method} {path}: invalid health JSON') from error
            actual = health.get('version') if isinstance(health, dict) else None
            if actual != expected_sha:
                safe_actual = actual if isinstance(actual, str) and re.fullmatch('[a-f0-9]{40}', actual) else 'invalid'
                raise RuntimeError(f'{method} {path}: version mismatch; expected {expected_sha}, actual {safe_actual}')
            result.update(expectedVersion=expected_sha, actualVersion=actual)
        print(json.dumps(result), flush=True)


def main(argv=None, timeout=12):
    args = sys.argv[1:] if argv is None else argv
    public_only = len(args) == 2 and args[1] in ('--public-only', '--public-recovery')
    recovery = public_only and args[1] == '--public-recovery'
    if (len(args) != 1 and not public_only) or not re.fullmatch('[a-f0-9]{40}', args[0]):
        print('Release verification failed: expected SHA must be 40 lowercase hexadecimal characters', file=sys.stderr)
        return 1
    try:
        for base in ((PUBLIC_BASE,) if public_only else BASES):
            verify(base, args[0], timeout, public_only=public_only, recovery=recovery)
    except RuntimeError as error:
        print(f'Release verification failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
