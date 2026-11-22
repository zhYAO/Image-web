"""Uninstalled no-DDL staging binding; no CLI, deploy authority or network.

The installed half is deliberately absent: supply a separately audited staging
system and independent authority. The authority verifies baseline/staging
acceptance, exact protected main, schema fingerprint and frontend subject from
its own custody. All operations here are behind the supplied common journal.
"""
from contextlib import contextmanager
import copy
from pathlib import Path
import secrets

from system import SystemOps

MARKERS = {'maintenance', 'checking', 'open', 'frontend_fence'}
CANDIDATE_FIELDS = ('backend', 'frontend', 'frontendSequence', 'frontendArtifact',
                    'process', 'configurationSha256', 'ingressSha256')
# Tuple order is maintenance, checking, open, frontend fence, Node mode.
SEALED_GATE = (True, False, False, True, 'draining')
CHECKING_GATE = (True, True, False, True, 'checking')
OPENING_GATES = {
    CHECKING_GATE,
    (True, False, False, True, 'checking'),
    SEALED_GATE,
    (True, False, True, True, 'draining'),
    (True, False, True, True, 'open'),
    (True, False, True, False, 'open'),
    (False, False, True, False, 'open'),
    (True, False, False, True, 'open'),
}


class StageBinding:
    def __init__(self, journal, system, authority, receipt_validator, *, clock):
        paths = system.paths
        root = Path(journal.root)
        etc = Path(paths.etc)
        if (Path(paths.root) != root or Path(system.anchor) != root or root not in etc.parents
                or etc.resolve(strict=True) != etc or root.resolve(strict=True) != root
                or root == Path('/opt/zimage') or Path('/opt/zimage') in root.parents):
            raise ValueError('Require independent canonical staging root and local config')
        # The normal SystemOps probe and seal use a fixed production public
        # origin. A reviewed staging-specific subclass must override both.
        names = ('seal_probe', 'probe', 'wait_checking_ready', 'ingress_digest',
                 'prepare_frontend', 'publish_frontend')
        if (not isinstance(system, SystemOps)
                or any(getattr(type(system), name) is getattr(SystemOps, name) for name in names)):
            raise ValueError('Require staging-specific ingress probes')
        self.gate, self.system, self.authority = journal, system, authority
        self.receipts, self.clock = receipt_validator, clock
        self.operation = self.phase = self.record = self.approval = None

    @contextmanager
    def lock(self):
        with self.gate.lock():
            try:
                yield
            except Exception:
                if self.phase is not None and self.phase != 'opened' and self.record is not None:
                    # The intent is never erased. If holding the exact gate
                    # fails, leave explicit reconciliation required. Never
                    # restore, retry, restart or claim writes stayed closed.
                    try:
                        self.gate._guard_lock()
                        self.system.hold(copy.deepcopy(self.record))
                    except Exception as hold_error:
                        raise ValueError('Unable to confirm staging quarantine; reconcile under common lock') from hold_error
                raise
            finally:
                self.operation = self.phase = self.record = self.approval = None

    def assert_clear(self, operation):
        self.gate.assert_clear(operation)
        self.operation = operation

    def journal(self, event):
        phase = event['phase']
        evidence = None
        if phase in ('seal-intent', 'writes-may-open'):
            if (event['operation'] != self.operation
                    or event['rootApprovalSha256'] != self.record['rootApprovalSha256']
                    or self.gate.core.digest(self.system.p) != self.record['policySha256']):
                raise ValueError('Ordinary operation, approval or policy changed')
        if phase == 'seal-intent':
            if self.system.snapshot() != self.record['initial']:
                raise ValueError('Original staging gate changed before seal intent')
            evidence = dict(lock=self.gate.lock_identity(), policySha256=self.record['policySha256'],
                            initial=self.record['initial'])
        if phase == 'writes-may-open':
            observed = self.system.snapshot()
            evidence = self._candidate(observed)
            if (evidence['process'] != self.record['candidateProcess']
                    or evidence['frontendSequence'] != self.record['pairSequence']
                    or evidence['frontendArtifact'] != self.approval['artifactId']
                    or self._opening_gate(observed) not in (SEALED_GATE, CHECKING_GATE)):
                raise ValueError('Exact sealed candidate evidence differs')
        self.gate.journal(event, evidence=evidence)
        self.phase = phase

    def _initial_gate(self, initial):
        flags = initial['markers']
        self.gate.core.exact(flags, MARKERS)
        node = initial['nodeGate']
        self.gate.core.exact(node, {'schemaVersion', 'operationId', 'mode'})
        if (type(flags['open']) is not dict or flags['open'] == self.system.token()
                or any(flags[key] is not None for key in MARKERS - {'open'})
                or type(node['schemaVersion']) is not int or node['schemaVersion'] != 2
                or node['mode'] != 'open' or initial['ingressMode'] != 'open'
                or initial['nodeMode'] != 'open' or initial['fence'] is not None
                or type(initial['frontendSequence']) is not int or initial['frontendSequence'] < 1):
            raise ValueError('Original staging gate is not an exact open generation')

    def _candidate(self, observed):
        candidate = {key: observed[key] for key in CANDIDATE_FIELDS}
        policy = self.system.p
        if (candidate['backend'] != policy['newBackend'] or candidate['frontend'] != policy['newFrontend']
                or candidate['process'] is None or type(candidate['frontendSequence']) is not int
                or candidate['frontendSequence'] < 2):
            raise ValueError('Exact candidate release and process required')
        self.gate.core.hexid(candidate['frontendArtifact'])
        return candidate

    def _opening_gate(self, observed):
        flags = observed['markers']
        self.gate.core.exact(flags, MARKERS)
        token = self.system.token()
        mode = observed['nodeMode']
        node = observed['nodeGate']
        if (any(value not in (None, token) for value in flags.values())
                or node != dict(schemaVersion=2, operationId=token['operationId'], mode=mode)):
            raise ValueError('Foreign ordinary gate ownership')
        state = (*(flags[key] is not None for key in ('maintenance', 'checking', 'open', 'frontend_fence')), mode)
        if state not in OPENING_GATES:
            raise ValueError('Inconsistent ordinary opening gate')
        return state

    def reconcile_open(self, operation, expected_approval_sha256):
        """Hold an exact interrupted opening under the common deployment lock."""
        with self.gate.lock():
            evidence = self.gate.opening_evidence(operation, expected_approval_sha256)
            if evidence is None:
                return dict(operation=operation, phase='opened')
            baseline, candidate = evidence
            self.gate.core.exact(baseline, {'lock', 'policySha256', 'initial'})
            policy = self.system.p
            if (policy['operationId'] != operation or baseline['policySha256'] != self.gate.core.digest(policy)
                    or baseline['lock'] != self.gate.lock_identity()):
                raise ValueError('Ordinary operation, policy or deployment lock differs')
            initial = baseline['initial']
            self._initial_gate(initial)
            self.gate.core.exact(candidate, CANDIDATE_FIELDS)
            if (initial['backend'] != policy['oldBackend'] or initial['frontend'] != policy['oldFrontend']
                    or candidate['frontendSequence'] != initial['frontendSequence'] + 1):
                raise ValueError('Original ordinary pair evidence differs')

            observed = self.system.persistent_snapshot()
            if self._candidate(observed) != candidate:
                raise ValueError('Current candidate release or process evidence differs')
            state = self._opening_gate(observed)
            process = candidate['process']
            self.system.exact_process(process)
            self.gate._guard_lock()
            if state != SEALED_GATE:
                self.system.hold(dict(operationId=operation, initial=initial))
            self.system.seal_probe()
            held = self.system.snapshot()
            if self._candidate(held) != candidate or self._opening_gate(held) != SEALED_GATE:
                raise ValueError('Ordinary quarantine could not be confirmed')
            self.system.exact_process(process)
            return dict(operation=operation, phase='writes-may-open', held=True)

    def assert_main(self, commit):
        if self.authority.current_main() != commit:
            raise ValueError('Independently checked main does not match candidate')

    def snapshot(self):
        observed = self.system.snapshot()
        mode = observed['ingressMode']
        if mode == 'open':
            if observed['fence'] is not None or observed['nodeMode'] != 'open':
                raise ValueError('Contradictory open staging evidence')
        elif (mode not in ('sealed', 'checking') or observed['fence'] != self.operation
              or observed['nodeMode'] != ('draining' if mode == 'sealed' else 'checking')):
            raise ValueError('Foreign or contradictory staged closure')
        return dict(backend=observed['backend'], frontend=observed['frontend'],
                    sealed=mode != 'open', databaseSha256=self.authority.database_fingerprint())

    def verify_inputs(self, packet, approval):
        policy = self.system.p
        if any(policy.get(key) != value for key, value in {
            'operationId': approval['operation'], 'newBackend': packet['commit'],
            'oldBackend': approval['oldPair']['backend'],
            'newFrontend': approval['newPair']['frontend'], 'oldFrontend': approval['oldPair']['frontend'],
            'backendManifestSha256': packet['backendManifestSha256'],
        }.items()):
            raise ValueError('Installed staging policy differs from exact approved pair')
        initial = self.system.snapshot()
        self._initial_gate(initial)
        existing_process = initial['process']
        if existing_process is None:
            raise ValueError('No exact baseline process')
        self.system.exact_process(existing_process)
        frontend = self.authority.verify_inputs(copy.deepcopy(packet), copy.deepcopy(approval), copy.deepcopy(initial))
        if (type(frontend) is not dict or set(frontend) != {'archiveSha256', 'manifestSha256', 'artifactId', 'acceptanceSha256'}
                or frontend['archiveSha256'] != approval['frontendArchiveSha256']
                or frontend['manifestSha256'] != approval['frontendManifestSha256']):
            raise ValueError('Approved frontend archive/manifest differs')
        self.gate.core.hexid(frontend['acceptanceSha256'])
        self.gate.core.hexid(frontend['artifactId'])
        self.system.validate_backend(packet['commit'], packet['backendManifestSha256'])
        self.system.exact_process(existing_process)
        if self.system.snapshot() != initial:
            raise ValueError('Baseline staging state changed during evidence check')
        self.record = dict(operationId=self.operation, initial=copy.deepcopy(initial), migrationNonce=None,
                           rootApprovalSha256=self.gate.core.digest(approval),
                           policySha256=self.gate.core.digest(policy))
        self.approval = dict(frontend)

    def seal_and_drain(self):
        self.system.exact_process(self.record['initial']['process'])
        self.system.seal(copy.deepcopy(self.record))
        self.system.drain(copy.deepcopy(self.record), self.record['initial']['process'])

    def select_backend(self, packet, approval):
        self.system.stop(copy.deepcopy(self.record), self.record['initial']['process'])
        stage = dict(self.record, phase='backend_select_intent')
        self.system.select_backend(stage)
        observed = self.system.start(copy.deepcopy(stage), packet['commit'])
        process = observed['process']
        self.system.exact_process(process)
        self.record['candidateProcess'] = copy.deepcopy(process)

    def select_frontend(self, packet, approval):
        self.system.prepare_frontend(copy.deepcopy(self.record), dict(self.approval))
        observed = self.system.publish_frontend(copy.deepcopy(self.record), dict(self.approval))
        if observed['frontendSequence'] != self.record['initial']['frontendSequence'] + 1:
            raise ValueError('Staging frontend sequence drifted')
        self.record['pairSequence'] = observed['frontendSequence']

    def verify_sealed_pair(self, packet, approval):
        process = self.record['candidateProcess']
        self.system.exact_process(process)
        now = int(self.clock())
        # The installed independent verifier owns genuine authenticated
        # read-only checks; our challenge cannot manufacture an acceptance.
        request = dict(schemaVersion=1, operationId=self.operation, backendRelease=packet['commit'],
                       pid=process['pid'], nonce=secrets.token_hex(32), createdAt=now, expiresAt=now + 90)
        receipt = self.authority.authenticate(copy.deepcopy(request), copy.deepcopy(process),
                                              copy.deepcopy(packet), copy.deepcopy(approval))
        self.receipts.validate_receipt(receipt, request, operation=self.operation, release=packet['commit'],
                                       pid=process['pid'], now=self.clock())
        self.system.exact_process(process)
        self.system.probe(copy.deepcopy(self.record))
        self.system.exact_process(process)

    def open_pair(self):
        if self.phase != 'writes-may-open':
            raise ValueError('Exact durable open intent required')
        process = self.record['candidateProcess']
        stage = dict(self.record, phase='opening', writesMayHaveOpened=True)
        self.system.exact_process(process)
        self.system.drain(copy.deepcopy(stage), process)
        self.system.complete(copy.deepcopy(stage), recovery=False)
        self.system.open(copy.deepcopy(stage), process)
