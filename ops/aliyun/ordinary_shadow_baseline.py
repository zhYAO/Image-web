"""Read-only active baseline measurement; trusted adapter inputs, never a CLI."""
import hashlib
import re


def require(condition, message):
    if not condition:
        raise ValueError(message)


def measure(ops):
    """Caller holds and rechecks JournalGate; ops is the audited SystemOps instance."""
    before = ops.snapshot()
    release, namespace = before['backend'], before['frontend']
    require(type(release) is str and re.fullmatch('[0-9a-f]{40}', release), 'Invalid backend identity')
    require(namespace == 'release-' + release[:12],
            'Invalid frontend namespace')
    require(before['nodeMode'] == before['ingressMode'] == 'open' and before['process'] is not None,
            'Active baseline is not open')
    target = ops.paths.root / 'releases' / release
    ops.owned(target, directory=True)
    require(ops.raw(target / '.release-sha', 128).strip() == release.encode(), 'Backend marker mismatch')
    raw = ops.raw(target / '.three-layer-release.json')
    digest = hashlib.sha256(raw).hexdigest()
    require(ops.raw(target / '.manifest-sha256', 128).strip() == digest.encode(), 'Backend manifest mismatch')
    backend = ops.c.parse(raw)
    adapter = ops.m.adapter
    adapter.validate_manifest(backend, release)
    adapter.target_check()
    adapter.verify_store_closure(backend, raw, release, digest)
    frontend = ops.pub.sealed(namespace)
    artifact = frontend['artifactId']
    config = frontend['build']['publicConfigFingerprint']
    require(type(artifact) is str and re.fullmatch('[0-9a-f]{64}', artifact)
            and artifact == before['frontendArtifact'], 'Frontend artifact mismatch')
    require(frontend['sourceSHA'] == release and frontend['assetNamespace'] == namespace,
            'Frontend is not part of the exact active pair')
    require(type(config) is str and re.fullmatch('[0-9a-f]{64}', config),
            'Frontend build fingerprint missing')
    require(ops.pub.checked_meta(frontend) == release, 'Live frontend/backend compatibility mismatch')
    require(ops.snapshot() == before, 'Active baseline moved')
    return dict(rollbackBackendSHA=release, rollbackFrontendSHA=frontend['sourceSHA'],
                rollbackBackendManifestSha256=digest, rollbackFrontendArtifactSha256=artifact,
                rollbackFrontendConfigFingerprint=config)
