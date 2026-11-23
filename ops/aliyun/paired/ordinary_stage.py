"""Prepare authorized bytes from the private SSH spool without selecting a pair."""
import hashlib


def prepare(request, evidence, packet, approval, *, system, intake):
    core = system.c
    manifest = system.m.frontend.m
    sha, run, attempt = (packet[key] for key in ('commit', 'runId', 'attempt'))
    pins = intake.read_json(request / 'pins.json')
    if ((pins['commit'], pins['runId'], pins['attempt']) != (sha, run, attempt)
            or not intake.hosted_namespace(pins, 'hosted-shadow')
            or pins['backend']['manifestSha256'] != packet['backendManifestSha256']
            or pins['backend']['archiveSha256'] != approval['backendArchiveSha256']
            or pins['frontend']['subjectSha256'] != packet['frontendSubjectSha256']):
        raise ValueError('Root approval and signed artifact pins differ')

    work = request / 'private-pair-stage'
    work.mkdir(mode=0o700)
    for component, names in (
        ('backend', ('transport.tgz', 'rehearsal-receipt.json')),
        ('frontend', ('frontend-rehearsal.tgz', 'frontend-subject.json', 'rehearsal-receipt.json')),
    ):
        digest = evidence['artifactDigests'][component]
        component_pins = pins[component]
        if component_pins['artifactSha256'] != digest:
            raise ValueError('Artifact pin differs from independently verified ZIP digest')
        directory = work / component
        intake.extract_github_zip(request / (component + '.zip'), directory, digest, names)
        intake.closure_receipt(directory, component, component_pins, sha, run, attempt, shadow=True)

    config = intake.read_json(request / 'config.json')
    dist = work / 'dist'
    manifest.extract_strict(work / 'frontend/frontend-rehearsal.tgz', dist,
                            validator=lambda name: None if name == '.release/candidate.json' else manifest.payload_path(name),
                            max_bytes=100_000_000)
    _, candidate, subject = manifest.candidate_files(dist, config)
    if (intake.read_json(work / 'frontend/frontend-subject.json') != dict(subject, **candidate, acceptanceRequired=True)
            or candidate['namespace'] != approval['newPair']['frontend']
            or candidate['allowedBackendReleases'] != [sha]):
        raise ValueError('Frontend source, config or namespace differs from the admitted subject')
    source = candidate['sourceIdentity']
    if source != dict(sourceSHA=sha, treeFingerprint=pins['treeFingerprint'], lockfileSha256=pins['lockfileSha256'], dirty=False):
        raise ValueError('Frontend source identity differs from signed pair')

    artifact = manifest.artifact_identity(subject['payloadIndexSha256'], subject['publicConfigFingerprint'])
    core.hexid(artifact)
    acceptance_bytes = system.raw(system.paths.etc / 'frontend-acceptances' / (artifact + '.json'))
    acceptance = core.parse(acceptance_bytes)
    acceptance_evidence = dict(subject, backendReleases=[dict(backendRelease=sha,
                                                              acceptanceSha256=approval['stagingAcceptanceSha256'])])
    if acceptance != dict(acceptance_evidence, artifactId=artifact, manifestSha256=approval['frontendManifestSha256']):
        raise ValueError('Production frontend acceptance is absent or not bound to this pair')
    options = dict(assetNamespace=candidate['namespace'], sourceSHA=sha, treeFingerprint=source['treeFingerprint'],
                   build=dict(toolchainFingerprint=candidate['buildToolchainFingerprint'], lockfileSha256=source['lockfileSha256']),
                   apiRequirements=candidate['apiRequirements'], verifiedBackendReleases=[sha])
    archive = work / 'frontend-release.tgz'
    packaged = manifest.pack(dist, archive, options, config, acceptance_evidence)
    if ((packaged['artifactId'], packaged['archiveSha256'], packaged['manifestSha256']) !=
            (artifact, approval['frontendArchiveSha256'], approval['frontendManifestSha256'])):
        raise ValueError('Rebuilt formal frontend differs from the approved package')

    backend = work / 'backend/transport.tgz'
    staged = system.m.stage.prepare(system.m.bridge, system.m.adapter, sha, approval['backendArchiveSha256'],
                                    packet['backendManifestSha256'], received=backend)
    if (staged['backendRelease'] != sha or staged['manifestSha256'] != packet['backendManifestSha256']
            or staged['activated'] is not False):
        raise ValueError('Backend did not return exact staging-only evidence')
    return dict(archiveSha256=packaged['archiveSha256'], manifestSha256=packaged['manifestSha256'], artifactId=artifact,
                candidateSha256=subject['candidateSha256'], payloadSha256=subject['payloadIndexSha256'],
                acceptanceSha256=hashlib.sha256(acceptance_bytes).hexdigest())
