"""Restore one completed ordinary release through the existing fenced writer.

Installed callers supply root policy and independently obtained failure and
acceptance evidence. This module has no SSH or command-line entrypoint.
"""
from copy import deepcopy


def restore(packet, approval, approval_sha256, *, system, gate, authority, ordinary, clock):
    """Restore only the exact published generation, without replaying an interruption."""
    packet, approval = deepcopy(packet), deepcopy(approval)
    with gate.lock(blocking=False):
        ordinary.inputs(packet, approval, approval_sha256, clock())
        old, new = approval['oldPair'], approval['newPair']
        operation = approval['operation']
        policy = system.p
        ordinary.valid((policy['operationId'], policy['oldBackend'], policy['oldFrontend'],
                        policy['newBackend'], policy['newFrontend']) ==
                       (operation, old['backend'], old['frontend'], new['backend'], new['frontend']),
                       'Restoration policy does not match the original release')
        seal, opened = gate.claim_restoration(operation, approval_sha256)
        ordinary.exact(seal, {'initial', 'retained'})
        ordinary.exact(opened, {'process', 'pairSequence'})
        retained = seal['retained']
        ordinary.exact(retained, {'backendManifestSha256', 'frontendManifestSha256', 'frontendArtifact'})
        for digest in retained.values():
            ordinary.hexid(digest)
        ordinary.valid((seal['initial']['backend'], seal['initial']['frontend'], seal['initial']['frontendArtifact']) ==
                       (old['backend'], old['frontend'], retained['frontendArtifact'])
                       and retained['frontendArtifact'] == policy['oldFrontendArtifact'],
                       'Original rollback pair and retained evidence differ')
        authority.assert_other_writers_clear()

        def state(ops, pair, process, sequence, ingress, node):
            gate.lock_identity()
            live = ops.snapshot()
            ordinary.valid((live['backend'], live['frontend'], live['process'], live['frontendSequence'],
                            live['ingressMode'], live['nodeMode'], live['configurationSha256'], live['ingressSha256']) ==
                           (pair['backend'], pair['frontend'], process, sequence, ingress, node,
                            policy['configurationSha256'], policy['ingressSha256'])
                           and authority.database_digest() == approval['databaseSha256'],
                           'Live pair, process, generation, or database no longer matches restoration')
            if ingress == 'open':
                ordinary.valid(live['fence'] is None and live['markers']['open'] == ops.token(),
                               'Open marker differs from the reviewed generation')
            else:
                ops.require_ours(checking=ingress == 'checking')
            return live

        live = state(system, new, opened['process'], opened['pairSequence'], 'open', 'open')
        failure = authority.verify_public_failure(packet, approval, deepcopy(live))
        ordinary.hexid(failure)
        restore_id = 'restore-' + ordinary.sha(dict(operation=operation, approval=approval_sha256))[:48]
        reverse = system.reversal(restore_id, retained['backendManifestSha256'])
        reverse.validate_backend(old['backend'], retained['backendManifestSha256'])
        value = reverse.pub.sealed(old['frontend'], retained['frontendManifestSha256'])
        ordinary.valid(value['artifactId'] == retained['frontendArtifact'] and value['sourceSHA'] == old['backend'],
                       'Retained frontend differs from the release baseline')
        ordinary.inputs(packet, approval, approval_sha256, clock())
        ordinary.valid(live == state(system, new, opened['process'], opened['pairSequence'], 'open', 'open'),
                       'Published generation changed during restoration preflight')

        def journal(phase, evidence):
            gate.journal(dict(operation=operation, rootApprovalSha256=approval_sha256, phase=phase), evidence=evidence)

        record = dict(operationId=restore_id, initial=deepcopy(live), migrationNonce=None, phase='backend_select_intent')
        journal('restore-intent', dict(restorationOperationId=restore_id, publicFailureSha256=failure))
        try:
            reverse.seal(record)
            reverse.drain(record, live['process'])
            reverse.stop(record, live['process'])
            reverse.select_backend(record)
            started = reverse.start(record, old['backend'])
            process = started['process']
            ordinary.valid(process is not None and process != live['process'], 'New restored backend process required')
            record['candidateProcess'] = deepcopy(process)
            selected = reverse.publish_frontend(record, dict(artifactId=retained['frontendArtifact'],
                                                               manifestSha256=retained['frontendManifestSha256']))
            sequence = selected['frontendSequence']
            ordinary.valid(sequence == live['frontendSequence'] + 1, 'Unexpected restored frontend generation')
            record['pairSequence'] = sequence
            state(reverse, old, process, sequence, 'checking', 'checking')
            reverse.probe(record)
            authority.verify_restored_candidate(process, packet, approval)
            gate.lock_identity()
            reverse.drain(record, process)
            state(reverse, old, process, sequence, 'sealed', 'draining')
            ordinary.inputs(packet, approval, approval_sha256, clock())
            journal('restore-open-intent', dict(process=process, pairSequence=sequence))
            record.update(phase='opening', writesMayHaveOpened=True)
            reverse.open(record, process)
            restored = state(reverse, old, process, sequence, 'open', 'open')
            reverse.probe(record)
            public = authority.verify_public_restoration(packet, approval, deepcopy(restored))
            ordinary.hexid(public)
            state(reverse, old, process, sequence, 'open', 'open')
            reverse.finish_frontend(record, remember_previous=False)
            state(reverse, old, process, sequence, 'open', 'open')
            receipt = dict(schemaVersion=1, kind='zimage-ordinary-restoration-v1', status='restored',
                           operationId=operation, restorationOperationId=restore_id, commit=packet['commit'],
                           runId=packet['runId'], attempt=packet['attempt'], rootApprovalSha256=approval_sha256,
                           restoredPair=old, rollbackAcceptanceSha256=approval['baselineAcceptanceSha256'],
                           publicFailureSha256=failure, publicRestorationSha256=public)
            journal('restored', receipt)
            return receipt
        except Exception:
            gate.lock_identity()
            reverse.hold(record)
            raise
