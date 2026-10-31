"""Sealed first static rollout. Uses the existing publisher; never proves B0 completion.

The fixed CLI holds deploy.lock around every method. Production dependencies and
paths are supplied only by that root-owned wrapper; injection is for local tests.
"""
import importlib.util
import json
from pathlib import Path
import time

_spec = importlib.util.spec_from_file_location('frontend_bootstrap_first', Path(__file__).with_name('first_window.py'))
f = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(f)

INGRESS_KEYS = ('splitIngressSha256', 'maintenanceMapsSha256', 'maintenanceServerSha256')


def marker(policy):
    return {'schemaVersion': 1, 'operationId': policy['operationId'], 'policySha256': f.digest(policy),
            'namespace': policy['frontendBootstrap']['namespace'],
            'ingressConfigSha256': policy['frontendBootstrap']['splitIngressSha256']}


def validate_ingress_receipt(value, policy, process, now):
    f.exact(value, ('schemaVersion', 'protocol', 'operationId', 'policySha256', 'backendProcess',
                    'ingressConfigSha256', 'maintenanceMapsSha256', 'maintenanceServerSha256',
                    'checkedAt', 'expiresAt', 'coverage', 'auditRefs', 'reviewDecision'))
    expected = policy['frontendBootstrap']
    if (type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
            or value['protocol'] != 'zimage-frontend-bootstrap-ingress-v1'
            or value['operationId'] != policy['operationId'] or value['policySha256'] != f.digest(policy)
            or value['backendProcess'] != process or value['ingressConfigSha256'] != expected['splitIngressSha256']
            or any(value[key] != expected[key] for key in INGRESS_KEYS[1:])
            or value['reviewDecision'] != 'split-readonly-ingress-reviewed'):
        raise ValueError('Exact independently reviewed loaded split ingress required')
    f.identity(value['backendProcess'])
    f.fresh(value['checkedAt'], value['expiresAt'], now, 600)
    coverage = value['coverage']
    if type(coverage) is not list or len(coverage) != len(f.COVERAGE): raise ValueError('Ingress coverage incomplete')
    for entry, category in zip(coverage, f.COVERAGE):
        f.exact(entry, ('category', 'evidenceSha256', 'auditRef', 'outcome'))
        if entry['category'] != category or entry['outcome'] != 'writes-sealed': raise ValueError('Ingress writes are not sealed')
        f.hash64(entry['evidenceSha256']); f.refs([entry['auditRef']])
    f.refs(value['auditRefs'])


