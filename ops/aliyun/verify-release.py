"""Read-only release checks streamed over the existing deployment SSH connection.

No application credentials are accepted. The three retired POST requests carry
synthetic IDs and an empty task list; an old authenticated route cannot buy work.
"""

import json
import re
import sys
import urllib.error
import urllib.request


BASES = ('http://127.0.0.1:3100', 'https://www.zimage.store')
BATCH_ID = '00000000-0000-4000-8000-000000000003'
CHECKS = (
    ('GET', '/api/health/ready', 200, True),
    ('POST', '/api/creative-batches', 410, True),
    ('POST', f'/api/creative-batches/{BATCH_ID}', 410, True),
    ('POST', '/api/internal/creative-batch-worker', 410, True),
    ('GET', '/create/batch', 404, False),
    ('GET', '/api/account', 401, False),
)
EMPTY_BATCH = json.dumps({
    'requestId': '00000000-0000-4000-8000-000000000001',
    'sessionId': '00000000-0000-4000-8000-000000000002',
    'tasks': [],
}).encode()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def verify(base, expected_sha, timeout=12):
    opener = urllib.request.build_opener(NoRedirect())
    for method, path, expected_status, uncached in CHECKS:
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
                body = response.read(16384) if path == '/api/health/ready' and status == 200 else b''
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            raise RuntimeError(f'{method} {path}: request failed ({type(error).__name__})') from error
        if status != expected_status:
            raise RuntimeError(f'{method} {path}: expected HTTP {expected_status}, got {status}')
        if uncached and not no_store:
            raise RuntimeError(f'{method} {path}: requires no-store')
        result = {'base': base, 'method': method, 'path': path, 'status': status,
                  'cacheControl': 'no-store' if no_store else ''}
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
    if len(args) != 1 or not re.fullmatch('[a-f0-9]{40}', args[0]):
        print('Release verification failed: expected SHA must be 40 lowercase hexadecimal characters', file=sys.stderr)
        return 1
    try:
        for base in BASES:
            verify(base, args[0], timeout)
    except RuntimeError as error:
        print(f'Release verification failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
