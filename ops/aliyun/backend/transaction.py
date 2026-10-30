"""Drain transaction core. Paths/operations are injected only by local tests.

The privileged CLI supplies fixed root-managed paths and existing verified layer
adapter operations. No database, Worker, frontend pointer, or source build exists
in this interface.
"""
import json
import os
from pathlib import Path
import re
import tempfile
import time

COUNTERS = ('activeMutations', 'activeStreams', 'activeRenders', 'activeExports', 'pendingFinalizers')
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{6,79}')
SHA = re.compile(r'[a-f0-9]{40}')


def atomic_json(path, body, mode=0o600):
    path = Path(path)
    descriptor, name = tempfile.mkstemp(prefix='.backend-', dir=path.parent)
    pending = Path(name)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), mode)
            json.dump(body, stream, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        pending.unlink(missing_ok=True)


class TransactionFailure(RuntimeError):
    pass


def compatible(policy, old, target, frontend):
    if policy.get('schemaVersion') != 1 or policy.get('frontendRelease') != frontend:
        raise ValueError('Frontend changed or compatibility policy is invalid')
    backends, supported = policy['backends'], policy['supportedFrontends']
    if not supported or frontend not in {item['releaseId'] for item in supported}:
        raise ValueError('Current frontend is absent from the supported compatibility set')
    for release in (old, target):
        if not SHA.fullmatch(release) or release not in backends:
            raise ValueError('Exact backend has no reviewed compatibility record')
        api = backends[release]['api']
        for item in supported:
            required = item['requiresApi']
            if (release not in item['verifiedBackends'] or api['major'] != required['major'] or api['minor'] < required['minor']
                    or not set(required['capabilities']).issubset(api['capabilities'])):
                raise ValueError('Backend is incompatible with retained frontend ' + item['releaseId'])
    # A code rollback never rolls back persisted state or pricing/model semantics.
    for key in ('schemaRevision', 'workerRevision', 'modelCatalogRevision'):
        if backends[old].get(key) is None or backends[old][key] != backends[target].get(key):
            raise ValueError('Independent backend release requires unchanged ' + key)


class BackendTransaction:
    def __init__(self, ops, maintenance, journal, clock=time.monotonic, wait=time.sleep):
        self.ops, self.maintenance, self.journal = ops, Path(maintenance), Path(journal)
        self.clock, self.wait = clock, wait

    def write(self, record, phase, **details):
        record.update(phase=phase, **details)
        atomic_json(self.journal.with_name(record['operationId'] + '.json'), record)
        atomic_json(self.journal, record)

    def gate(self, operation, closed):
        mode = ('draining' if closed else 'open') if type(closed) is bool else closed
        if mode not in ('open', 'draining', 'checking'): raise ValueError('Invalid admission mode')
        atomic_json(self.maintenance, {'schemaVersion': 2, 'operationId': operation, 'mode': mode}, 0o644)

    def observed(self, release, operation=None, pid=None):
        status = self.ops.status()
        counters = status.get('counters', {})
        bridge = status.get('httpAdmission', {})
        framework = bridge.get('frameworkWork', {})
        if (type(status.get('schemaVersion')) is not int or status['schemaVersion'] != 1 or status.get('backendRelease') != release
                or type(status.get('pid')) is not int or status['pid'] <= 0
                or (pid is not None and status['pid'] != pid)
                or status.get('controlValid') is not True
                or type(bridge.get('protocolVersion')) is not int or bridge['protocolVersion'] != 1 or bridge.get('installed') is not True
                or bridge.get('barrierId') != 'node-http-create-server-v1'
                or type(status.get('activeHttpRequests')) is not int or status['activeHttpRequests'] < 0
                or bridge.get('activeHttpRequests') != status.get('activeHttpRequests')
                or type(status.get('activeFrameworkWork')) is not int or status['activeFrameworkWork'] < 0
                or bridge.get('activeFrameworkWork') != status.get('activeFrameworkWork')
                or framework != {'installed': True, 'protocolVersion': 1, 'nextVersion': '16.4.1',
                                 'hook': 'response-cache-revalidate-v1', 'controlValid': True}
                or type(framework.get('protocolVersion')) is not int
                or set(counters) != set(COUNTERS)
                or any(type(value) is not int or value < 0 for value in counters.values())):
            raise TransactionFailure('Exact backend process/lifecycle evidence is unavailable; legacy bootstrap is blocked')
        if operation is not None and (status.get('maintenance') is not True or status.get('admissionEpoch') != operation
                                      or status.get('admissionMode') not in ('checking', 'draining')):
            raise TransactionFailure('Process has not observed the persistent maintenance gate')
        return status

    def drain(self, release, operation, pid=None, timeout=300):
        # Changing checking -> draining seals *new reads*, including HTTP work
        # outside route counters. Existing requests retain their HTTP lease.
        self.gate(operation, 'draining')
        deadline = self.clock() + timeout
        while True:
            state = self.observed(release, operation, pid)
            if (state.get('admissionMode') == 'draining' and state['activeHttpRequests'] == 0 and state['activeFrameworkWork'] == 0
                    and not any(state['counters'].values()) and state.get('drained') is True):
                return state
            if self.clock() >= deadline: raise TimeoutError('Full HTTP/business drain deadline exceeded; process remains running')
            self.wait(min(0.25, max(0, deadline - self.clock())))

    def switch(self, target, expected, operation, timeout=300):
        if not ID.fullmatch(operation) or not SHA.fullmatch(target) or not SHA.fullmatch(expected):
            raise ValueError('Exact operation and full backend SHAs required')
        if not 0 < timeout <= 300:
            raise ValueError('Drain timeout must be within 1..300 seconds')
        sequence = 1
        if self.journal.exists():
            previous = json.loads(self.journal.read_text())
            if type(previous.get('sequence')) is not int or previous['sequence'] < 1:
                raise TransactionFailure('Invalid backend journal sequence')
            sequence = previous['sequence'] + 1
            if previous.get('phase') not in ('committed', 'cancelled', 'recovered'):
                raise TransactionFailure('Unfinished transaction requires status reconciliation; never replay stop/switch')
            if previous.get('operationId') == operation:
                raise TransactionFailure('Operation ID already used; inspect its retained result')
        old = self.ops.current()
        if old != expected or target == old:
            raise TransactionFailure('Expected current mismatch or same-version activation')
        compatible(self.ops.policy(), old, target, self.ops.frontend())
        initial = self.observed(old)
        if initial['maintenance']:
            raise TransactionFailure('A pre-existing maintenance window must be reconciled first')
        self.ops.validate(target)  # immutable closure validation; no native probe yet
        if self.journal.with_name(operation + '.json').exists():
            raise TransactionFailure('Operation ID has retained evidence; inspect it instead of replaying')
        record = {'schemaVersion': 1, 'operationId': operation, 'sequence': sequence, 'old': old, 'target': target,
                  'oldPid': initial['pid'], 'frontend': self.ops.frontend(), 'writesOpened': False}
        self.write(record, 'verified')
        self.gate(operation, True)
        self.write(record, 'draining')
        try:
            self.drain(old, operation, initial['pid'], timeout)
            if self.ops.current() != old or self.ops.frontend() != record['frontend']:
                raise TransactionFailure('Current backend/frontend drifted before stop')
            compatible(self.ops.policy(), old, target, record['frontend'])
        except BaseException:
            # Reopening is safe only for the exact still-running old process.
            try:
                self.observed(old, operation, initial['pid'])
                if self.ops.current() != old: raise TransactionFailure('Current drift')
                if self.ops.frontend() != record['frontend']: raise TransactionFailure('Frontend drift during cancellation')
                compatible(self.ops.policy(), old, target, record['frontend'])
                self.gate(operation, False)
                self.write(record, 'cancelled')
            except BaseException:
                self.gate(operation, True)
                self.write(record, 'needs_attention')
            raise

        self.write(record, 'switching')  # crash after this point keeps the gate closed
        try:
            self.ops.stop()  # only after every counted business finalizer is zero
            self.ops.native(target)  # reuse Sharp/fonts checks without two API processes
            self.ops.select(target, old)
            self.ops.start()
            self.write(record, 'checking', verificationTarget=target)
            self.gate(operation, 'checking')
            candidate = self.ops.check(target, operation)
            status = self.observed(target, operation, candidate['pid'])
            if status['pid'] == initial['pid']:
                raise TransactionFailure('Candidate did not start as a new exact process')
            if self.ops.current() != target or self.ops.frontend() != record['frontend']:
                raise TransactionFailure('Pointer drift during candidate checks')
            compatible(self.ops.policy(), old, target, record['frontend'])
            self.ops.previous(old)
            # Journal persists the intent before opening admission. An uncertain
            # crash here requires reconciliation, never blind automatic rollback.
            self.write(record, 'opening', candidatePid=status['pid'])
            self.gate(operation, False)
            self.write(record, 'committed', writesOpened=True)
            return record
        except BaseException as failure:
            # Failures after writes may have opened require a fresh drain and
            # data/ledger review; never automatically switch code underneath them.
            try:
                gate = json.loads(self.maintenance.read_text())
                if gate.get('mode') not in ('draining', 'checking') or gate.get('operationId') != operation:
                    self.gate(operation, True)
                    raise TransactionFailure('Admission may have opened; manual reconciliation required')
                current = self.ops.current()
                if current not in (old, target): raise TransactionFailure('Concurrent current drift')
                # Read-only candidate checks may still be in flight. Candidate
                # startup failure has no live PID; a live candidate must drain.
                self.gate(operation, 'draining')
                self.ops.safe_to_restore(current, operation)
                # An adapter may report a stopped service. A live process must
                # demonstrate the full barrier, even when checks just failed.
                if not hasattr(self.ops, 'service_stopped') or not self.ops.service_stopped():
                    self.drain(current, operation, timeout=timeout)
                self.ops.stop()
                self.ops.native(old)
                self.ops.select(old, current)
                self.ops.start()
                self.write(record, 'checking_recovery', verificationTarget=old)
                self.gate(operation, 'checking')
                restored = self.ops.check(old, operation)
                self.observed(old, operation, restored['pid'])
                if self.ops.frontend() != record['frontend']: raise TransactionFailure('Frontend drift before recovery')
                compatible(self.ops.policy(), old, target, record['frontend'])
                self.gate(operation, False)
                self.write(record, 'recovered', recoveryPid=restored['pid'])
            except BaseException:
                self.gate(operation, True)
                self.write(record, 'needs_attention')
            raise TransactionFailure('Backend update failed; inspect retained recovery phase') from failure
