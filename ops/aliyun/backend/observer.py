"""Independent ingress diagnostic window; never authorizes backend completion.

Only the two reviewed marker files are changed. The runtime adapter is read-only.
A crashed observer requires explicit cancel; no watchdog/restart guarantee exists.
"""
import contextlib
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
import shlex
import tempfile

LIMIT = 65536
COVERAGE = ('public-http', 'public-https', 'existing-http2', 'loopback', 'direct-bind', 'internal-callers')
CONFIG_PATHS = frozenset(('/etc/nginx/nginx.conf', '/etc/nginx/mime.types',
    '/etc/nginx/sites-available/zimage.conf', '/etc/nginx/zimage-ingress-maintenance-maps.conf',
    '/etc/nginx/zimage-ingress-maintenance-server.conf'))
HELPERS = ('observer.py', 'ingress-observe.py')
LIVE = ('release', 'process', 'currentTarget', 'nginxMaster', 'nginxWorkers', 'configFiles', 'helperFiles')
PHASES = ('preparing', 'sealing', 'sealed', 'cancelling', 'cancelled', 'needs_attention')
INTENTS = ('prepare', 'create-maintenance', 'remove-open', 'observe', 'create-open', 'remove-maintenance', 'finish')


class ObserverError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class WindowFinished(ObserverError): pass


def require(condition, code):
    if not condition: raise ObserverError(code)


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def sha(body): return hashlib.sha256(body).hexdigest()


def strict_json(body):
    require(type(body) is bytes and len(body) <= LIMIT, 'JSON_SIZE')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'JSON_DUPLICATE')
            result[key] = value
        return result
    def invalid(value): raise ObserverError('JSON_NUMBER')
    try:
        return json.loads(body.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)
    except (ValueError, UnicodeError, RecursionError): raise ObserverError('JSON_INVALID') from None


def exact(value, keys, code):
    require(type(value) is dict and set(value) == set(keys), code)


def digest(value, code):
    require(type(value) is str and re.fullmatch(r'[a-f0-9]{64}', value) is not None, code)


def number(value): return type(value) in (int, float) and math.isfinite(value)


