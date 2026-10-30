"""Fail-closed receipt transport kernel; no network, service or CLI operations.

The fixed privileged caller authenticates its tools, request/journal files,
incoming directory FD and private parent. Incoming JSON cannot supply authority.
This module never installs a receipt or changes admission; the caller installs
the returned DTO with its root-only atomic writer after a final state check.
"""
import copy
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
import time

MAX_BYTES = 65536
FILENAME = 'backend-readonly-receipt.json'
PATHS = ('/api/health/ready', '/api/meta', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing')
PROTOCOL = 'zimage-backend-readonly-v2'
REQUEST_KEYS = {'schemaVersion', 'operationId', 'backendRelease', 'pid', 'nonce', 'createdAt', 'expiresAt'}
RECEIPT_KEYS = {'schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'nonce', 'requestSha256',
                'checkedAt', 'checks', 'authenticatedReadOnly', 'independentPublic', 'catalogReady'}


def exact(value, fields):
    if type(value) is not dict or set(value) != set(fields): raise ValueError('Receipt schema fields rejected')


def identifier(value, pattern):
    if not isinstance(value, str) or re.fullmatch(pattern, value) is None: raise ValueError('Receipt identity rejected')


def positive_integer(value):
    if type(value) is not int or not 1 <= value <= 2147483647: raise ValueError('Receipt integer rejected')


def timestamp(value):
    if type(value) not in (int, float) or not 0 <= value <= 9007199254740991 or not math.isfinite(value):
        raise ValueError('Receipt timestamp rejected')
    return value


def request_digest(request):
    canonical = copy.deepcopy(request)
    for field in ['createdAt', 'expiresAt']:
        value = canonical.get(field)
        if type(value) is float and value.is_integer(): canonical[field] = int(value)
    return hashlib.sha256((json.dumps(canonical, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()).hexdigest()


def validate_request(request, *, operation, release, pid, now):
    identifier(operation, r'[A-Za-z0-9][A-Za-z0-9._-]{6,79}')
    identifier(release, r'[a-f0-9]{40}')
    positive_integer(pid)
    exact(request, REQUEST_KEYS)
    if type(request['schemaVersion']) is not int or request['schemaVersion'] != 1: raise ValueError('Request schema rejected')
    identifier(request['nonce'], r'[a-f0-9]{64}')
    positive_integer(request['pid'])
    if request['operationId'] != operation or request['backendRelease'] != release or request['pid'] != pid:
        raise ValueError('Request differs from trusted operation/version/process')
    created, expires, current = timestamp(request['createdAt']), timestamp(request['expiresAt']), timestamp(now)
    if not created <= current <= expires or not 0 < expires - created <= 120:
        raise ValueError('Request expired, future or unbounded')


def validate_receipt(receipt, request, *, operation, release, pid, now):
    """Shared by accept transport and SystemOps.check; never coerce wire types."""
    validate_request(request, operation=operation, release=release, pid=pid, now=now)
    exact(receipt, RECEIPT_KEYS)
    if type(receipt['schemaVersion']) is not int or receipt['schemaVersion'] != 1 or receipt['verifierProtocol'] != PROTOCOL:
        raise ValueError('Receipt protocol rejected')
    positive_integer(receipt['pid'])
    if receipt['operationId'] != operation or receipt['backendRelease'] != release or receipt['pid'] != pid:
        raise ValueError('Receipt differs from trusted operation/version/process')
    identifier(receipt['nonce'], r'[a-f0-9]{64}')
    identifier(receipt['requestSha256'], r'[a-f0-9]{64}')
    if not hmac.compare_digest(receipt['nonce'], request['nonce']) or not hmac.compare_digest(receipt['requestSha256'], request_digest(request)):
        raise ValueError('Receipt request/nonce binding rejected')
    if not request['createdAt'] <= timestamp(receipt['checkedAt']) <= now <= request['expiresAt']:
        raise ValueError('Receipt is stale or future')
    if any(receipt[key] is not True for key in ['authenticatedReadOnly', 'independentPublic', 'catalogReady']):
        raise ValueError('Receipt is not an exact successful verification')
    checks = receipt['checks']
    if type(checks) is not list or len(checks) != len(PATHS): raise ValueError('Receipt checks incomplete')
    for position, (check, path) in enumerate(zip(checks, PATHS)):
        exact(check, ['path', 'status', 'noStore', 'authenticated'])
        if check['path'] != path or type(check['status']) is not int or check['status'] != 200 or check['noStore'] is not True or type(check['authenticated']) is not bool or check['authenticated'] != (position >= 2):
            raise ValueError('Receipt check DTO rejected')
    # The returned object has no aliases into untrusted caller/input dictionaries.
    return copy.deepcopy(receipt)


def validate_journal(journal, *, operation, release):
    if type(journal) is dict and journal.get('kind') == 'first-window':
        allowed = {'schemaVersion', 'kind', 'operationId', 'sequence', 'old', 'target', 'oldPid', 'frontend',
                   'writesOpened', 'phase', 'verificationTarget', 'policySha256', 'completionSha256', 'oldProcess', 'candidatePid', 'candidateProcess', 'recoveryPid', 'recoveryProcess'}
        if (set(journal) - allowed or journal.get('phase') != 'checking' or journal.get('verificationTarget') != release
                or journal.get('target') != release or journal.get('operationId') != operation or journal.get('writesOpened') is not False
                or type(journal.get('schemaVersion')) is not int or journal['schemaVersion'] != 1):
            raise ValueError('First-window candidate verification journal rejected')
        for field in ('old', 'target'): identifier(journal.get(field), r'[a-f0-9]{40}')
        for field in ('frontend', 'policySha256'): identifier(journal.get(field), r'[a-f0-9]{64}')
        positive_integer(journal.get('oldPid'))
        positive_integer(journal.get('sequence'))
        return
    fields = {'schemaVersion', 'operationId', 'sequence', 'old', 'target', 'oldPid', 'frontend', 'writesOpened', 'phase', 'verificationTarget'}
    if type(journal) is not dict or not fields.issubset(journal) or set(journal) - fields - {'candidatePid', 'recoveryPid'}:
        raise ValueError('Verification journal schema rejected')
    if type(journal['schemaVersion']) is not int or journal['schemaVersion'] != 1 or journal['operationId'] != operation or journal['writesOpened'] is not False:
        raise ValueError('Verification journal operation/admission rejected')
    positive_integer(journal['sequence'])
    positive_integer(journal['oldPid'])
    identifier(journal['old'], r'[a-f0-9]{40}')
    identifier(journal['target'], r'[a-f0-9]{40}')
    identifier(journal['frontend'], r'[a-f0-9]{64}')
    for optional in ['candidatePid', 'recoveryPid']:
        if optional in journal: positive_integer(journal[optional])
    if journal['verificationTarget'] != release: raise ValueError('Verification journal exact target rejected')
    if journal['phase'] == 'checking':
        if journal['target'] != release: raise ValueError('Candidate verification target rejected')
    elif journal['phase'] == 'checking_recovery':
        if journal['old'] != release: raise ValueError('Recovery verification target rejected')
    else: raise ValueError('Journal is not awaiting candidate/recovery checks')


def parse(body):
    if type(body) is not bytes or not 0 < len(body) <= MAX_BYTES: raise ValueError('Receipt bytes exceed bound')
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value: raise ValueError('Duplicate receipt JSON field')
            value[key] = item
        return value
    try:
        return json.loads(body, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite receipt JSON')))
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ValueError('Receipt JSON incomplete or invalid') from error


def signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode, info.st_uid, info.st_nlink


def read_fd(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    body = bytearray()
    while True:
        block = os.read(fd, min(16384, MAX_BYTES + 1 - len(body)))
        if not block: return bytes(body)
        body.extend(block)
        if len(body) > MAX_BYTES: raise ValueError('Receipt bytes exceed bound')


def accept_incoming(incoming_fd, private_parent, *, request, journal, operation, release, pid,
                    current_release, live_pid, expected_sha256, now=time.time, owner_uid=0,
                    request_validator=None, receipt_validator=None, journal_validator=None):
    """Copy fixed incoming name once, validate private bytes, recheck authority.

    `journal` should be a fresh root-only reader; the other callbacks come from
    trusted SystemOps. Paths and owner_uid are DI for offline tests, never CLI
    arguments. The caller must authenticate all fixed directory ancestors.
    """
    identifier(expected_sha256, r'[a-f0-9]{64}')
    request_validator = request_validator or validate_request
    receipt_validator = receipt_validator or validate_receipt
    journal_validator = journal_validator or validate_journal
    if not callable(current_release) or not callable(live_pid): raise ValueError('Trusted process readers required')
    request_snapshot = copy.deepcopy(request)
    def context():
        current_time = now() if callable(now) else now
        request_validator(request_snapshot, operation=operation, release=release, pid=pid, now=current_time)
        record = copy.deepcopy(journal() if callable(journal) else journal)
        journal_validator(record, operation=operation, release=release)
        actual_pid = live_pid()
        if type(actual_pid) is not int or actual_pid != pid or current_release() != release:
            raise ValueError('Live exact backend/process changed')
        return record, current_time
    original_journal, _ = context()
    if not stat.S_ISDIR(os.fstat(incoming_fd).st_mode): raise ValueError('Incoming FD must be a trusted directory')
    private_parent = Path(private_parent)
    private_info = private_parent.lstat()
    if not stat.S_ISDIR(private_info.st_mode) or private_info.st_uid != owner_uid or stat.S_IMODE(private_info.st_mode) != 0o700:
        raise ValueError('Private receipt stage must be owner-only directory')
    private_fd = os.open(private_parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    source_fd, temporary_fd, temporary_name = None, None, None
    try:
        if signature(private_info) != signature(os.fstat(private_fd)): raise ValueError('Private stage changed before open')
        source_fd = os.open(FILENAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=incoming_fd)
        before = os.fstat(source_fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= MAX_BYTES:
            raise ValueError('Incoming receipt must be bounded single-link regular file')
        temporary_name = '.receipt-' + secrets.token_hex(16)
        temporary_fd = os.open(temporary_name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=private_fd)
        os.fchmod(temporary_fd, 0o600)
        hasher, total = hashlib.sha256(), 0
        while True:
            block = os.read(source_fd, min(16384, MAX_BYTES + 1 - total))
            if not block: break
            total += len(block)
            if total > before.st_size: raise ValueError('Incoming receipt grew during copy')
            hasher.update(block)
            view = memoryview(block)
            while view:
                written = os.write(temporary_fd, view)
                if written <= 0: raise ValueError('Private receipt copy incomplete')
                view = view[written:]
        os.fsync(temporary_fd)
        if total != before.st_size or signature(before) != signature(os.fstat(source_fd)):
            raise ValueError('Incoming receipt changed during copy')
        if not hmac.compare_digest(hasher.hexdigest(), expected_sha256):
            raise ValueError('Receipt differs from independently supplied verifier artifact digest')
        sealed = os.fstat(temporary_fd)
        if not stat.S_ISREG(sealed.st_mode) or sealed.st_nlink != 1 or sealed.st_uid != owner_uid or stat.S_IMODE(sealed.st_mode) != 0o600:
            raise ValueError('Private receipt copy is untrusted')
        body = read_fd(temporary_fd)
        if len(body) != total or hashlib.sha256(body).hexdigest() != hasher.hexdigest() or signature(sealed) != signature(os.fstat(temporary_fd)):
            raise ValueError('Private receipt copy digest changed')
        _, checked_now = context()
        result = receipt_validator(parse(body), request_snapshot, operation=operation, release=release, pid=pid, now=checked_now)
        # Revalidate the exact sealed bytes and its directory entry after all
        # schema work, not a second read of uploader-controlled incoming.
        reread = read_fd(temporary_fd)
        path_info = os.stat(temporary_name, dir_fd=private_fd, follow_symlinks=False)
        if reread != body or hashlib.sha256(reread).hexdigest() != hasher.hexdigest() or signature(sealed) != signature(os.fstat(temporary_fd)) or signature(sealed) != signature(path_info) or signature(before) != signature(os.fstat(source_fd)):
            raise ValueError('Receipt changed after validation')
        current_journal, _ = context()
        if current_journal != original_journal or request != request_snapshot:
            raise ValueError('Trusted verification context changed')
        return result
    finally:
        if temporary_fd is not None: os.close(temporary_fd)
        if source_fd is not None: os.close(source_fd)
        if temporary_name is not None: os.unlink(temporary_name, dir_fd=private_fd)
        os.close(private_fd)
