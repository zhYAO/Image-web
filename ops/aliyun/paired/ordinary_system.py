"""No-migration lifecycle adapter for the installed paired release tools.

The authority supplies independently verified evidence and private staging.
The existing SystemOps performs every service and ingress mutation.
"""
from copy import deepcopy


def require(condition, message):
    if not condition:
        raise ValueError(message)


class OrdinarySystem:
    def __init__(self, system, gate, authority, request, evidence):
        self.system = system
        self.gate = gate
        self.authority = authority
        self.request = request
        self.evidence = deepcopy(evidence)
        self.record = None
        self.frontend_approval = None

    def lock(self):
        return self.gate.lock(blocking=False)

    def assert_clear(self, operation):
        require(self.record is None and operation == self.system.p['operationId'], 'Wrong installed operation')
        self.gate.assert_clear(operation)
        self.authority.assert_other_writers_clear()

    def assert_main(self, commit):
        self.gate.lock_identity()
        self.authority.assert_main(commit)

    def snapshot(self):
        self.gate.lock_identity()
        live = self.system.snapshot()
        for key in ('configurationSha256', 'ingressSha256'):
            require(live[key] == self.system.p[key], 'Live service or ingress configuration changed')
        mode = live['ingressMode']
        require(mode in ('open', 'sealed', 'checking'), 'Inconsistent paired ingress state')
        if mode == 'open':
            require(live['nodeMode'] == 'open' and live['fence'] is None and live['process'] is not None,
                    'Exact open pair required')
        else:
            self.system.require_ours(checking=mode == 'checking')
            require(live['nodeMode'] == ('checking' if mode == 'checking' else 'draining'),
                    'Ingress and Node admission differ')
        return dict(backend=live['backend'], frontend=live['frontend'], sealed=mode != 'open',
                    databaseSha256=self.authority.database_digest())

    def verify_inputs(self, packet, approval):
        self.gate.lock_identity()
        p = self.system.p
        require((p['operationId'], p['oldBackend'], p['oldFrontend'], p['newBackend'], p['newFrontend'],
                 p['backendManifestSha256']) ==
                (approval['operation'], approval['oldPair']['backend'], approval['oldPair']['frontend'],
                 packet['commit'], approval['newPair']['frontend'], packet['backendManifestSha256']),
                'Installed lifecycle policy does not bind the approved pair')
        self.authority.verify_protected_merge(packet)
        initial = self.system.snapshot()
        for key, value in (('frontendArtifact', p['oldFrontendArtifact']),
                           ('configurationSha256', p['configurationSha256']), ('ingressSha256', p['ingressSha256'])):
            require(initial[key] == value, 'Live baseline differs from lifecycle policy')
        old_backend = approval['oldPair']['backend']
        retained = self.system.paths.root / 'releases' / old_backend
        self.system.m.adapter.verify_retained_layered(retained, old_backend, run_probe=False)
        old_frontend = self.system.pub.sealed(approval['oldPair']['frontend'])
        require(old_frontend['artifactId'] == p['oldFrontendArtifact'] and old_frontend['sourceSHA'] == old_backend
                and self.system.pub.checked_meta(old_frontend) == old_backend,
                'Retained frontend and live rollback backend differ')
        self.authority.verify_baseline(initial, approval)
        frontend = self.authority.prepare(self.request, self.evidence, packet, approval)
        require((frontend['archiveSha256'], frontend['manifestSha256'], frontend['candidateSha256'],
                 frontend['payloadSha256']) ==
                (approval['frontendArchiveSha256'], approval['frontendManifestSha256'],
                 p['frontendCandidateSha256'], p['frontendPayloadSha256']),
                'Prepared frontend differs from the independent approval')
        self.system.validate_backend(packet['commit'], packet['backendManifestSha256'])
        require(initial == self.system.snapshot(), 'Live baseline changed while preparing the signed pair')
        self.record = dict(operationId=approval['operation'], initial=deepcopy(initial), migrationNonce=None)
        self.frontend_approval = deepcopy(frontend)

    def journal(self, event):
        phase = event['phase']
        evidence = None
        if phase == 'seal-intent':
            evidence = {'initial': self.record['initial']}
        elif phase == 'writes-may-open':
            evidence = {'process': self.record['candidateProcess'], 'pairSequence': self.record['pairSequence']}
        self.gate.journal(event, evidence=evidence)
        self.record['phase'] = {'backend-intent': 'backend_select_intent', 'writes-may-open': 'opening'}.get(phase, phase)
        if phase == 'writes-may-open':
            self.record['writesMayHaveOpened'] = True

    def seal_and_drain(self):
        self.gate.lock_identity()
        process = self.record['initial']['process']
        self.system.seal(self.record)
        self.system.drain(self.record, process)
        self.system.stop(self.record, process)

    def select_backend(self, packet, approval):
        self.gate.lock_identity()
        self.system.select_backend(self.record)
        live = self.system.start(self.record, packet['commit'])
        process = live['process']
        require(process is not None and process != self.record['initial']['process'], 'New exact process required')
        self.record['candidateProcess'] = deepcopy(process)

    def select_frontend(self, packet, approval):
        self.gate.lock_identity()
        self.system.prepare_frontend(self.record, self.frontend_approval)
        live = self.system.publish_frontend(self.record, self.frontend_approval)
        require(live['frontendSequence'] == self.record['initial']['frontendSequence'] + 1,
                'Unexpected frontend generation')
        self.record['pairSequence'] = live['frontendSequence']

    def verify_sealed_pair(self, packet, approval):
        self.gate.lock_identity()
        process = self.record['candidateProcess']
        self.system.require_ours(checking=True)
        self.system.exact_process(process)
        self.system.probe(self.record)
        self.authority.verify_candidate(process, packet, approval)
        self.system.exact_process(process)
        self.system.drain(self.record, process)

    def open_pair(self):
        self.gate.lock_identity()
        self.system.open(self.record, self.record['candidateProcess'])
        self.system.probe(self.record)
        self.system.complete(self.record, recovery=False)
