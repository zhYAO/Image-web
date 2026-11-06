#!/usr/bin/env python3
"""User-started local GET verifier. Never supplies a release or migration action.

The login Cookie is entered at a real hidden terminal prompt and stays only in
the fixed verifier's in-memory CookieJar. Only public challenges and redacted
receipts are exchanged through a private local directory.
"""
import argparse
import getpass
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import warnings

spec = importlib.util.spec_from_file_location('local_fixed_get_verifier', Path(__file__).with_name('verify.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
OP = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{6,79}')
SHA40, SHA64 = re.compile(r'[a-f0-9]{40}'), re.compile(r'[a-f0-9]{64}')

def read_cookie():
    if not sys.stdin.isatty():
        raise ValueError('A real local terminal with hidden input is required')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        cookie = getpass.getpass('Existing Zimage test-session Cookie (hidden, local only): ')
    if not cookie or len(cookie) > 65536 or any(ord(c) < 32 or ord(c) == 127 for c in cookie):
        raise ValueError('Invalid local session input')
    return cookie

def safe_ancestors(path):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Absolute unlinked session path required')
    for item in (path, *path.parents):
        if item.is_symlink(): raise ValueError('Linked session ancestor')

def validate_scope(root, operation, releases, duration):
    root = Path(root)
    if (os.geteuid() == 0 or not OP.fullmatch(operation) or not 1 <= len(releases) <= 2
            or any(not SHA40.fullmatch(r) for r in releases) or type(duration) is not int or not 60 <= duration <= 1200):
        raise ValueError('Invalid local-only verifier session scope')
    safe_ancestors(root)
    if os.path.lexists(root): raise FileExistsError('Session directory already exists')
    if not root.parent.is_dir(): raise ValueError('Session parent directory is missing')
    return root

def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode, info.st_nlink, info.st_uid)

def private_file(path):
    safe_ancestors(path)
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid()
            or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1 or before.st_size > 4096):
        raise ValueError('Request must be a bounded private regular file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        if identity(os.fstat(stream.fileno())) != identity(before): raise ValueError('Request changed before read')
        body = stream.read(4097)
        if len(body) > 4096 or identity(os.fstat(stream.fileno())) != identity(before): raise ValueError('Request changed during read')
    if identity(path.lstat()) != identity(before): raise ValueError('Request path changed during read')
    return body

def parse(body):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise ValueError('Duplicate request field')
            result[key] = value
        return result
    return json.loads(body, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))

def write_private(path, value, before_publish=None):
    safe_ancestors(path)
    descriptor, name = tempfile.mkstemp(prefix='.receipt-', dir=path.parent)
    pending = Path(name)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, sort_keys=True, allow_nan=False); stream.write('\n')
            stream.flush(); os.fsync(stream.fileno())
        # Publish without replacement. The short-lived second hardlink is
        # removed before reporting availability to the operator.
        if before_publish is not None: before_publish()
        os.link(pending, path, follow_symlinks=False)
        pending.unlink()
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        pending.unlink(missing_ok=True)

class PrivateSession:
    @classmethod
    def create(cls, root, operation, releases, duration=1200, now=time.time):
        root = validate_scope(root, operation, releases, duration)
        root.mkdir(mode=0o700)
        result = cls(); result.root, result.operation, result.releases = root, operation, set(releases)
        result.now, result.expires = now, now() + duration
        result.deadline = time.monotonic() + duration
        result.seen, result.last_digest = {}, None
        result.check_directory()
        write_private(root / 'ready.json', {'schemaVersion': 1, 'operationId': operation,
            'allowedBackendReleases': sorted(releases), 'pid': os.getpid(), 'expiresAt': result.expires, 'ready': True})
        return result

    def check_directory(self):
        safe_ancestors(self.root); info = self.root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('Session directory trust changed')

    def check_live(self):
        if self.now() > self.expires or time.monotonic() > self.deadline:
            raise ValueError('Local authorization session expired')

    def check_publishable(self):
        self.check_live()
        self.check_directory()

    def valid_request(self, r):
        if (type(r) is not dict or set(r) != {'schemaVersion','operationId','backendRelease','pid','nonce','createdAt','expiresAt'}
                or type(r['schemaVersion']) is not int or r['schemaVersion'] != 1 or r['operationId'] != self.operation
                or r['backendRelease'] not in self.releases or type(r['pid']) is not int or r['pid'] <= 0
                or not isinstance(r['nonce'], str) or not SHA64.fullmatch(r['nonce'])): return False
        start, end = r['createdAt'], r['expiresAt']
        return (type(start) in (int,float) and type(end) in (int,float) and math.isfinite(start) and math.isfinite(end)
            and 0 < end - start <= 120 and start <= self.now() <= end)

    def consume(self, fetch):
        try:
            self.check_directory()
            self.check_live()
            body = private_file(self.root / 'request.json'); digest = hashlib.sha256(body).hexdigest()
            if digest == self.last_digest: return 'ignored'
            self.last_digest = digest
            request = parse(body)
            if not self.valid_request(request): return 'rejected'
            nonce = request['nonce']
            if nonce in self.seen or len(self.seen) >= 8: return 'rejected'
            self.seen[nonce] = verifier.request_digest(request)
        except FileNotFoundError: return 'ignored'
        except Exception: return 'rejected'
        try:
            def bounded_fetch(route):
                self.check_live()
                result = fetch(route)
                self.check_live()
                return result
            result = verifier.verify(request, bounded_fetch, now=self.now)
            self.check_live()
            self.check_directory()
            write_private(self.root / ('receipt-' + nonce + '.json'), result, before_publish=self.check_publishable)
            return 'verified'
        except Exception:
            try:
                self.check_directory()
                write_private(self.root / ('failure-' + nonce + '.json'), {'schemaVersion': 1, 'nonce': nonce, 'verificationFailed': True})
            except Exception: pass
            return 'failed'

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--session-dir', type=Path, required=True)
    p.add_argument('--operation', required=True)
    p.add_argument('--release', action='append', required=True)
    p.add_argument('--duration', type=int, default=1200)
    args = p.parse_args()
    validate_scope(args.session_dir, args.operation, set(args.release), args.duration)
    # Do not publish readiness until hidden input and the fixed CookieJar exist.
    cookie = read_cookie()
    fetch = verifier.public_fetch(cookie)
    del cookie
    session = PrivateSession.create(args.session_dir, args.operation, set(args.release), args.duration)
    print(json.dumps({'ready': True, 'sessionDirectory': str(session.root), 'expiresAt': session.expires}), flush=True)
    while time.time() <= session.expires and time.monotonic() <= session.deadline and len(session.seen) < 8:
        outcome = session.consume(fetch)
        if outcome != 'ignored': print(json.dumps({'verification': outcome}), flush=True)
        time.sleep(0.25)
    print('Local read-only verifier finished; no credential file was written.', flush=True)

if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: raise SystemExit('Local read-only verifier stopped.')
    except Exception: raise SystemExit('Local read-only verifier unavailable; no credential is displayed.')
