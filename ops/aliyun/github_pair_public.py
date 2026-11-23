"""Anonymous public acceptance for a pair, independently of the ECS SSH receipt."""
import http.client
import json
import os
import sys

from github_hosted_stage_shadow import _unique
from github_pair_handoff import COMMIT

HOST = 'www.zimage.store'
ROUTES = ('/', '/login', '/workspace', '/assets', '/account')
IDENTITIES = ('/api/health/ready', '/api/meta', '/version.json')


def request(path):
    connection = http.client.HTTPSConnection(HOST, timeout=10)
    try:
        connection.request('GET', path, headers={'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'})
        with connection.getresponse() as response:
            body = response.read(1_000_001)
            if not 0 < len(body) <= 1_000_000 or response.getheader('Content-Encoding', 'identity') != 'identity':
                raise ValueError('Unexpected public response body')
            return response.status, response.headers.get_content_type(), response.getheader('Cache-Control', ''), body
    finally:
        connection.close()


def verify(commit, fetch=request):
    if not COMMIT.fullmatch(commit):
        raise ValueError('Exact public pair SHA required')
    frontend = 'release-' + commit[:12]

    def get(path, status, mime):
        received_status, received_mime, cache, body = fetch(path)
        if (received_status, received_mime) != (status, mime) or 'no-store' not in cache.lower() or not body:
            raise ValueError('Public route status, MIME or cache contract failed')
        return body

    def identities():
        ready, api, app = (json.loads(get(p, 200, 'application/json'), object_pairs_hook=_unique)
                           for p in IDENTITIES)
        if (ready['status'] != 'ok' or ready['version'] != commit or api['backendRelease'] != commit
                or app != {'schemaVersion': 1, 'frontendRelease': frontend}):
            raise ValueError('Public health/backend/frontend versions differ')

    identities()
    prefix = f'/frontend-assets/{frontend}/'.encode()
    for path in ROUTES:
        if prefix not in get(path, 200, 'text/html'):
            raise ValueError('Public shell references another frontend release')
    auth = json.loads(get('/api/auth/session', 401, 'application/json'), object_pairs_hook=_unique)
    if auth['code'] != 'unauthorized':
        raise ValueError('Anonymous public authentication must remain unauthorized')
    identities()
    return {'schemaVersion': 1, 'backendRelease': commit, 'frontendRelease': frontend,
            'health': 'ok', 'routes': list(ROUTES), 'anonymousSessionStatus': 401}


if __name__ == '__main__':
    try:
        print(json.dumps(verify(os.environ['GITHUB_SHA']), sort_keys=True))
    except Exception:
        sys.exit('Anonymous public pair verification failed')