def identity(value, code):
    exact(value, ('pid', 'startTicks', 'bootId'), code)
    require(type(value['pid']) is int and 0 < value['pid'] < 2147483648 and
            type(value['startTicks']) is int and value['startTicks'] > 0 and
            type(value['bootId']) is str and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', value['bootId']) is not None, code)


def validate_policy(value, now, fresh):
    code = 'POLICY_SCHEMA'
    exact(value, ('schemaVersion', 'protocol', 'operationId', 'release', 'process', 'currentTarget',
                  'nginxMaster', 'nginxWorkers', 'configFiles', 'helperFiles', 'closureSha256',
                  'loadedReceiptSha256', 'openSha256', 'issuedAt', 'expiresAt'), code)
    require(type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and
            value['protocol'] == 'zimage-ingress-observer-policy-v1' and
            type(value['operationId']) is str and re.fullmatch(r'[a-z0-9][a-z0-9-]{7,63}', value['operationId']) is not None and
            type(value['release']) is str and re.fullmatch(r'[a-f0-9]{40}', value['release']) is not None and
            value['currentTarget'] == '/opt/zimage/releases/' + value['release'], code)
    identity(value['process'], code); identity(value['nginxMaster'], code)
    workers = value['nginxWorkers']
    require(type(workers) is list and 1 <= len(workers) <= 128, code)
    for worker in workers: identity(worker, code)
    pids = [value['nginxMaster']['pid']] + [worker['pid'] for worker in workers]
    require(len(set(pids)) == len(pids) and workers == sorted(workers, key=lambda item: item['pid']), code)
    for key in ('closureSha256', 'loadedReceiptSha256', 'openSha256'): digest(value[key], code)
    configs = value['configFiles']
    require(type(configs) is list and 1 <= len(configs) <= len(CONFIG_PATHS), code)
    paths = []
    for entry in configs:
        exact(entry, ('path', 'sha256'), code); digest(entry['sha256'], code)
        require(type(entry['path']) is str and entry['path'] in CONFIG_PATHS, code); paths.append(entry['path'])
    require(len(set(paths)) == len(paths) and set(paths) == CONFIG_PATHS and paths == sorted(paths), code)
    require(value['closureSha256'] == sha(encode(configs)), code)
    helpers = value['helperFiles']
    require(type(helpers) is list and len(helpers) == len(HELPERS), code)
    for entry, name in zip(helpers, HELPERS):
        exact(entry, ('name', 'sha256'), code); require(entry['name'] == name, code); digest(entry['sha256'], code)
    require(number(value['issuedAt']) and number(value['expiresAt']) and
            0 < value['expiresAt'] - value['issuedAt'] <= 86400, 'POLICY_TIME')
    if fresh: require(value['issuedAt'] <= now <= value['expiresAt'], 'POLICY_TIME')
    return value


def validate_receipt(value, policy, now):
    code = 'RECEIPT_SCHEMA'
    common = ('operationId', 'release', 'process', 'currentTarget', 'nginxMaster', 'nginxWorkers', 'closureSha256')
    exact(value, ('schemaVersion', 'protocol', *common, 'oldGenerationsExited', 'coverage', 'reviewedAt'), code)
    require(type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and
            value['protocol'] == 'zimage-ingress-loaded-receipt-v1' and value['oldGenerationsExited'] is True, code)
    identity(value['process'], code); identity(value['nginxMaster'], code)
    require(type(value['nginxWorkers']) is list, code)
    for worker in value['nginxWorkers']: identity(worker, code)
    require(all(value[key] == policy[key] for key in common), 'RECEIPT_BINDING')
    require(number(value['reviewedAt']) and policy['issuedAt'] <= value['reviewedAt'] <= min(now, policy['expiresAt']), code)
    entries = value['coverage']
    require(type(entries) is list and len(entries) == len(COVERAGE), code)
    for entry, category in zip(entries, COVERAGE):
        exact(entry, ('category', 'boundarySha256', 'outcome'), code)
        require(entry['category'] == category and entry['outcome'] == 'reviewed-gate-boundary', code)
        digest(entry['boundarySha256'], code)



def validate_config_closure(bodies):
    """Conservative fixed include graph; unsupported syntax refuses observation."""
    require(type(bodies) is dict and set(bodies) == CONFIG_PATHS, 'CONFIG_CLOSURE')
    graph = {}
    for path, contents in bodies.items():
        require(type(contents) is bytes and len(contents) <= LIMIT and b'\\' not in contents, 'CONFIG_CLOSURE')
        try:
            lexer = shlex.shlex(contents.decode('utf-8'), posix=True, punctuation_chars='{};')
            lexer.whitespace_split = True; lexer.commenters = '#'
            tokens = []
            for token in lexer:
                tokens.extend(token if token and set(token) <= set('{};') else [token])
        except (ValueError, UnicodeError): raise ObserverError('CONFIG_CLOSURE') from None
        references = set(); statement = []
        for token in tokens:
            if token in ('{', '}', ';'):
                if statement and statement[0] == 'include':
                    require(token == ';' and len(statement) == 2 and statement[1] in CONFIG_PATHS, 'CONFIG_CLOSURE')
                    references.add(statement[1])
                statement = []
            else: statement.append(token)
        require(not statement or statement[0] != 'include', 'CONFIG_CLOSURE')
        graph[path] = references
    reached = set(); pending = ['/etc/nginx/nginx.conf']
    while pending:
        path = pending.pop()
        if path not in reached: reached.add(path); pending.extend(graph[path] - reached)
    require(reached == CONFIG_PATHS, 'CONFIG_CLOSURE')


def validate_open(body, policy):
    require(sha(body) == policy['openSha256'], 'OPEN_BINDING')
    value = strict_json(body)
    exact(value, ('schemaVersion', 'protocol', 'operationId', 'closureSha256'), 'OPEN_BINDING')
    require(type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and
            value['protocol'] == 'zimage-ingress-observer-open-v1' and
            value['operationId'] == policy['operationId'] and value['closureSha256'] == policy['closureSha256'], 'OPEN_BINDING')


class ProtectedFS:
    """Protected ancestors plus exact bounded no-follow files.

    Production uses anchor=/ and uid=0. A test anchor confines the trusted tree.
    Concurrent hostile root writers are outside this cooperative lock contract.
    """
    def __init__(self, anchor=Path('/'), uid=0):
        self.anchor = Path(anchor).absolute(); self.uid = uid; self.failpoint = None
    def event(self, name):
        if self.failpoint: self.failpoint(name)
    def ancestors(self, path):
        path = Path(path).absolute()
        require(path == self.anchor or self.anchor in path.parents, 'PATH_TRUST')
        parents = [self.anchor]
        if path.parent != self.anchor:
            relative = path.parent.relative_to(self.anchor)
            current = self.anchor
            for part in relative.parts: current = current / part; parents.append(current)
        for parent in parents:
            info = parent.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.uid and not info.st_mode & 0o022, 'PATH_TRUST')
    def regular(self, info):
        require(stat.S_ISREG(info.st_mode) and info.st_uid == self.uid and
                info.st_nlink == 1 and not info.st_mode & 0o022 and info.st_size <= LIMIT, 'FILE_TRUST')
    @staticmethod
    def stamp(info): return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    def checked(self, path):
        self.ancestors(path)
        before = path.lstat(); self.regular(before)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            opened = os.fstat(descriptor); self.regular(opened)
            require(self.stamp(opened) == self.stamp(before), 'FILE_RACE')
            chunks = []; size = 0
            while True:
                chunk = os.read(descriptor, min(8192, LIMIT + 1 - size))
                if not chunk: break
                chunks.append(chunk); size += len(chunk)
                require(size <= LIMIT, 'FILE_TRUST')
            require(self.stamp(os.fstat(descriptor)) == self.stamp(opened), 'FILE_RACE')
            require(self.stamp(path.lstat()) == self.stamp(opened), 'FILE_RACE')
            return b''.join(chunks), opened
        finally: os.close(descriptor)
    def read(self, path): return self.checked(Path(path))[0]
    def exists(self, path): return os.path.lexists(path)
    def sync_dir(self, path):
        self.ancestors(path / 'unused')
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    def pending(self, path, body):
        require(type(body) is bytes and len(body) <= LIMIT, 'JSON_SIZE'); self.ancestors(path)
        descriptor, name = tempfile.mkstemp(prefix='.observer-', dir=path.parent)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                descriptor = None; stream.write(body); stream.flush(); os.fsync(stream.fileno())
            return Path(name)
        except BaseException:
            if descriptor is not None: os.close(descriptor)
            Path(name).unlink(missing_ok=True)
            raise
    def publish(self, path, body, before_visible=None):
        path = Path(path); self.event('publish:' + path.name + ':before')
        pending = self.pending(path, body)
        try:
            if before_visible: before_visible()
            try: os.link(pending, path, follow_symlinks=False)
            except FileExistsError: raise ObserverError('MARKER_EXISTS') from None
        finally: pending.unlink(missing_ok=True)
        self.sync_dir(path.parent)
        require(self.read(path) == body, 'MARKER_FOREIGN')
        self.event('publish:' + path.name + ':after')
    def barrier(self, path, body):
        actual, original = self.checked(path); require(actual == body, 'MARKER_FOREIGN')
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            require(self.stamp(os.fstat(descriptor)) == self.stamp(original), 'FILE_RACE')
            os.fsync(descriptor)
        finally: os.close(descriptor)
        self.sync_dir(path.parent)
        actual, current = self.checked(path)
        require(actual == body and self.stamp(current) == self.stamp(original), 'FILE_RACE')
    def remove(self, path, body):
        path = Path(path); actual, original = self.checked(path)
        require(actual == body, 'MARKER_FOREIGN')
        self.event('remove:' + path.name + ':before')
        actual, current = self.checked(path)
        require(actual == body and self.stamp(current) == self.stamp(original), 'MARKER_FOREIGN')
        path.unlink(); self.sync_dir(path.parent)
        self.event('remove:' + path.name + ':after')
    def write(self, path, body):
        path = Path(path); original = self.checked(path)[1] if self.exists(path) else None
        pending = self.pending(path, body)
        try:
            if original is None:
                try: os.link(pending, path, follow_symlinks=False)
                except FileExistsError: raise ObserverError('JOURNAL_RACE') from None
                pending.unlink()
            else:
                _, current = self.checked(path)
                require(self.stamp(current) == self.stamp(original), 'JOURNAL_RACE')
                os.replace(pending, path)
            self.sync_dir(path.parent)
        finally: pending.unlink(missing_ok=True)
    @contextlib.contextmanager
    def lock(self, path):
        # Existing common deploy lock only; never O_CREAT, unlink or replace.
        self.read(path); descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            self.regular(os.fstat(descriptor))
            require(self.stamp(os.fstat(descriptor)) == self.stamp(path.lstat()), 'FILE_RACE')
            try: fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise ObserverError('BUSY') from None
            yield
        finally: os.close(descriptor)


