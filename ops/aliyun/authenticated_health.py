"""Account/session post-login smoke check using an existing test account cookie.

Set ZIMAGE_AUTH_COOKIE in the shell and run this from a trusted machine. The
cookie is never logged or written to disk by this script. Wallet and ledger GETs
are excluded because they can initialize wallets and welcome credits.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import urljoin


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def check(base: str, cookie: str) -> str:
    if not cookie or '\r' in cookie or '\n' in cookie:
        raise ValueError('A valid ZIMAGE_AUTH_COOKIE is required')
    if not base.startswith('https://'):
        raise ValueError('Authenticated smoke checks require HTTPS')
    opener = urllib.request.build_opener(NoRedirect())
    account_id = ''
    for path in ('/api/account', '/api/sessions'):
        request = urllib.request.Request(
            urljoin(base.rstrip('/') + '/', path.lstrip('/')),
            headers={'Cookie': cookie, 'Accept': 'application/json'},
        )
        try:
            with opener.open(request, timeout=12) as response:
                if response.status != 200:
                    raise RuntimeError(f'{path} returned HTTP {response.status}')
                body = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'{path} returned HTTP {error.code}') from error
        if path == '/api/account':
            account_id = body.get('id', '') if isinstance(body, dict) else ''
            if not account_id or body.get('status') != 'active':
                raise RuntimeError('Account response did not identify an active user')
        elif not isinstance(body, dict):
            raise RuntimeError(f'{path} returned invalid JSON')
    return account_id


if __name__ == '__main__':
    try:
        check(
            os.environ.get('ZIMAGE_HEALTH_BASE', 'https://www.zimage.store'),
            os.environ.get('ZIMAGE_AUTH_COOKIE', ''),
        )
        print('Authenticated account and sessions healthy')
    except (ValueError, RuntimeError, urllib.error.URLError) as error:
        print(f'Authenticated health check failed: {error}', file=sys.stderr)
        raise SystemExit(1)
