"""Dedicated B0 -> B1 coordinator. Never infers historical completion from health.

The root-reviewed completion document is an operator attestation trust boundary,
not cryptographic proof. This module neither creates it nor repairs missing facts.
The successful backend stage leaves both ingress and backend admission closed.
"""
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import secrets
import time

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location('first_window_' + name, HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


tx = module('transaction')
SHA64 = re.compile(r'[a-f0-9]{64}')
COVERAGE = ('public-http', 'public-https', 'existing-http2', 'loopback', 'direct-bind', 'internal-callers')
COMPLETION = ('http-responses', 'nonbilled-graphs', 'billed-provider-health', 'sharp-storage', 'inflight-renew', 'zip-cancel-finally', 'upload-compensation-preview')
LEGACY_PATHS = ('/api/health/ready', '/api/account', '/api/sessions')
LEGACY_PROTOCOL = 'zimage-legacy-readonly-v1'
PHASES = {'verified', 'stopping_legacy', 'legacy_stopped', 'selecting_candidate', 'starting_candidate', 'checking',
          'backend_ready', 'draining_candidate', 'stopping_candidate', 'selecting_legacy', 'starting_legacy',
          'legacy_started', 'checking_legacy', 'recovered', 'needs_attention', 'configuring_candidate', 'configuring_legacy'}


def exact(value, fields):
    if type(value) is not dict or set(value) != set(fields): raise ValueError('First-window exact schema rejected')


def digest(value):
    def normalized(item):
        if type(item) is float and item.is_integer(): return int(item)
        if type(item) is dict: return {key: normalized(child) for key, child in item.items()}
        if type(item) is list: return [normalized(child) for child in item]
        return item
    return hashlib.sha256((json.dumps(normalized(value), sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()).hexdigest()


def hash64(value):
    if type(value) is not str or SHA64.fullmatch(value) is None: raise ValueError('Exact evidence digest required')


def identity(value):
    exact(value, ('pid', 'startTicks', 'bootId'))
    if (type(value['pid']) is not int or not 0 < value['pid'] <= 2147483647
            or type(value['startTicks']) is not int or value['startTicks'] <= 0
            or type(value['bootId']) is not str or re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', value['bootId']) is None):
        raise ValueError('Exact Linux process start/boot identity required')


def fresh(issued, expires, now, maximum):
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in (issued, expires, now)):
        raise ValueError('Finite evidence timestamps required')
    if not issued <= now <= expires or not 0 < expires - issued <= maximum:
        raise ValueError('Reviewed evidence expired, future or unbounded')


def refs(value):
    if (type(value) is not list or not 1 <= len(value) <= 32 or len(set(value)) != len(value)
            or any(type(item) is not str or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{6,255}', item) is None for item in value)):
        raise ValueError('Independent review audit references required')


def validate_policy(policy, operation, old, target, now):
    if type(policy) is not dict: raise ValueError('First-window policy must be an object')
    fields = ('schemaVersion', 'operationId', 'old', 'target', 'oldProcess', 'legacyFrontendSha256',
                   'ingressConfigPath', 'ingressConfigSha256', 'candidateManifestSha256', 'compatibilitySha256',
                   'candidatePolicy', 'serviceTemplates', 'originalServiceSha256', 'auditRefs', 'issuedAt', 'expiresAt')
    exact(policy, fields + (('frontendBootstrap',) if 'frontendBootstrap' in policy else ()))
    if type(policy['schemaVersion']) is not int or policy['schemaVersion'] != 1 or policy['operationId'] != operation or policy['old'] != old or policy['target'] != target:
        raise ValueError('Exact first-window policy identity rejected')
    if not tx.ID.fullmatch(operation) or not tx.SHA.fullmatch(old) or not tx.SHA.fullmatch(target) or old == target:
        raise ValueError('Exact operation and distinct full SHAs required')
    identity(policy['oldProcess'])
    for key in ('legacyFrontendSha256', 'ingressConfigSha256', 'candidateManifestSha256', 'compatibilitySha256'): hash64(policy[key])
    path = policy['ingressConfigPath']
    if (type(path) is not str or not path.startswith('/etc/nginx/') or '..' in Path(path).parts
            or len(path) > 512): raise ValueError('Reviewed fixed Nginx configuration path required')
    if digest(policy['candidatePolicy']) != policy['compatibilitySha256']: raise ValueError('Compatibility record digest mismatch')
    tx.compatible(policy['candidatePolicy'], old, target, policy['legacyFrontendSha256'])
    candidate = policy['candidatePolicy']['backends'][target]
    if candidate.get('drainProtocol') != 1 or candidate.get('httpAdmissionProtocol') != 1:
        raise ValueError('Candidate has no reviewed business/HTTP lifecycle bridge')
    hash64(policy['originalServiceSha256'])
    exact(policy['serviceTemplates'], ('candidate', 'legacy'))
    for value in policy['serviceTemplates'].values(): hash64(value)
    refs(policy['auditRefs'])
    if 'frontendBootstrap' in policy:
        bootstrap = policy['frontendBootstrap']
        exact(bootstrap, ('namespace', 'manifestSha256', 'splitIngressSha256', 'maintenanceMapsSha256', 'maintenanceServerSha256'))
        if (type(bootstrap['namespace']) is not str or bootstrap['namespace'] == 'none'
                or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', bootstrap['namespace']) is None):
            raise ValueError('Exact static frontend namespace required')
        for key in ('manifestSha256', 'splitIngressSha256', 'maintenanceMapsSha256', 'maintenanceServerSha256'):
            hash64(bootstrap[key])
    fresh(policy['issuedAt'], policy['expiresAt'], now, 86400)
    return copy.deepcopy(policy)


def validate_frontend(value, policy):
    exact(value, ('schemaVersion', 'kind', 'backendRelease', 'treeSha256', 'ingressConfigSha256', 'auditRefs'))
    if (type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['kind'] != 'legacy-next'
            or value['backendRelease'] != policy['old'] or value['ingressConfigSha256'] != policy['ingressConfigSha256']
            or digest(value) != policy['legacyFrontendSha256']): raise ValueError('Real reviewed legacy frontend identity mismatch')
    hash64(value['treeSha256'])
    refs(value['auditRefs'])


def seal_token(policy):
    return {'schemaVersion': 1, 'operationId': policy['operationId'], 'ingressConfigSha256': policy['ingressConfigSha256']}


def validate_completion(value, policy, token, now):
    exact(value, ('schemaVersion', 'protocol', 'operationId', 'old', 'oldProcess', 'policySha256',
                  'ingressConfigSha256', 'ingressSealSha256', 'coverageStartTicks', 'sealedAt', 'checkedAt',
                  'expiresAt', 'coverage', 'completion', 'auditRefs', 'reviewDecision'))
    if (type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['protocol'] != 'zimage-legacy-completion-v1'
            or value['operationId'] != policy['operationId'] or value['old'] != policy['old']
            or value['oldProcess'] != policy['oldProcess'] or value['policySha256'] != digest(policy)
            or value['ingressConfigSha256'] != policy['ingressConfigSha256'] or token != seal_token(policy)
            or value['ingressSealSha256'] != digest(token) or type(value['coverageStartTicks']) is not int
            or value['coverageStartTicks'] != policy['oldProcess']['startTicks']
            or value['reviewDecision'] != 'exact-completion-reviewed'):
        raise ValueError('Exact B0 process/history/all-ingress completion attestation missing')
    identity(value['oldProcess'])
    fresh(value['sealedAt'], value['expiresAt'], now, 600)
    if type(value['checkedAt']) not in (int, float) or not value['sealedAt'] <= value['checkedAt'] <= now:
        raise ValueError('Completion review must follow the actual ingress seal')
    for key, required, outcome in (('coverage', COVERAGE, 'sealed'), ('completion', COMPLETION, 'completed')):
        entries = value[key]
        if type(entries) is not list or len(entries) != len(required): raise ValueError('Completion/coverage set incomplete')
        for entry, category in zip(entries, required):
            exact(entry, ('category', 'evidenceSha256', 'auditRef', 'outcome'))
            hash64(entry['evidenceSha256'])
            refs([entry['auditRef']])
            if entry['category'] != category or entry['outcome'] != outcome:
                raise ValueError('Missing, unknown or unclosed historical lifecycle/ingress evidence')
    refs(value['auditRefs'])
    return copy.deepcopy(value)


def validate_legacy_request(request, *, operation, release, pid, now):
    exact(request, ('schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'processStart', 'nonce', 'createdAt', 'expiresAt'))
    if (type(request['schemaVersion']) is not int or request['schemaVersion'] != 1 or request['verifierProtocol'] != LEGACY_PROTOCOL
            or request['operationId'] != operation or request['backendRelease'] != release or request['pid'] != pid
            or not tx.ID.fullmatch(operation) or not tx.SHA.fullmatch(release)):
        raise ValueError('Legacy request identity rejected')
    identity(request['processStart'])
    if request['processStart']['pid'] != pid: raise ValueError('Legacy request PID/start mismatch')
    hash64(request['nonce'])
    fresh(request['createdAt'], request['expiresAt'], now, 120)


def validate_legacy_receipt(value, request, *, operation, release, pid, now):
    validate_legacy_request(request, operation=operation, release=release, pid=pid, now=now)
    exact(value, ('schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'processStart', 'nonce',
                  'requestSha256', 'checkedAt', 'checks', 'authenticatedReadOnly', 'independentPublic'))
    for key in ('schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'processStart', 'nonce'):
        if value[key] != request[key] or type(value[key]) is not type(request[key]): raise ValueError('Legacy receipt request binding rejected')
    identity(value['processStart'])
    if value['requestSha256'] != digest(request): raise ValueError('Legacy receipt digest mismatch')
    if (type(value['checkedAt']) not in (int, float) or not request['createdAt'] <= value['checkedAt'] <= now
            or value['authenticatedReadOnly'] is not True or value['independentPublic'] is not True): raise ValueError('Legacy checks stale or unsuccessful')
    if type(value['checks']) is not list or len(value['checks']) != len(LEGACY_PATHS): raise ValueError('Legacy safe checks incomplete')
    for index, (check, path) in enumerate(zip(value['checks'], LEGACY_PATHS)):
        exact(check, ('path', 'status', 'noStore', 'authenticated'))
        if (check['path'] != path or type(check['status']) is not int or check['status'] != 200
                or check['noStore'] is not True or type(check['authenticated']) is not bool or check['authenticated'] != (index > 0)):
            raise ValueError('Legacy safe check rejected')
    return copy.deepcopy(value)


def validate_legacy_audit(value, request, policy, now):
    exact(value, ('schemaVersion', 'protocol', 'operationId', 'backendRelease', 'processStart', 'requestSha256',
                  'policySha256', 'checkedAt', 'expiresAt', 'accessMode', 'walletLedgerEvidenceSha256', 'auditRefs', 'reviewDecision'))
    if (type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['protocol'] != 'zimage-legacy-wallet-ledger-audit-v1'
            or value['operationId'] != request['operationId'] or value['backendRelease'] != request['backendRelease']
            or value['processStart'] != request['processStart'] or value['requestSha256'] != digest(request)
            or value['policySha256'] != digest(policy) or value['accessMode'] != 'read-only-select'
            or value['reviewDecision'] != 'wallet-ledger-reviewed'):
        raise ValueError('Separate exact legacy read-only wallet/ledger audit required; catalog readiness is insufficient')
    fresh(value['checkedAt'], value['expiresAt'], now, 120)
    if value['checkedAt'] < request['createdAt'] or value['expiresAt'] > request['expiresAt']: raise ValueError('Legacy audit nonce window mismatch')
    hash64(value['walletLedgerEvidenceSha256'])
    refs(value['auditRefs'])


def validate_record(record, policy, operation, completion_sha256=None, *, allow_opened_status=False):
    required = {'schemaVersion', 'kind', 'operationId', 'sequence', 'old', 'target', 'oldPid', 'frontend',
                'writesOpened', 'policySha256', 'completionSha256', 'oldProcess', 'phase'}
    if (type(record) is not dict or not required.issubset(record)
            or set(record) - required - {'verificationTarget', 'candidatePid', 'candidateProcess', 'recoveryPid', 'recoveryProcess', 'writesMayHaveOpened'}
            or type(record['schemaVersion']) is not int or record['schemaVersion'] != 1 or record['kind'] != 'first-window'
            or record['operationId'] != operation or operation != policy['operationId']
            or record['old'] != policy['old'] or record['target'] != policy['target']
            or record['oldProcess'] != policy['oldProcess'] or record['oldPid'] != policy['oldProcess']['pid']
            or record['policySha256'] != digest(policy) or record['frontend'] != policy['legacyFrontendSha256']
            or type(record['sequence']) is not int or record['sequence'] != 1):
        raise tx.TransactionFailure('Exact unopened first-window journal required; uncertain writes prohibit automatic recovery')
    opened = record.get('writesMayHaveOpened', False) is True
    if opened and allow_opened_status:
        if type(record['writesOpened']) is not bool or record['phase'] not in ('opening', 'committed', 'needs_attention'):
            raise tx.TransactionFailure('Invalid opened first-window status')
    elif record['writesOpened'] is not False or record.get('writesMayHaveOpened', False) is not False or record['phase'] not in PHASES:
        raise tx.TransactionFailure('Exact unopened first-window journal required; uncertain writes prohibit automatic recovery')
    hash64(record['completionSha256'])
    if completion_sha256 is not None and record['completionSha256'] != completion_sha256:
        raise tx.TransactionFailure('Historical completion approval differs from the retained operation')
    identity(record['oldProcess'])
    if 'recoveryProcess' in record: identity(record['recoveryProcess'])
    if 'candidateProcess' in record: identity(record['candidateProcess'])


class FirstWindow:
    def __init__(self, ops, maintenance, journal, clock=time.monotonic, wall=time.time, wait=time.sleep):
        self.ops, self.journal, self.wall = ops, Path(journal), wall
        self.engine = tx.BackendTransaction(ops, maintenance, journal, clock, wait)

    def write(self, record, phase, **details):
        self.engine.write(record, phase, **details)

    def approvals(self, expected_policy_sha256, expected_completion_sha256):
        """Compare operator approvals, never replace them with freshly read hashes.

        The fixed caller invokes this under the global release lock before any
        preparation or mutation. Core entrypoints repeat it for injected callers
        and preserve the same approved document pair throughout recovery.
        """
        hash64(expected_policy_sha256)
        hash64(expected_completion_sha256)
        policy, completion = self.ops.first_policy(), self.ops.completion()
        if digest(policy) != expected_policy_sha256 or digest(completion) != expected_completion_sha256:
            raise ValueError('Root policy/completion differs from the explicitly preapproved digests')
        return policy, completion

    def context(self, policy, *, completion_sha256=None, original=False, completion=False):
        validate_policy(policy, policy['operationId'], policy['old'], policy['target'], self.wall())
        if self.ops.first_policy() != policy: raise tx.TransactionFailure('Reviewed first-window policy drift')
        if completion_sha256 is not None and digest(self.ops.completion()) != completion_sha256:
            raise tx.TransactionFailure('Reviewed first-window completion evidence drift')
        validate_frontend(self.ops.legacy_frontend(), policy)
        self.ops.service_policy(policy)
        if original and self.ops.original_service_digest() != policy['originalServiceSha256']:
            raise tx.TransactionFailure('Original root-reviewed service metadata drift')
        if self.ops.frontend_current_exists(): raise tx.TransactionFailure('Dedicated B1-first path requires genuinely absent static frontend current')
        if getattr(self.ops, 'frontend_checking', lambda: None)() is not None:
            raise tx.TransactionFailure('Static checking must be removed by exact bootstrap recovery before legacy work')
        if self.ops.ingress_digest(policy) != policy['ingressConfigSha256']: raise tx.TransactionFailure('Legacy ingress configuration drift')
        token = self.ops.ingress_state()
        if token != seal_token(policy): raise tx.TransactionFailure('All-ingress external seal is missing or changed')
        if self.ops.ingress_open_exists(): raise tx.TransactionFailure('Contradictory external open flag; seal unavailable')
        checking = self.ops.ingress_checking()
        if checking is not None and (checking != token or original or completion):
            raise tx.TransactionFailure('Initial B0 completion requires fully sealed ingress; checking epoch drift rejected')
        if original and self.ops.process() != policy['oldProcess']: raise tx.TransactionFailure('Exact original B0 PID/start changed')
        if completion: validate_completion(self.ops.completion(), policy, token, self.wall())

    def run(self, target, expected, operation, *, expected_policy_sha256, expected_completion_sha256, timeout=300):
        if not 0 < timeout <= 300: raise ValueError('Bounded drain timeout required')
        policy, _ = self.approvals(expected_policy_sha256, expected_completion_sha256)
        validate_policy(policy, operation, expected, target, self.wall())
        if self.journal.exists() or self.journal.with_name(operation + '.json').exists():
            raise tx.TransactionFailure('First-window journal exists; explicit recovery/reconciliation required, never replay')
        if self.ops.current() != expected: raise tx.TransactionFailure('Exact original current mismatch')
        # No gate writes, artifact preparation, stop, selection or native work
        # precedes review of independently installed historical evidence.
        self.context(policy, completion_sha256=expected_completion_sha256, original=True, completion=True)
        self.ops.validate_first_candidate(target, policy)
        record = {'schemaVersion': 1, 'kind': 'first-window', 'operationId': operation, 'sequence': 1,
                  'old': expected, 'target': target, 'oldPid': policy['oldProcess']['pid'],
                  'frontend': policy['legacyFrontendSha256'], 'writesOpened': False,
                  'policySha256': expected_policy_sha256, 'completionSha256': expected_completion_sha256,
                  'oldProcess': policy['oldProcess']}
        self.write(record, 'verified')
        try:
            self.ops.ingress_mode(operation, 'draining', policy)
            self.engine.gate(operation, 'draining')
            self.context(policy, completion_sha256=expected_completion_sha256, original=True, completion=True)
            self.write(record, 'stopping_legacy')
            self.ops.stop()
            self.write(record, 'legacy_stopped')
            self.write(record, 'configuring_candidate')
            self.ops.service_mode('candidate', policy)
            self.ops.native(target)
            self.write(record, 'selecting_candidate')
            self.ops.select(target, expected)
            self.write(record, 'starting_candidate')
            self.ops.start()
            candidate_process = self.ops.process()
            if candidate_process is None: raise tx.TransactionFailure('Candidate has no exact systemd PID/start identity')
            self.write(record, 'checking', verificationTarget=target, candidateProcess=candidate_process)
            self.engine.gate(operation, 'checking')
            self.ops.ingress_mode(operation, 'checking', policy)
            candidate = self.ops.check(target, operation)
            status = self.engine.observed(target, operation, candidate['pid'])
            if self.ops.process() != candidate_process or candidate_process['pid'] != candidate['pid']:
                raise tx.TransactionFailure('Candidate PID/start drift during verification')
            if status['pid'] == policy['oldProcess']['pid']: raise tx.TransactionFailure('Candidate process identity reused original PID')
            self.context(policy, completion_sha256=expected_completion_sha256)
            if self.ops.current() != target: raise tx.TransactionFailure('Candidate pointer drift')
            self.ops.ingress_mode(operation, 'draining', policy)
            self.engine.drain(target, operation, candidate['pid'], timeout)
            self.write(record, 'backend_ready', candidatePid=candidate['pid'])
            return record
        except Exception as error:
            try: self.recover(operation, expected_policy_sha256=expected_policy_sha256,
                              expected_completion_sha256=expected_completion_sha256, timeout=timeout)
            except Exception:
                if self.journal.exists():
                    retained = json.loads(self.journal.read_text())
                    if retained.get('operationId') == operation: record = retained
                self.engine.gate(operation, 'draining')
                self.ops.ingress_mode(operation, 'draining', policy)
                self.write(record, 'needs_attention')
            raise tx.TransactionFailure('First-window candidate failed; inspect retained exact recovery phase') from error

    def recover(self, operation, *, expected_policy_sha256, expected_completion_sha256, timeout=300):
        if not tx.ID.fullmatch(operation) or not 0 < timeout <= 300: raise ValueError('Exact operation and bounded timeout required')
        policy, _ = self.approvals(expected_policy_sha256, expected_completion_sha256)
        record = json.loads(self.journal.read_text())
        if (record.get('kind') != 'first-window' or record.get('operationId') != operation or record.get('writesOpened') is not False
                or record.get('phase') in ('opening', 'committed', 'opening_legacy', 'recovered_open')):
            raise tx.TransactionFailure('Writes may have opened or journal unrelated; automatic recovery forbidden')
        validate_record(record, policy, operation, expected_completion_sha256)
        self.context(policy, completion_sha256=expected_completion_sha256)
        gate = json.loads(self.engine.maintenance.read_text())
        if gate != {'schemaVersion': 2, 'operationId': operation, 'mode': gate.get('mode')} or gate.get('mode') not in ('draining', 'checking'):
            self.write(record, 'needs_attention', writesMayHaveOpened=True)
            raise tx.TransactionFailure('Admission open/unknown; manual review required, no automatic rollback')
        self.ops.ingress_mode(operation, 'draining', policy)
        self.engine.gate(operation, 'draining')
        current, process = self.ops.current(), self.ops.process()
        if current not in (record['old'], record['target']): raise tx.TransactionFailure('Recovery current drift')
        if process is not None:
            identity(process)
            if current == record['target']:
                if record.get('candidateProcess') != process:
                    raise tx.TransactionFailure('Candidate PID/start drift; never stop an unrecognized replacement')
                self.write(record, 'draining_candidate')
                self.engine.drain(current, operation, process['pid'], timeout)
                self.context(policy, completion_sha256=expected_completion_sha256)
                if self.ops.current() != current or self.ops.process() != process: raise tx.TransactionFailure('Candidate drift after recovery drain')
                self.write(record, 'stopping_candidate')
                self.ops.stop()
            elif process != record['oldProcess']:
                if record.get('recoveryProcess') != process:
                    self.write(record, 'needs_attention')
                    raise tx.TransactionFailure('Unrecognized live legacy process; explicit reconciliation required')
        if self.ops.process() is None:
            self.write(record, 'configuring_legacy')
            self.ops.service_mode('legacy', policy)
            self.ops.native(record['old'])
            if self.ops.current() != record['old']:
                self.write(record, 'selecting_legacy')
                self.ops.select(record['old'], record['target'])
            self.write(record, 'starting_legacy')
            try:
                self.ops.start()
                started = self.ops.process()
                if started is None: raise tx.TransactionFailure('Started legacy process identity unavailable')
                identity(started)
                # No further gate/probe/policy action can precede persistence of
                # this invocation's actual start identity. A crash in the gap
                # leaves an unknown live PID blocked, never implicitly adopted.
                self.write(record, 'legacy_started', recoveryProcess=started)
            except Exception:
                self.write(record, 'needs_attention')
                raise
        self.context(policy, completion_sha256=expected_completion_sha256)
        restored = self.ops.process()
        if restored is None or self.ops.current() != record['old']: raise tx.TransactionFailure('Legacy process unavailable after recovery')
        self.write(record, 'checking_legacy', verificationTarget=record['old'], recoveryProcess=restored)
        self.engine.gate(operation, 'checking')
        self.ops.ingress_mode(operation, 'checking', policy)
        try:
            self.ops.check_legacy(record['old'], operation, restored, policy)
            self.context(policy, completion_sha256=expected_completion_sha256)
            if self.ops.process() != restored or self.ops.current() != record['old']: raise tx.TransactionFailure('Legacy PID/start drift during safe verification')
            self.ops.ingress_mode(operation, 'draining', policy)
            self.engine.gate(operation, 'draining')
            self.write(record, 'recovered', recoveryPid=restored['pid'])
            return record
        except Exception:
            self.ops.ingress_mode(operation, 'draining', policy)
            self.engine.gate(operation, 'draining')
            self.write(record, 'needs_attention')
            raise
