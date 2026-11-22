"""Durable journal/lock portion of the ordinary no-DDL adapter.

Not a deployment entrypoint. Installed callers must authenticate their root,
use the same pre-existing lock across every writer, and independently validate
all release, database, main-commit and live PID evidence. This module never
selects a release or makes any network call.
"""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import re
import stat

PHASES = ('seal-intent', 'backend-intent', 'frontend-intent', 'writes-may-open', 'opened')
FIELDS = {'operationId', 'rootApprovalSha256', 'phase'}
EVIDENCE_PHASES = {'seal-intent', 'writes-may-open'}
MAX_RETAINED_OPERATIONS = 512


def exact_operation(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{6,79}', value):
        raise ValueError('Invalid exact ordinary operation ID')
    return value


class JournalGate:
    """Bind ordinary.transition methods to an authenticated filesystem root.

    core is the source-authenticated paired.core module used by the caller.
    owner_uid=0 is the installed default; tests use an unprivileged private
    directory with synthetic evidence. Never provisions/replaces deploy.lock.
    """

    def __init__(self, root, core, *, owner_uid=0):
        root = Path(root)
        if not root.is_absolute() or root.resolve(strict=True) != root:
            raise ValueError('Canonical release root required')
        self.root, self.core, self.uid = root, core, owner_uid
        self.operations = self.root / 'ordinary-operations'
        self._fd = None
        self._claim = None
        self._directory(self.root, private=False)
        self._directory(self.operations, private=True)

    def _directory(self, path, *, private):
        info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != self.uid
                or (stat.S_IMODE(info.st_mode) != 0o700 if private else info.st_mode & 0o022)):
            raise ValueError('Untrusted ordinary journal directory')
        return info

    def _lock_stat(self, info):
        if not stat.S_ISREG(info.st_mode) or info.st_uid != self.uid or info.st_nlink != 1 or info.st_mode & 0o022:
            raise ValueError('Untrusted shared deployment lock')
        return (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink)

    @contextmanager
    def lock(self):
        if self._fd is not None:
            raise ValueError('Ordinary lock cannot be nested')
        path = self.root / 'deploy.lock'
        initial = self._lock_stat(path.lstat())
        fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            if not initial == self._lock_stat(os.fstat(fd)) == self._lock_stat(path.lstat()):
                raise ValueError('Shared lock changed during acquisition')
            self._fd = fd
            yield
        finally:
            self._claim = None
            self._fd = None
            os.close(fd)

    def _guard_lock(self):
        if self._fd is None:
            raise ValueError('Shared deployment lock must be held')
        current = self._lock_stat((self.root / 'deploy.lock').lstat())
        if current != self._lock_stat(os.fstat(self._fd)):
            raise ValueError('Shared lock replaced')
        self._directory(self.operations, private=True)

    def lock_identity(self):
        self._guard_lock()
        info = os.fstat(self._fd)
        return dict(device=info.st_dev, inode=info.st_ino)

    def _previous(self, operation, journal):
        prior = journal.load()
        if prior is None:
            raise ValueError('Unfinished ordinary journal; reconcile')
        records = [event['record'] for event in journal.events()]
        if not records or len(records) > len(PHASES) or records[-1] != prior:
            raise ValueError('Unexpected ordinary journal history')
        digest = prior.get('rootApprovalSha256') if type(prior) is dict else None
        self.core.hexid(digest)
        evidence = {}
        for phase, record in zip(PHASES, records):
            expected = dict(operationId=operation, rootApprovalSha256=digest, phase=phase)
            if phase in EVIDENCE_PHASES and type(record) is dict and 'evidence' in record:
                if type(record['evidence']) is not dict:
                    raise ValueError('Unexpected ordinary recovery evidence')
                evidence[phase] = record['evidence']
                expected['evidence'] = record['evidence']
            if record != expected:
                raise ValueError('Unexpected ordinary journal history')
        return prior, len(records), evidence

    def assert_no_unresolved(self):
        """Must be called under the same flock by every future writer."""
        self._guard_lock()
        directories = []
        with os.scandir(self.operations) as entries:
            for entry in entries:
                if len(directories) >= MAX_RETAINED_OPERATIONS:
                    raise ValueError('Ordinary audit bound exceeded; reconcile before writing')
                directories.append(Path(entry.path))
        for path in directories:
            operation = exact_operation(path.name)
            prior, _, _ = self._previous(operation, self.core.Journal(path, owner_uid=self.uid))
            if prior['phase'] != 'opened':
                raise ValueError('Unfinished ordinary journal; reconcile')

    def assert_clear(self, operation):
        operation = exact_operation(operation)
        self.assert_no_unresolved()
        if self._claim is not None or os.path.lexists(self.operations / operation):
            raise ValueError('Ordinary operation ID already used')
        # No persistent state before the first mutation intent.
        self._claim = operation

    def opening_evidence(self, operation, expected_approval_sha256):
        self._guard_lock()
        operation = exact_operation(operation)
        self.core.hexid(expected_approval_sha256)
        path = self.operations / operation
        if not os.path.lexists(path):
            raise ValueError('No exact ordinary operation')
        prior, _, evidence = self._previous(operation, self.core.Journal(path, owner_uid=self.uid))
        if prior['rootApprovalSha256'] != expected_approval_sha256:
            raise ValueError('Exact ordinary approval digest differs')
        if prior['phase'] == 'opened':
            return None
        if prior['phase'] != 'writes-may-open' or set(evidence) != EVIDENCE_PHASES:
            raise ValueError('No recoverable ordinary open intent with exact evidence')
        return evidence['seal-intent'], evidence['writes-may-open']

    def journal(self, event, *, evidence=None):
        self._guard_lock()
        self.core.exact(event, {'operation', 'rootApprovalSha256', 'phase'})
        operation = exact_operation(event['operation'])
        if self._claim != operation:
            raise ValueError('Ordinary operation was not admitted')
        digest = event['rootApprovalSha256']
        self.core.hexid(digest)
        root = self.operations / operation
        if os.path.lexists(root):
            journal = self.core.Journal(root, owner_uid=self.uid)
            previous, index, history = self._previous(operation, journal)
            if previous['rootApprovalSha256'] != digest:
                raise ValueError('Ordinary approval digest changed')
        else:
            index = 0
        if index >= len(PHASES) or event['phase'] != PHASES[index]:
            raise ValueError('Unexpected ordinary journal phase')
        phase = event['phase']
        if evidence is not None and (phase not in EVIDENCE_PHASES or type(evidence) is not dict):
            raise ValueError('Unexpected ordinary recovery evidence')
        if phase == 'writes-may-open' and (evidence is not None) != ('seal-intent' in history):
            raise ValueError('Incomplete ordinary recovery evidence')
        if index == 0:
            root.mkdir(0o700)
            self.core.sync(self.operations)
            journal = self.core.Journal(root, owner_uid=self.uid)
        record = dict(operationId=operation, rootApprovalSha256=digest, phase=phase)
        if evidence is not None:
            record['evidence'] = evidence
        journal.save(record)