class FrontendBootstrap:
    def __init__(self, window, publisher, clock=time.time):
        self.window, self.publisher, self.ops, self.clock = window, publisher, window.ops, clock

    def approvals(self, operation, policy_sha, completion_sha):
        policy, _ = self.window.approvals(policy_sha, completion_sha)
        f.validate_policy(policy, operation, policy['old'], policy['target'], self.clock())
        if 'frontendBootstrap' not in policy: raise ValueError('Static bootstrap was not included in the original first-window approval')
        record = self.ops.first_journal() if hasattr(self.ops, 'first_journal') else json.loads(self.window.journal.read_text())
        f.validate_record(record, policy, operation, completion_sha)
        if record['phase'] != 'backend_ready' or record.get('candidatePid') != record.get('candidateProcess', {}).get('pid'):
            raise ValueError('Exact unopened backend_ready stage required')
        if self.ops.current() != policy['target'] or self.ops.process() != record.get('candidateProcess'):
            raise ValueError('Exact prepared backend process changed')
        return policy, record

    def context(self, operation, policy_sha, completion_sha, *, receipt=True, modes=('checking',)):
        policy, record = self.approvals(operation, policy_sha, completion_sha)
        self.ops.service_policy(policy)
        f.validate_frontend(self.ops.legacy_frontend(), policy)
        token = f.seal_token(policy)
        if self.ops.ingress_state() != token or self.ops.ingress_open_exists(): raise ValueError('Exact closed ingress required')
        if self.ops.ingress_checking() not in (None, token): raise ValueError('Foreign ingress checking epoch')
        actual = self.ops.bootstrap_ingress_digests(policy)
        if actual != {key: policy['frontendBootstrap'][key] for key in INGRESS_KEYS}: raise ValueError('Reviewed split ingress closure changed')
        status = self.window.engine.observed(policy['target'], operation, record['candidatePid'])
        if status['admissionMode'] not in modes: raise ValueError('Backend write admission must remain closed')
        if 'checking' in modes and modes == ('checking',) and self.ops.ingress_checking() != token:
            raise ValueError('Exact read-only ingress checking epoch required')
        current_marker = self.ops.frontend_checking()
        if current_marker is not None and current_marker != marker(policy): raise ValueError('Foreign static checking marker')
        if receipt: validate_ingress_receipt(self.ops.frontend_ingress_receipt(), policy, record['candidateProcess'], self.clock())
        if self.publisher.pointer('previous') is not None: raise ValueError('Bootstrap cannot replace a retained static frontend')
        return policy, record

    def prepare(self, operation, policy_sha, completion_sha):
        policy, record = self.approvals(operation, policy_sha, completion_sha)
        self.window.context(policy, completion_sha256=completion_sha)
        status = self.window.engine.observed(policy['target'], operation, record['candidatePid'])
        if status['admissionMode'] not in ('draining', 'checking'): raise ValueError('Backend admission is open')
        self.window.engine.gate(operation, 'checking')
        self.ops.ingress_mode(operation, 'checking', policy)
        return record

    def frontend_record(self, operation, policy, completion_sha):
        path = self.publisher.base / 'journal' / (operation + '.json')
        record = self.publisher.read_json(path)
        expected = policy['frontendBootstrap']
        request = record.get('request', {})
        if (record.get('operationId') != operation or request.get('kind') != 'bootstrap-deploy'
                or request.get('namespace') != expected['namespace'] or request.get('manifestSha256') != expected['manifestSha256']
                or record.get('oldFrontend') is not None or record.get('newFrontend') != expected['namespace']
                or record.get('bootstrapPolicySha256') != f.digest(policy)
                or record.get('bootstrapCompletionSha256') != completion_sha
                or record.get('bootstrapBackendProcess') != self.ops.process()
                or record.get('sequence') != self.publisher.read_json(self.publisher.base / 'sequence.json').get('sequence')):
            raise ValueError('Exact bootstrap frontend journal/sequence required')
        if self.publisher.current() not in (None, expected['namespace']): raise ValueError('Frontend pointer drift')
        return record

    def deploy(self, operation, policy_sha, completion_sha, archive_sha):
        policy, backend = self.context(operation, policy_sha, completion_sha)
        expected = policy['frontendBootstrap']
        f.hash64(archive_sha)
        request = {'kind': 'bootstrap-deploy', 'namespace': expected['namespace'], 'archiveSha256': archive_sha,
                   'manifestSha256': expected['manifestSha256']}
        record = self.publisher.start(operation, request, None)
        if 'bootstrapPolicySha256' not in record:
            # Persist the exact binding before sealing or exposing any resources.
            record.update(bootstrapPolicySha256=policy_sha, bootstrapCompletionSha256=completion_sha,
                          bootstrapBackendProcess=backend['candidateProcess'])
            self.publisher.persist(record, record['state'])
        record = self.frontend_record(operation, policy, completion_sha)
        if record['state'] == 'bootstrap_reverted': raise ValueError('Reverted bootstrap cannot be replayed')
        if record['state'] in ('needs_attention', 'recovered'): raise ValueError('Inspect the exact failed bootstrap; never replay publication')
        if record['state'] == 'committed':
            if self.publisher.current() != expected['namespace']: raise ValueError('Committed frontend pointer changed')
            return record
        value = self.publisher.seal(operation, expected['namespace'], archive_sha, expected['manifestSha256'])
        record.update(artifactId=value['artifactId'], sourceSHA=value['sourceSHA'],
                      publicConfigFingerprint=value['build']['publicConfigFingerprint'])
        original_probe, original_checkpoint = self.publisher.probe, self.publisher.checkpoint
        def guard():
            _, live = self.context(operation, policy_sha, completion_sha)
            if live['candidateProcess'] != backend['candidateProcess']: raise ValueError('Candidate process changed')
            self.frontend_record(operation, policy, completion_sha)
        def probe(namespace, release):
            guard()
            if release != policy['target']: raise ValueError('Wrong backend for static bootstrap')
            # With genuinely absent F0 there is no homepage baseline. API/config,
            # root approval, and the full post-switch static probe remain required.
            result = original_probe(namespace, release)
            guard()
            return result is True
        def checkpoint(phase):
            guard(); original_checkpoint(phase); guard()
        self.publisher.probe, self.publisher.checkpoint = probe, checkpoint
        try:
            guard()
            self.ops.frontend_mark(marker(policy))
            result = self.publisher.activate(record, value)
            guard()
            return result
        finally:
            self.publisher.probe, self.publisher.checkpoint = original_probe, original_checkpoint

    def rollback(self, operation, policy_sha, completion_sha):
        policy, backend = self.context(operation, policy_sha, completion_sha, receipt=False, modes=('checking', 'draining'))
        record = self.frontend_record(operation, policy, completion_sha)
        if record['state'] == 'bootstrap_reverted':
            if self.publisher.current() is not None or self.ops.frontend_checking() is not None:
                raise ValueError('Reverted bootstrap changed')
            return record
        if record.get('bootstrapBackendProcess') != backend['candidateProcess']: raise ValueError('Bootstrap backend identity drift')
        if self.publisher.current() is None and record['state'] not in ('preparing', 'verified', 'switching', 'recovering', 'recovered', 'bootstrap_reverting'):
            raise ValueError('Frontend disappearance has no retained publication or rollback intent')
        original_current = self.publisher.current()
        self.ops.frontend_mark(None)
        self.ops.ingress_mode(operation, 'draining', policy)
        self.window.engine.drain(policy['target'], operation, backend['candidatePid'])
        self.context(operation, policy_sha, completion_sha, receipt=False, modes=('draining',))
        self.frontend_record(operation, policy, completion_sha)
        if self.publisher.current() != original_current: raise ValueError('Frontend changed during rollback drain')
        self.publisher.persist(record, 'bootstrap_reverting')
        # Repeated None is legal only after this operation's durable rollback intent.
        if self.publisher.current() is not None: self.publisher.atomic_pointer('current', None)
        self.publisher.persist(record, 'bootstrap_reverted')
        return record

    def open(self, operation, policy_sha, completion_sha):
        policy, backend = self.context(operation, policy_sha, completion_sha)
        record = self.frontend_record(operation, policy, completion_sha)
        namespace = policy['frontendBootstrap']['namespace']
        if (record['state'] != 'committed' or record.get('success') is not True
                or self.publisher.current() != namespace or self.ops.frontend_checking() != marker(policy)):
            raise ValueError('Verified exact static bootstrap required before opening')
        value = self.publisher.sealed(namespace, policy['frontendBootstrap']['manifestSha256'])
        if self.publisher.checked_meta(value) != policy['target'] or not self.publisher.check(namespace, policy['target']):
            raise ValueError('Fresh independent static read-only checks failed')
        self.context(operation, policy_sha, completion_sha)
        self.frontend_record(operation, policy, completion_sha)
        self.ops.frontend_mark(None)
        self.ops.ingress_mode(operation, 'draining', policy)
        self.window.engine.drain(policy['target'], operation, backend['candidatePid'])
        self.context(operation, policy_sha, completion_sha, modes=('draining',))
        record = self.frontend_record(operation, policy, completion_sha)
        if record['state'] != 'committed' or record.get('success') is not True or self.publisher.current() != namespace:
            raise ValueError('Frontend pair changed during the final drain')
        # This durable intent permanently disallows automatic B0 recovery, even
        # if a crash occurs between opening the Node gate and the public gate.
        self.window.write(backend, 'opening', writesMayHaveOpened=True)
        try:
            self.window.engine.gate(operation, 'open')
            status = self.window.engine.observed(policy['target'], pid=backend['candidatePid'])
            if (status['admissionMode'] != 'open' or status['admissionEpoch'] != operation
                    or self.ops.process() != backend['candidateProcess'] or self.ops.current() != policy['target']
                    or self.publisher.current() != namespace):
                raise ValueError('Exact frontend/backend pair changed while opening')
            self.ops.open_ingress(policy)
            if (self.ops.process() != backend['candidateProcess'] or self.ops.current() != policy['target']
                    or self.publisher.current() != namespace):
                raise ValueError('Exact frontend/backend pair changed after ingress opening')
            self.window.write(backend, 'committed', writesOpened=True)
            return backend
        except Exception:
            self.window.engine.gate(operation, 'draining')
            try: self.ops.seal_ingress(policy)
            finally: self.window.write(backend, 'needs_attention', writesMayHaveOpened=True)
            raise
