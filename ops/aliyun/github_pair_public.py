"""Anonymous public acceptance for a pair, independently of the ECS SSH receipt."""
import http.client
import json
import os
from pathlib import Path
import sys

from github_hosted_stage_shadow import _unique
from github_pair_handoff import COMMIT, file_sha, rollback_pair

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
    if type(commit) is not str or not COMMIT.fullmatch(commit):
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


def capture(fetch=request):
    """Measure the currently served rollback pair and recheck it on every route."""
    status, mime, cache, body = fetch('/api/meta')
    if (status, mime) != (200, 'application/json') or 'no-store' not in cache.lower():
        raise ValueError('Cannot identify the current public backend')
    value = json.loads(body, object_pairs_hook=_unique)
    return verify(value['backendRelease'], fetch=fetch)


def observe_after_failure(commit, deployment, baseline, fetch=request):
    """Observe the previous pair without claiming an ECS restoration took place."""
    previous = rollback_pair(dict(backend=baseline['backendRelease'], frontend=baseline['frontendRelease']), commit)
    if (deployment['status'] != 'opened' or deployment['commit'] != commit
            or deployment['rollbackPair'] != previous):
        raise ValueError('Deployment receipt does not bind the previously measured pair')
    try:
        observation = verify(previous['backend'], fetch=fetch)
    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
        observation = None
    return {'schemaVersion': 1, 'operationId': deployment['operationId'], 'candidate': commit,
            'rollbackTarget': previous, 'publicRollbackObservation': observation, 'recoveryVerified': False}


def small_json(path):
    with path.open('rb') as stream:
        raw = stream.read(16385)
    if not 0 < len(raw) <= 16384:
        raise ValueError('Bounded local receipt required')
    return json.loads(raw, object_pairs_hook=_unique)


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--capture-current']:
            evidence = capture()
        elif len(sys.argv) == 4 and sys.argv[1] == '--observe-failed-public':
            deployment, baseline = map(Path, sys.argv[2:])
            evidence = observe_after_failure(os.environ['GITHUB_SHA'], small_json(deployment), small_json(baseline))
            evidence['deploymentReceiptSha256'] = file_sha(deployment)
        elif len(sys.argv) == 1:
            evidence = verify(os.environ['GITHUB_SHA'])
        else:
            raise ValueError('Unknown public verification mode')
        print(json.dumps(evidence, sort_keys=True))
    except Exception:
        sys.exit('Anonymous public pair verification failed')
