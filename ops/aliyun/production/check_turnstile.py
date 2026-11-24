"""Fail closed on absent, malformed, or published Cloudflare test site keys."""

import os
import re
import sys


# These values are public fixture keys, not credentials.
TEST_KEYS = frozenset({
    '1x00000000000000000000AA',
    '2x00000000000000000000AB',
    '1x00000000000000000000BB',
    '2x00000000000000000000BB',
    '3x00000000000000000000FF',
})


def main():
    key = os.environ.get('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
    # Accept a bounded identifier, without guessing an undocumented vendor prefix.
    if not re.fullmatch(r'[A-Za-z0-9_-]{20,100}', key) or key in TEST_KEYS:
        sys.exit('Production requires a configured, non-test Turnstile site key.')


if __name__ == '__main__':
    main()
