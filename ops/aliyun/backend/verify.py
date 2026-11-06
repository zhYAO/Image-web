#!/usr/bin/env python3
"""Run on an independently authorized machine, using an existing test cookie.

GET-only verifier; no sign-in, OTP, model invocation or task submission. Receipt
installation on the server is a separate root-authorized trust boundary.
"""
import argparse
import hashlib
import importlib.util
from http.cookies import SimpleCookie
from http.cookiejar import Cookie, CookieJar
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import urllib.request
import uuid
from datetime import datetime

ORIGIN = 'https://www.zimage.store'
CATALOG_PATH = '/api/credits/pricing'
PROBE_HEADER, CATALOG_PROBE = 'x-zimage-readonly-probe', 'catalog-v1'
PATHS = ('/api/health/ready', '/api/meta', '/api/auth/session', '/api/account', '/api/sessions', CATALOG_PATH)
PROTOCOL = 'zimage-backend-readonly-v2'


def valid_uuid(value):
    try: return isinstance(value, str) and str(uuid.UUID(value)) == value.lower() and value[14] in '12345678' and value[19].lower() in '89ab'
    except (ValueError, TypeError, IndexError): return False


def integer(value): return type(value) is int and 0 <= value <= 9007199254740991


def validate_body(path, body):
    if path == '/api/health/ready':
        return body.get('status') == 'ok' and isinstance(body.get('version'), str)
    if path == '/api/meta':
        api, caps = body.get('api'), body.get('capabilities')
        return (set(body) == {'schemaVersion', 'backendRelease', 'api', 'capabilities'} and type(body.get('schemaVersion')) is int and body['schemaVersion'] == 1
                and type(api) is dict and set(api) == {'major', 'minor'} and type(api['major']) is int and api['major'] == 1 and integer(api['minor'])
                and type(caps) is list and len(caps) <= 256 and all(isinstance(cap, str) and len(cap) <= 100 and re.fullmatch(r'[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*', cap) for cap in caps)
                and len(set(caps)) == len(caps))
    if path == '/api/auth/session': return set(body) == {'id'} and valid_uuid(body['id'])
    if path == '/api/account':
        name = body.get('displayName')
        return (valid_uuid(body.get('id')) and body.get('status') == 'active' and 'displayName' in body
                and (name is None or isinstance(name, str) and len(name) <= 80)
                and isinstance(body.get('email'), str) and re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', body['email']) is not None)
    if path == CATALOG_PATH:
        # Exact wire output of the domain creditCatalog/creditPrice schemas.
        # A disabled catalog is valid; only the server's strict probe marker can
        # attest that it came from the catalog RPC rather than TRIAL fallback.
        if (set(body) != {'version', 'enabled', 'prices'} or not isinstance(body['version'], str)
                or type(body['enabled']) is not bool or type(body['prices']) is not list): return False
        for price in body['prices']:
            if (type(price) is not dict or not {'operation', 'provider', 'model', 'resolution', 'unitMinor', 'label'}.issubset(price)
                    or set(price) - {'operation', 'provider', 'model', 'resolution', 'unitMinor', 'label', 'rateVersion', 'billingMode', 'tokenTariff'}
                    or price['operation'] not in ('image', 'chat', 'optimize')
                    or not isinstance(price['provider'], str) or not price['provider']
                    or not isinstance(price['model'], str) or not price['model']
                    or not isinstance(price['resolution'], str) or not isinstance(price['label'], str)
                    or not integer(price['unitMinor']) or price['unitMinor'] < 1): return False
            if 'rateVersion' in price and (not isinstance(price['rateVersion'], str) or not 1 <= len(price['rateVersion']) <= 100): return False
            if 'billingMode' in price and price['billingMode'] != 'usage_capped': return False
            if 'tokenTariff' in price:
                tariff = price['tokenTariff']
                rates = ('inputPerMillionNano', 'cachedInputPerMillionNano', 'outputPerMillionNano')
                limits = ('maxInputTokens', 'maxOutputTokens')
                if type(tariff) is not dict or set(tariff) != set(rates + limits) or any(not isinstance(tariff[key], str) for key in rates): return False
                for key in limits:
                    if type(tariff[key]) not in (int, float): return False
                    try:
                        if not math.isfinite(tariff[key]): return False
                    except OverflowError: return False
        return True
    if path == '/api/sessions':
        if set(body) != {'sessions'} or type(body['sessions']) is not list: return False
        for item in body['sessions']:
            if (type(item) is not dict or not {'id', 'status', 'title', 'createdAt', 'updatedAt'}.issubset(item)
                    or set(item) - {'id', 'status', 'title', 'createdAt', 'updatedAt', 'activityTypes'}
                    or not valid_uuid(item['id']) or item['status'] not in ('active', 'deleting')
                    or not isinstance(item['title'], str) or not 1 <= len(item['title'].strip()) <= 100): return False
            for key in ('createdAt', 'updatedAt'):
                try:
                    if not isinstance(item[key], str) or datetime.fromisoformat(item[key].replace('Z', '+00:00')).tzinfo is None: return False
                except ValueError: return False
            if 'activityTypes' in item and (type(item['activityTypes']) is not list or any(value not in ('chat', 'image', 'commerce', 'poster') for value in item['activityTypes'])): return False
        return True
    return False


def request_digest(request):
    normalized = dict(request)
    for key in ('createdAt', 'expiresAt'):
        value = normalized.get(key)
        if type(value) is float and value.is_integer(): normalized[key] = int(value)
    return hashlib.sha256((json.dumps(normalized, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()).hexdigest()


def verify(request, fetch, now=time.time):
    if type(request) is dict and request.get('verifierProtocol') == 'zimage-legacy-readonly-v1':
        return verify_legacy(request, fetch, now)
    if (set(request) != {'schemaVersion', 'operationId', 'backendRelease', 'pid', 'nonce', 'createdAt', 'expiresAt'}
            or type(request['schemaVersion']) is not int or request['schemaVersion'] != 1
            or not re.fullmatch(r'[a-f0-9]{40}', request['backendRelease'])
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{6,79}', request['operationId'])
            or not re.fullmatch(r'[a-f0-9]{64}', request['nonce'])
            or type(request['pid']) is not int or request['pid'] <= 0
            or type(request['createdAt']) not in (int, float) or type(request['expiresAt']) not in (int, float)
            or not request['createdAt'] <= now() <= request['expiresAt']
            or not 0 < request['expiresAt'] - request['createdAt'] <= 120):
        raise ValueError('Invalid, expired or unbounded verification request')
    checks, identity = [], None
    for path in PATHS:
        status, headers, body = fetch(path)
        if status != 200 or not isinstance(body, dict) or not validate_body(path, body):
            raise RuntimeError('Read-only verification failed at ' + path)
        private = path not in PATHS[:2]
        no_store = 'no-store' in headers.get('cache-control', '').lower()
        if not no_store: raise RuntimeError('Read-only response is not no-store at ' + path)
        if path == CATALOG_PATH and headers.get(PROBE_HEADER) != CATALOG_PROBE:
            raise RuntimeError('Strict read-only catalog marker missing')
        if path == '/api/health/ready' and body.get('version') != request['backendRelease']:
            raise RuntimeError('Public ready version mismatch')
        if path == '/api/meta' and (body.get('schemaVersion') != 1 or body.get('backendRelease') != request['backendRelease']):
            raise RuntimeError('Public metadata version mismatch')
        if path == '/api/auth/session':
            identity = body.get('id')
            if not valid_uuid(identity): raise RuntimeError('Verified session unavailable')
        if path == '/api/account' and (body.get('id') != identity or body.get('status') != 'active'):
            raise RuntimeError('Account/session identity mismatch or inactive account')
        checks.append({'path': path, 'status': status, 'noStore': no_store, 'authenticated': private})
    # Detect version drift during the read-only suite.
    status, _, body = fetch('/api/meta')
    if status != 200 or body.get('backendRelease') != request['backendRelease'] or now() > request['expiresAt']:
        raise RuntimeError('Version changed or read-only evidence expired')
    return {'schemaVersion': 1, 'verifierProtocol': PROTOCOL,
            'operationId': request['operationId'], 'backendRelease': request['backendRelease'], 'pid': request['pid'],
            'nonce': request['nonce'], 'requestSha256': request_digest(request), 'checkedAt': now(),
            'checks': checks, 'authenticatedReadOnly': True, 'independentPublic': True, 'catalogReady': True}


def verify_legacy(request, fetch, now=time.time):
    # B0 genuinely has neither /api/meta, a lifecycle socket nor the catalog-v2
    # marker. This separate protocol claims only the three safe old reads.
    spec = importlib.util.spec_from_file_location('legacy_readonly_protocol', Path(__file__).with_name('first_window.py'))
    protocol = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(protocol)
    protocol.validate_legacy_request(request, operation=request.get('operationId'), release=request.get('backendRelease'),
                                     pid=request.get('pid'), now=now())
    checks = []
    for index, path in enumerate(protocol.LEGACY_PATHS):
        status, headers, body = fetch(path)
        if (status != 200 or type(body) is not dict or not validate_body(path, body)
                or 'no-store' not in headers.get('cache-control', '').lower()):
            raise RuntimeError('Legacy safe-read verification failed')
        if path == '/api/health/ready' and body.get('version') != request['backendRelease']:
            raise RuntimeError('Genuine legacy ready release mismatch')
        checks.append({'path': path, 'status': 200, 'noStore': True, 'authenticated': index > 0})
    status, headers, body = fetch('/api/health/ready')
    if (status != 200 or body.get('version') != request['backendRelease'] or now() > request['expiresAt']
            or 'no-store' not in headers.get('cache-control', '').lower()):
        raise RuntimeError('Legacy ready drift during safe reads')
    result = {key: request[key] for key in ('schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'processStart', 'nonce')}
    result.update(requestSha256=protocol.digest(request), checkedAt=now(), checks=checks,
                  authenticatedReadOnly=True, independentPublic=True)
    return protocol.validate_legacy_receipt(result, request, operation=request['operationId'], release=request['backendRelease'], pid=request['pid'], now=now())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_): return None


def public_fetch(cookie):
    if not cookie or '\r' in cookie or '\n' in cookie: raise ValueError('Existing authorized ZIMAGE_AUTH_COOKIE required')
    parsed, jar = SimpleCookie(), CookieJar()
    parsed.load(cookie)
    if not parsed: raise ValueError('Invalid verification cookie')
    for key, value in parsed.items():
        jar.set_cookie(Cookie(0, key, value.value, None, False, 'www.zimage.store', False, False, '/', True, True, None, True, None, None, {}))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPCookieProcessor(jar))
    def fetch(path):
        if path not in PATHS: raise ValueError('Verifier only permits fixed read-only routes')
        headers = {'Accept': 'application/json'}
        if path == CATALOG_PATH: headers[PROBE_HEADER] = CATALOG_PROBE
        request = urllib.request.Request(ORIGIN + path, headers=headers)
        with opener.open(request, timeout=12) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000: raise ValueError('Read-only response exceeds bound')
            return response.status, {key.lower(): value for key, value in response.headers.items()}, json.loads(raw)
    return fetch


def serve(source, destination, fetch, now=time.time):
    """One in-memory cookie jar can serve candidate and recovery nonces.

    NDJSON contains only requests and redacted evidence. It never returns Cookie
    headers, identities, tokens, or private response bodies to the CLI.
    """
    print(json.dumps({'schemaVersion': 1, 'ready': True}), file=destination, flush=True)
    while True:
        line = source.readline(4097)
        if not line: return
        if len(line.encode('utf-8')) > 4096 or not line.endswith('\n'):
            print(json.dumps({'schemaVersion': 1, 'verificationFailed': True}), file=destination, flush=True)
            return
        try:
            receipt = verify(json.loads(line), fetch, now=now)
            print(json.dumps(receipt, sort_keys=True), file=destination, flush=True)
        except Exception:
            print(json.dumps({'schemaVersion': 1, 'verificationFailed': True}), file=destination, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--request', type=Path)
    mode.add_argument('--stdio', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    fetch = public_fetch(os.environ.get('ZIMAGE_AUTH_COOKIE', ''))
    if args.stdio:
        if args.output is not None: raise ValueError('Stdio verification keeps cookies only in memory')
        serve(sys.stdin, sys.stdout, fetch)
        return
    if args.output is None: raise ValueError('A new receipt output path is required')
    if args.request.stat().st_size > 4096: raise ValueError('Verification request exceeds bound')
    result = verify(json.loads(args.request.read_text()), fetch)
    # Never include the cookie, owner, email, token, or response bodies in evidence.
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(result, stream, sort_keys=True); stream.write('\n')
    print('Exact-version read-only receipt written; root installation and production acceptance remain separate.')


if __name__ == '__main__':
    try: main()
    except Exception:
        # Network exceptions can contain URL/cookie fragments; keep CLI failures bounded.
        raise SystemExit('Read-only verification failed; no receipt generated.')
