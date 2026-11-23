"""Connect the authenticated SSH payload to the existing ordinary transaction.

The installed root command must supply the trusted host adapter. No command,
scope, approval, verifier or rollback target may be supplied over SSH.
"""
from pathlib import Path
import tempfile

from ordinary_system import OrdinarySystem


def run(stream, *, scratch, host, handoff, ordinary):
    """Consume one request; only a successfully opened pair yields a receipt.

    ``host`` is the reviewed, root-owned integration boundary, including the
    independent GitHub/TLS client, pinned verifier, root approval reader,
    lifecycle tools and evidence authority. OrdinarySystem uses the common
    deployment lock and checks real rollback evidence before the first intent.
    """
    with tempfile.TemporaryDirectory(prefix='ordinary-pair-', dir=scratch) as temp:
        request = Path(temp)
        handoff.receive(stream, request)
        evidence = handoff.admit(request, policy=host.policy, get=host.get, verify=host.verify,
                                 intake=host.intake, now=host.clock(), seen=host.seen())
        packet = evidence['packet']
        authorization = host.authorization(packet)
        ordinary.exact(authorization, {'approval', 'sha256', 'stageSha256'})
        ordinary.valid(authorization['stageSha256'] == evidence['stageSha256'],
                       'Installed authorization does not name the verified stage')
        approval, digest = authorization['approval'], authorization['sha256']
        ordinary.inputs(packet, approval, digest, host.clock())
        ordinary.valid(evidence['rollbackPair'] == approval['oldPair'],
                       'Observed public rollback pair differs from installed authorization')

        ops = OrdinarySystem(host.system, host.gate, host.authority, request, evidence)
        result = ordinary.transition(packet, approval, digest, ops, clock=host.clock)
        ordinary.valid(result == {'operation': approval['operation'], 'phase': 'opened',
                                  'pair': approval['newPair']}, 'Unconfirmed production result')
        return {'schemaVersion': 1, 'kind': 'zimage-ordinary-pair-v1', 'status': 'opened',
                'operationId': approval['operation'], 'commit': packet['commit'],
                'runId': packet['runId'], 'attempt': packet['attempt'],
                'backendRelease': result['pair']['backend'], 'frontendRelease': result['pair']['frontend'],
                'backendManifestSha256': packet['backendManifestSha256'],
                'frontendSubjectSha256': packet['frontendSubjectSha256'], 'stageSha256': evidence['stageSha256'],
                'rootApprovalSha256': digest, 'rollbackPair': approval['oldPair'],
                'rollbackAcceptanceSha256': approval['baselineAcceptanceSha256']}
