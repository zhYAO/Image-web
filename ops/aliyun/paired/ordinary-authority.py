"""Read installed authority and exchange fixed read-only verifier challenges.

The fixed receiver supplies the root-file reader and atomic challenge writer.
Authorization, application credentials and results remain independently held.
"""
from copy import deepcopy
import hashlib
import os
from pathlib import Path
import re
import secrets
import time

import ordinary

ETC = Path('/etc/zimage')
CONFIG = ETC / 'ordinary-authority.json'
TOKEN = ETC / 'ordinary-github-observer.token'
AUTHORIZATIONS = ETC / 'ordinary-authorizations'
EVIDENCE = ETC / 'ordinary-evidence'
PROJECT = 'klmiycyesxnpinxpeqep'
MAX_RECORDS = 512
MAX_AGE = 120
VERIFY_WAIT = 110
OPERATION = re.compile(r'zimage-release-([1-9][0-9]{0,18})-([1-9][0-9]{0,18})')
LIFECYCLE = {'operationId', 'oldBackend', 'oldFrontend', 'newBackend', 'newFrontend',
             'oldFrontendArtifact', 'backendManifestSha256', 'frontendCandidateSha256',
             'frontendPayloadSha256', 'configurationSha256', 'ingressSha256'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Authority:
    def __init__(self, *, core, tools, public, read, trusted, root, observe=None, clock=time.time,
                 monotonic=time.monotonic, sleep=time.sleep):
        self.core, self.tools, self.read, self.trusted, self.root = core, tools, read, trusted, root
        self.public = public
        self.observe = observe
        self.clock = clock
        self.monotonic, self.sleep = monotonic, sleep
        self.batch = None
        config = core.parse(read(CONFIG, 65536))
        core.exact(config, {'schemaVersion', 'signerPolicy', 'mergePolicy', 'attestationDigests'})
        require(type(config['schemaVersion']) is int and config['schemaVersion'] == 1
                and all(type(config[name]) is dict for name in ('signerPolicy', 'mergePolicy', 'attestationDigests')),
                'Invalid installed authority policy')
        self.signer_policy = config['signerPolicy']
        self.merge_policy = config['mergePolicy']
        self.attestation_digests = config['attestationDigests']

    @property
    def github_read_token(self):
        return self.read(TOKEN, 1024, private=True).decode('ascii').removesuffix('\n')

    def _record(self, path):
        body = self.read(path, 262144)
        return self.core.parse(body), hashlib.sha256(body).hexdigest()

    def authorization(self, packet):
        self.batch = None
        ordinary.exact(packet, ordinary.PACKET)
        for key in ('runId', 'attempt'):
            require(type(packet[key]) is int and 0 < packet[key] < 2**63, 'Invalid release batch')
        batch = f"{packet['runId']}-{packet['attempt']}"
        self.trusted(AUTHORIZATIONS, True)
        record, _ = self._record(AUTHORIZATIONS / (batch + '.json'))
        self.core.exact(record, {'schemaVersion', 'approval', 'sha256', 'stageSha256', 'lifecycle', 'lifecycleSha256'})
        require(type(record['schemaVersion']) is int and record['schemaVersion'] == 1, 'Unknown authorization schema')
        approval = record['approval']
        ordinary.inputs(packet, approval, record['sha256'], int(self.clock()))
        require(approval['operation'] == 'zimage-release-' + batch, 'Release attempt must retain one journal identity')
        self.core.hexid(record['stageSha256'])
        lifecycle = record['lifecycle']
        self.core.exact(lifecycle, LIFECYCLE)
        self.core.hexid(record['lifecycleSha256'])
        require(self.core.digest(lifecycle) == record['lifecycleSha256'], 'Installed lifecycle digest differs')
        identities = dict(operationId=approval['operation'], oldBackend=approval['oldPair']['backend'],
                          oldFrontend=approval['oldPair']['frontend'], newBackend=approval['newPair']['backend'],
                          newFrontend=approval['newPair']['frontend'], backendManifestSha256=packet['backendManifestSha256'])
        require(all(lifecycle[k] == value for k, value in identities.items()), 'Installed lifecycle pair differs')
        for key in LIFECYCLE - identities.keys():
            self.core.hexid(lifecycle[key])
        evidence_dir = EVIDENCE / batch
        self.trusted(evidence_dir, True)
        self.batch = dict(packet=deepcopy(packet), approval=deepcopy(approval), lifecycle=deepcopy(lifecycle),
                          digest=record['sha256'], directory=evidence_dir)
        return {name: deepcopy(record[name]) for name in ('approval', 'sha256', 'stageSha256')}

    def _bound(self, packet, approval):
        require(self.batch is not None and self.batch['packet'] == packet and self.batch['approval'] == approval,
                'Evidence consumer has no exact authorized batch')

    def lifecycle_policy(self, packet, approval):
        self._bound(packet, approval)
        return deepcopy(self.batch['lifecycle'])

    def _entries(self, directory):
        self.trusted(directory, True)
        paths = []
        with os.scandir(directory) as entries:
            for entry in entries:
                require(len(paths) < MAX_RECORDS, 'Installed journal inventory exceeds bound')
                paths.append(Path(entry.path))
        return paths

    def seen(self):
        result = set()
        for path in self._entries(self.root / 'ordinary-operations'):
            self.trusted(path, True)
            match = OPERATION.fullmatch(path.name)
            if match:
                result.add((self.signer_policy['repositoryId'], int(match[1]), int(match[2])))
        return result

    def assert_other_writers_clear(self):
        backend = self.root / 'backend-operations'
        self.trusted(backend, True)
        for filename, phases in (('current.json', {'committed', 'cancelled', 'recovered'}),
                                 ('first-window-current.json', {'committed', 'recovered_open'})):
            path = backend / filename
            if os.path.lexists(path):
                state, _ = self._record(path)
                require(state['phase'] in phases, 'Earlier backend operation is unresolved')
        for path in self._entries(self.root / 'frontend/journal'):
            state, _ = self._record(path)
            require(state['state'] in ('committed', 'recovered'), 'Earlier frontend operation is unresolved')
        for path in self._entries(self.root / 'paired-operations'):
            state = self.core.Journal(path).load()
            require(state is not None and state['phase'] in ('opened', 'recovered'), 'Earlier paired operation is unresolved')
        for name in ('current.next', 'previous.next', 'current.backend-next', 'previous.backend-next'):
            require(not os.path.lexists(self.root / name), 'Earlier pointer update is unresolved')

    def _evidence(self, filename, kind, fields):
        require(self.batch is not None, 'No exact batch for host evidence')
        value, digest = self._record(self.batch['directory'] / filename)
        self._check_evidence(value, kind, fields)
        return value, digest

    def _check_evidence(self, value, kind, fields):
        self.core.exact(value, {'schemaVersion', 'kind', 'packetSha256', 'operationId', 'observedAt'} | fields)
        checked, now = value['observedAt'], self.clock()
        require(type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and value['kind'] == kind
                and value['operationId'] == self.batch['approval']['operation']
                and value['packetSha256'] == self.batch['approval']['packetSha256']
                and type(checked) is int and 0 <= now - checked <= MAX_AGE,
                'Host evidence is stale or belongs to a different batch')

    def database_digest(self):
        evidence, _ = self._evidence('database.json', 'zimage-ordinary-database-v1',
                                     {'projectRef', 'contractSha256', 'readOnly'})
        require(evidence['projectRef'] == PROJECT and evidence['readOnly'] is True,
                'Independent read-only database observation required')
        self.core.hexid(evidence['contractSha256'])
        return evidence['contractSha256']

    def verify_baseline(self, initial, approval):
        require(self.batch is not None, 'No exact batch for host evidence')
        self._bound(self.batch['packet'], approval)
        evidence, digest = self._evidence('baseline.json', 'zimage-ordinary-baseline-v1',
                                          {'pair', 'snapshotSha256', 'rollbackDrillSha256'})
        require(digest == approval['baselineAcceptanceSha256'] and evidence['pair'] == approval['oldPair']
                and evidence['snapshotSha256'] == self.core.digest(initial), 'Live baseline and independent acceptance differ')
        self.core.hexid(evidence['rollbackDrillSha256'])
        drill, drill_digest = self._record(self.batch['directory'] / 'rollback-drill.json')
        self.core.exact(drill, {'schemaVersion', 'kind', 'pair', 'retainedArtifact', 'status', 'publicAcceptanceSha256'})
        require(type(drill['schemaVersion']) is int and drill['schemaVersion'] == 1
                and drill['kind'] == 'zimage-ordinary-rollback-drill-v1' and drill['status'] == 'restored'
                and drill_digest == evidence['rollbackDrillSha256'] and drill['pair'] == approval['oldPair']
                and drill['retainedArtifact'] == initial['frontendArtifact'], 'Actual rollback rehearsal evidence required')
        self._public_acceptance('rollback-public.json', drill['publicAcceptanceSha256'], approval['oldPair'])
        self._candidate('baseline-readonly', initial['process'], self.batch['packet'], approval,
                        approval['operation'], approval['oldPair']['backend'])

    def _public_acceptance(self, filename, expected, pair):
        self.core.hexid(expected)
        value, digest = self._record(self.batch['directory'] / filename)
        acceptance = dict(schemaVersion=1, backendRelease=pair['backend'], frontendRelease=pair['frontend'],
                          health='ok', routes=list(self.public.ROUTES), anonymousSessionStatus=401)
        require(digest == expected and type(value) is dict and type(value.get('schemaVersion')) is int
                and type(value.get('anonymousSessionStatus')) is int and value == acceptance,
                'Independent public readiness, routes and release pair required')

    def _candidate(self, stage, process, packet, approval, operation, release):
        self._bound(packet, approval)
        self.core.exact(process, {'pid', 'startTicks', 'bootId'})
        require(type(process['startTicks']) is int and process['startTicks'] > 0
                and type(process['bootId']) is str and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',
                                                                  process['bootId']), 'Exact live process required')
        now = int(self.clock())
        expires = min(now + MAX_AGE, approval['expiresAt'])
        request = dict(schemaVersion=1, operationId=operation, backendRelease=release, pid=process['pid'],
                       nonce=secrets.token_hex(32), createdAt=now, expiresAt=expires)
        self.tools.receipt.validate_request(request, operation=operation, release=release, pid=process['pid'], now=now)
        directory = self.batch['directory']
        self.trusted(directory, True)
        challenge = directory / (stage + '-challenge.json')
        try:
            self.read(challenge, 4096, private=True)
        except FileNotFoundError:
            pass
        else:
            raise ValueError('A challenge for this release phase already exists')
        payload = dict(schemaVersion=1, kind='zimage-ordinary-readonly-challenge-v1', packetSha256=approval['packetSha256'],
                       operationId=approval['operation'], process=deepcopy(process), request=deepcopy(request))
        self.tools.transaction.atomic_json(challenge, payload)
        deadline = self.monotonic() + min(VERIFY_WAIT, expires - now)
        filename = stage + '.json'
        evidence = self._candidate_response(filename, payload, deadline, expires)
        require(self.monotonic() <= deadline and self.clock() < expires
                and self.core.canonical([evidence['process'], evidence['request']]) == self.core.canonical([process, request]),
                'Probe must match the fresh challenge and exact live process')
        self.tools.receipt.validate_receipt(evidence['receipt'], request, operation=operation,
                                            release=release, pid=process['pid'], now=self.clock())
        if self.observe is not None:
            self.tools.transaction.atomic_json(directory / filename, evidence)

    def _candidate_response(self, filename, challenge, deadline, expires):
        kind, fields = 'zimage-ordinary-candidate-v1', {'process', 'request', 'receipt'}
        if self.observe is not None:
            evidence = self.observe(challenge, deadline=deadline)
            self._check_evidence(evidence, kind, fields)
            return evidence
        while True:
            try:
                evidence, _ = self._evidence(filename, kind, fields)
                return evidence
            except FileNotFoundError:
                left = min(deadline - self.monotonic(), expires - self.clock())
                require(left > 0, 'Independent read-only verifier did not return a receipt in time')
                self.sleep(min(left, 0.25))

    def verify_candidate(self, process, packet, approval):
        self._candidate('candidate', process, packet, approval, approval['operation'], packet['commit'])

    def verify_restored_candidate(self, process, packet, approval):
        recovery = 'restore-' + ordinary.sha(dict(operation=approval['operation'], approval=ordinary.sha(approval)))[:48]
        self._candidate('restoration-candidate', process, packet, approval, recovery, approval['oldPair']['backend'])

    def _public_record(self, filename, packet, approval, snapshot, pair, status):
        self._bound(packet, approval)
        evidence, digest = self._evidence(filename, 'zimage-ordinary-public-v1',
                                          {'pair', 'snapshotSha256', 'status', 'checksSha256'})
        require(evidence['pair'] == pair and evidence['status'] == status
                and evidence['snapshotSha256'] == self.core.digest(snapshot), 'Public evidence differs from the live pair')
        self.core.hexid(evidence['checksSha256'])
        return evidence['checksSha256'], digest

    def verify_public_failure(self, packet, approval, snapshot):
        pair = approval['newPair']
        expected, digest = self._public_record('public-failure.json', packet, approval, snapshot, pair, 'failed')
        witness, actual = self._record(self.batch['directory'] / 'failed-public-acceptance.json')
        require(actual == expected, 'Public failure witness does not match the independent evidence digest')
        self.public.validate_failure(witness, pair)
        return digest

    def verify_public_restoration(self, packet, approval, snapshot):
        pair = approval['oldPair']
        expected, digest = self._public_record('public-restored.json', packet, approval, snapshot, pair, 'passed')
        self._public_acceptance('restored-public-acceptance.json', expected, pair)
        return digest


def open_authority(*, core, tools, public, read, trusted, root, observe):
    return Authority(core=core, tools=tools, public=public, read=read, trusted=trusted, root=root, observe=observe)
