"""Anonymous public acceptance for a pair, independently of the ECS SSH receipt."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import sys

from github_hosted_stage_shadow import _unique
from github_pair_handoff import COMMIT, DIGEST, file_sha, rollback_pair

HOST = 'www.zimage.store'
ROUTES = ('/', '/login', '/workspace', '/assets', '/account')
IDENTITIES = ('/api/health/ready', '/api/meta', '/version.json')
SESSION = '/api/auth/session'
CONTRACTS = {**dict.fromkeys(IDENTITIES, (200, 'application/json')),
             **dict.fromkeys(ROUTES, (200, 'text/html')), SESSION: (401, 'application/json')}
FAILURE_KIND = 'zimage-public-contract-failure-v1'


class ContractFailure(ValueError):
    def __init__(self, path, check, facts):
        super().__init__(f'Public route contract failed: {path} {check}')
        self.facts = dict(path=path, failedCheck=check, **facts)


def transport_violation(path, status, mime_matches, no_store, size):
    if status != CONTRACTS[path][0]:
        return 'status'
    if not mime_matches:
        return 'content-type'
    if not no_store:
        return 'cache-control'
    if not size:
        return 'empty-body'
    return None


def has_no_store(cache):
    return any(directive.strip().lower() == 'no-store' for directive in cache.split(','))


def response_metadata(path, response):
    status, mime, cache, body = response
    if (type(status) is not int or not 100 <= status <= 599 or type(mime) is not str or type(cache) is not str
            or type(body) is not bytes or len(body) > 1_000_000):
        raise ValueError('Unusable public probe response')
    return status, mime == CONTRACTS[path][1], has_no_store(cache), len(body)


def reject(path, check, response, metadata):
    status, mime_matches, no_store, size = metadata
    raise ContractFailure(path, check, dict(status=status, mimeMatches=mime_matches, noStore=no_store,
                                           bodyBytes=size, bodySha256=hashlib.sha256(response[3]).hexdigest()))


def request(path):
    connection = http.client.HTTPSConnection(HOST, timeout=10)
    try:
        connection.request('GET', path, headers={'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'})
        with connection.getresponse() as response:
            body = response.read(1_000_001)
            if len(body) > 1_000_000 or response.getheader('Content-Encoding', 'identity') != 'identity':
                raise ValueError('Unexpected public response body')
            return response.status, response.headers.get_content_type(), response.getheader('Cache-Control', ''), body
    finally:
        connection.close()


def verify(commit, fetch=request):
    if type(commit) is not str or not COMMIT.fullmatch(commit):
        raise ValueError('Exact public pair SHA required')
    frontend = 'release-' + commit[:12]

    def check(path, content_matches):
        response = fetch(path)
        metadata = response_metadata(path, response)
        failure = transport_violation(path, *metadata)
        if failure:
            reject(path, failure, response, metadata)
        if not content_matches(response[3]):
            reject(path, 'body-contract', response, metadata)

    def check_json(path, matches):
        def content_matches(body):
            try:
                value = json.loads(body, object_pairs_hook=_unique)
            except ValueError:
                return False
            return type(value) is dict and matches(value)
        check(path, content_matches)

    def identities():
        check_json('/api/health/ready', lambda value: value.get('status') == 'ok' and value.get('version') == commit)
        check_json('/api/meta', lambda value: value.get('backendRelease') == commit)
        check_json('/version.json', lambda value: type(value.get('schemaVersion')) is int
                   and value == {'schemaVersion': 1, 'frontendRelease': frontend})

    identities()
    prefix = f'/frontend-assets/{frontend}/'.encode()
    for path in ROUTES:
        check(path, lambda body: prefix in body)
    check_json(SESSION, lambda value: value.get('code') == 'unauthorized')
    identities()
    return {'schemaVersion': 1, 'backendRelease': commit, 'frontendRelease': frontend,
            'health': 'ok', 'routes': list(ROUTES), 'anonymousSessionStatus': 401}


def capture_failure(commit, fetch=request):
    """Record a failed check on a bounded HTTPS response for an exact candidate."""
    try:
        verify(commit, fetch=fetch)
    except ContractFailure as error:
        return dict(schemaVersion=1, kind=FAILURE_KIND, backendRelease=commit,
                    frontendRelease='release-' + commit[:12], check=error.facts)
    raise ValueError('Public verification passed; no failed response to record')


def validate_failure(witness, pair):
    if (type(witness) is not dict or set(witness) != {'schemaVersion', 'kind', 'backendRelease', 'frontendRelease', 'check'}
            or type(witness['schemaVersion']) is not int or witness['schemaVersion'] != 1
            or witness['kind'] != FAILURE_KIND or witness['backendRelease'] != pair['backend']
            or witness['frontendRelease'] != pair['frontend']):
        raise ValueError('Public failure witness does not name the exact published pair')
    check = witness['check']
    if (type(check) is not dict or set(check) != {'path', 'failedCheck', 'status', 'mimeMatches', 'noStore', 'bodyBytes', 'bodySha256'}
            or type(check['path']) is not str or check['path'] not in CONTRACTS
            or type(check['status']) is not int or not 100 <= check['status'] <= 599
            or type(check['mimeMatches']) is not bool or type(check['noStore']) is not bool
            or type(check['bodyBytes']) is not int or not 0 <= check['bodyBytes'] <= 1_000_000
            or type(check['bodySha256']) is not str or not DIGEST.fullmatch(check['bodySha256'])
            or (check['bodyBytes'] == 0) != (check['bodySha256'] == hashlib.sha256(b'').hexdigest())):
        raise ValueError('Public failure witness does not describe an observed HTTP response')
    failed = transport_violation(check['path'], check['status'], check['mimeMatches'], check['noStore'], check['bodyBytes'])
    if check['failedCheck'] != (failed or 'body-contract'):
        raise ValueError('Public failure witness contradicts the observed HTTP response')


def capture(fetch=request):
    """Measure the currently served rollback pair and recheck it on every route."""
    path = '/api/meta'
    response = fetch(path)
    if transport_violation(path, *response_metadata(path, response)):
        raise ValueError('Cannot identify the current public backend')
    value = json.loads(response[3], object_pairs_hook=_unique)
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
        elif sys.argv[1:] == ['--capture-failure']:
            evidence = capture_failure(os.environ['GITHUB_SHA'])
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