class Observer:
    def __init__(self, fs, paths, runtime):
        self.fs = fs; self.paths = paths; self.runtime = runtime
        self.record = None; self.policy = None; self.policy_hash = None
        self.cancel_requested = False; self.removing_maintenance = False; self.controls_verified = False
    def request_cancel(self, *_): self.cancel_requested = True
    def actual(self): return {key: self.fs.exists(self.paths[key]) for key in ('open', 'maintenance', 'checking')}
    def report(self, code, attention=False):
        markers = self.actual(); closed = False
        if self.controls_verified and markers['maintenance'] and not markers['checking'] and self.record:
            try:
                state = self.marker_state()
                closed = state['maintenance'] and not state['checking']
            except (ObserverError, OSError): pass
        return {'schemaVersion': 1, 'code': code, 'phase': self.record['phase'] if self.record else 'absent',
                'lastIntent': self.record['lastIntent'] if self.record else None,
                'operationId': self.record['operationId'] if self.record else None,
                'policySha256': self.record['policySha256'] if self.record else None,
                'markers': markers, 'needsAttention': attention,
                'admissionMayBeOpen': not closed, 'completionAuthorized': False}
    def credentials(self, fresh):
        raw = self.fs.read(self.paths['policy']); policy = validate_policy(strict_json(raw), self.runtime.wall(), fresh)
        receipt = self.fs.read(self.paths['receipt'])
        require(sha(receipt) == policy['loadedReceiptSha256'], 'RECEIPT_BINDING')
        validate_receipt(strict_json(receipt), policy, self.runtime.wall())
        self.policy = policy; self.policy_hash = sha(raw)
    def controls(self):
        self.controls_verified = False
        require(sha(self.fs.read(self.paths['policy'])) == self.policy_hash, 'POLICY_BINDING')
        require(sha(self.fs.read(self.paths['receipt'])) == self.policy['loadedReceiptSha256'], 'RECEIPT_BINDING')
        require(self.runtime.snapshot(self.policy) == {key: self.policy[key] for key in LIVE}, 'CONTROL_DRIFT')
        require(not self.fs.exists(self.paths['checking']), 'CHECKING_DRIFT')
        self.controls_verified = True
    def save(self, phase, intent, error=None):
        self.record['phase'] = phase; self.record['lastIntent'] = intent; self.record['lastError'] = error
        self.fs.write(self.paths['journal'], encode(self.record))
        event = 'journal:' + phase
        if phase in ('sealing', 'cancelling'): event += ':' + intent
        self.fs.event(event + ':after')
    def load_record(self):
        record = strict_json(self.fs.read(self.paths['journal']))
        exact(record, ('schemaVersion', 'protocol', 'operationId', 'policySha256', 'loadedReceiptSha256', 'closureSha256',
                       'phase', 'lastIntent', 'openBody', 'maintenanceBody', 'startedAt', 'deadlineAt', 'lastError'), 'JOURNAL_SCHEMA')
        require(type(record['schemaVersion']) is int and record['schemaVersion'] == 1 and
                record['protocol'] == 'zimage-ingress-observer-journal-v1' and record['phase'] in PHASES and
                record['lastIntent'] in INTENTS and number(record['startedAt']) and number(record['deadlineAt']) and
                0 < record['deadlineAt'] - record['startedAt'] <= 300 and
                (record['lastError'] is None or type(record['lastError']) is str and re.fullmatch('[A-Z_]{1,40}', record['lastError']) is not None), 'JOURNAL_SCHEMA')
        require(record['policySha256'] == self.policy_hash and record['operationId'] == self.policy['operationId'] and
                record['loadedReceiptSha256'] == self.policy['loadedReceiptSha256'] and
                record['closureSha256'] == self.policy['closureSha256'], 'POLICY_BINDING')
        require(type(record['openBody']) is str and type(record['maintenanceBody']) is str, 'JOURNAL_SCHEMA')
        validate_open(record['openBody'].encode(), self.policy)
        maintenance = strict_json(record['maintenanceBody'].encode())
        exact(maintenance, ('schemaVersion', 'protocol', 'operationId', 'policySha256', 'closureSha256', 'nonce'), 'JOURNAL_SCHEMA')
        require(type(maintenance['schemaVersion']) is int and maintenance['schemaVersion'] == 1 and
                maintenance['protocol'] == 'zimage-ingress-observer-maintenance-v1' and
                all(maintenance[key] == record[key] for key in ('operationId', 'policySha256', 'closureSha256')), 'JOURNAL_SCHEMA')
        digest(maintenance['nonce'], 'JOURNAL_SCHEMA'); self.record = record
    def marker_state(self):
        require(not self.fs.exists(self.paths['checking']), 'CHECKING_DRIFT')
        state = self.actual()
        for name, key in (('open', 'openBody'), ('maintenance', 'maintenanceBody')):
            if state[name]: require(self.fs.read(self.paths[name]) == self.record[key].encode(), 'MARKER_FOREIGN')
        require(state['open'] or state['maintenance'], 'MARKER_TUPLE')
        return state
    def _cancel(self):
        self.controls(); state = self.marker_state()
        self.save('cancelling', 'create-open')
        if not state['open']: self.fs.publish(self.paths['open'], self.record['openBody'].encode())
        self.fs.barrier(self.paths['open'], self.record['openBody'].encode())
        self.controls(); state = self.marker_state()
        self.save('cancelling', 'remove-maintenance')
        if state['maintenance']:
            self.removing_maintenance = True
            self.fs.remove(self.paths['maintenance'], self.record['maintenanceBody'].encode())
        self.controls(); state = self.marker_state()
        require(state == {'open': True, 'maintenance': False, 'checking': False}, 'MARKER_TUPLE')
        self.save('cancelled', 'finish')
        self.removing_maintenance = False
    def failure(self, code):
        self.controls_verified = False
        if self.record:
            # Once M unlink was attempted, admission may already have opened. Try
            # only an exact safe reseal, never overwrite or remove foreign state.
            if self.removing_maintenance:
                try:
                    self.controls(); state = self.marker_state()
                    if state['open'] and not state['maintenance']:
                        self.fs.publish(self.paths['maintenance'], self.record['maintenanceBody'].encode())
                except (ObserverError, OSError, ValueError): pass
            try: self.save('needs_attention', self.record['lastIntent'], code)
            except (ObserverError, OSError, ValueError): pass
        return self.report(code, True)
    def guarded(self, action, read_only=False):
        self.record = None; self.removing_maintenance = False; self.controls_verified = False
        try:
            with self.fs.lock(self.paths['lock']):
                try: return action()
                except WindowFinished as finished:
                    try:
                        self._cancel(); return self.report(finished.code)
                    except ObserverError as error: return self.failure(error.code)
                    except (OSError, ValueError): return self.failure('IO_UNCERTAIN')
                except ObserverError as error: return self.report(error.code, True) if read_only else self.failure(error.code)
                except (OSError, ValueError, KeyError, TypeError, OverflowError):
                    return self.report('IO_UNCERTAIN', True) if read_only else self.failure('IO_UNCERTAIN')
        except ObserverError as error: return self.report(error.code, True)
        except (OSError, ValueError): return self.report('IO_UNCERTAIN', True)
    def observe(self, seconds):
        def action():
            require(type(seconds) is int and 1 <= seconds <= 300, 'DURATION')
            # One operation per retained journal; no automatic history replacement.
            require(not self.fs.exists(self.paths['journal']), 'EXISTING_JOURNAL')
            self.credentials(True); self.controls()
            require(not self.fs.exists(self.paths['maintenance']), 'MARKER_EXISTS')
            opening = self.fs.read(self.paths['open']); validate_open(opening, self.policy)
            started = self.runtime.wall(); deadline = self.runtime.monotonic() + seconds
            def budget_check():
                if self.cancel_requested: raise WindowFinished('CANCEL_REQUESTED')
                if self.runtime.monotonic() >= deadline: raise WindowFinished('WINDOW_ENDED')
                if not self.policy['issuedAt'] <= self.runtime.wall() <= self.policy['expiresAt']: raise WindowFinished('POLICY_TIME')
            maintenance = {'schemaVersion': 1, 'protocol': 'zimage-ingress-observer-maintenance-v1',
                           'operationId': self.policy['operationId'], 'policySha256': self.policy_hash,
                           'closureSha256': self.policy['closureSha256'], 'nonce': secrets.token_hex(32)}
            self.record = {'schemaVersion': 1, 'protocol': 'zimage-ingress-observer-journal-v1',
                           'operationId': self.policy['operationId'], 'policySha256': self.policy_hash,
                           'loadedReceiptSha256': self.policy['loadedReceiptSha256'], 'closureSha256': self.policy['closureSha256'],
                           'phase': 'preparing', 'lastIntent': 'prepare', 'openBody': opening.decode(),
                           'maintenanceBody': encode(maintenance).decode(), 'startedAt': started,
                           'deadlineAt': started + seconds, 'lastError': None}
            self.save('preparing', 'prepare'); self.controls(); self.marker_state()
            self.save('sealing', 'create-maintenance'); budget_check()
            self.fs.publish(self.paths['maintenance'], encode(maintenance), before_visible=budget_check)
            self.controls(); self.marker_state(); budget_check(); self.save('sealing', 'remove-open'); budget_check()
            self.fs.remove(self.paths['open'], opening); self.save('sealed', 'observe')
            while not self.cancel_requested and self.runtime.monotonic() < deadline:
                self.controls()
                require(self.marker_state() == {'open': False, 'maintenance': True, 'checking': False}, 'MARKER_TUPLE')
                self.runtime.wait(min(1, max(0, deadline - self.runtime.monotonic())))
            self._cancel()
            return self.report('CANCEL_REQUESTED' if self.cancel_requested else 'WINDOW_ENDED')
        return self.guarded(action)
    def cancel(self):
        def action():
            self.credentials(False); self.load_record(); self._cancel(); return self.report('CANCELLED')
        return self.guarded(action)
    def status(self):
        def action():
            self.credentials(False)
            if self.fs.exists(self.paths['journal']): self.load_record()
            self.controls()
            if self.record: self.marker_state()
            else:
                require(not self.fs.exists(self.paths['maintenance']), 'MARKER_EXISTS')
                validate_open(self.fs.read(self.paths['open']), self.policy)
            return self.report('STATUS')
        return self.guarded(action, read_only=True)
