#!/usr/bin/env python3
"""Host-only preparation of already downloaded proof; never starts the app."""
import importlib.util
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
CACHE = Path('/opt/zimage/layer-cache')


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if len(sys.argv) != 5:
        raise ValueError('Expected absolute proof dir, trusted gh JSON, new output, fresh cache')
    proof, verified, out, cache = map(Path, sys.argv[1:])
    if sys.platform != 'linux' or cache != CACHE:
        raise ValueError('Expected disposable exact Linux target and cache')
    if (cache.resolve(strict=True) != cache or not cache.is_dir() or any(cache.iterdir())
            or cache.stat().st_uid != os.getuid() or cache.stat().st_mode & 0o077):
        raise ValueError('Expected empty private disposable cache')
    if (not out.is_absolute() or out.parent.resolve(strict=True) != out.parent or out.parent.stat().st_uid != os.getuid()
            or out.parent.stat().st_mode & 0o077 or os.path.lexists(out)):
        raise ValueError('Expected new private output')
    verifier = load('signed_input', HERE / 'verify-92663-isolated-input.py')
    verifier.verify(proof, verified)
    intake = load('immutable_pair', HERE / 'github-rehearsal-intake.py')
    pins = intake.read_json(proof / 'pins.json')
    sha = verifier.SHA
    if (pins['commit'], pins['runId'], pins['attempt']) != (sha, verifier.RUN, 1) or not intake.hosted_namespace(pins, 'hosted-shadow'):
        raise ValueError('Expected exact signed artifact scope')
    result = intake.evaluate(pins, proof / 'backend.zip', proof / 'frontend.zip', intake.read_json(proof / 'config.json'))
    if (result.get('productionReady') is not False or result.get('immutablePairVerified') is not True
            or result.get('status') != 'blocked'):
        raise ValueError('Immutable diagnostic pair not verified')
    out.mkdir(mode=0o700)
    for name, allowed in (('backend',['transport.tgz','rehearsal-receipt.json']),
                          ('frontend',['frontend-rehearsal.tgz','frontend-subject.json','rehearsal-receipt.json'])):
        directory = out/name
        intake.extract_github_zip(proof/(name+'.zip'), directory, pins[name]['artifactSha256'], allowed)
        intake.closure_receipt(directory, name, pins[name], sha, verifier.RUN, 1, shadow=True)
    store = out/'store'
    transport = intake.load('exact_transport', HERE/'release-transport.py')
    transport.unpack_bundle(out/'backend/transport.tgz', store, sha, pins['backend']['manifestSha256'])
    manifest = intake.load('exact_frontend', HERE/'frontend/manifest.py')
    manifest.extract_strict(out/'frontend/frontend-rehearsal.tgz', out/'web',
                            validator=lambda n: None if n=='.release/candidate.json' else manifest.payload_path(n),
                            max_bytes=100_000_000)
    assembler = intake.load('exact_assembler', HERE/'three-layer-release.py')
    assembler.assemble(store/'releases'/(sha+'.json'), store, out/'app', cache, pins['backend']['manifestSha256'], True)
    print(json.dumps(dict(commit=sha, namespace=pins['frontendNamespace'], applicationStarted=False, productionReady=False)))


if __name__ == '__main__':
    try:
        main()
    except (KeyError, OSError, TypeError, ValueError):
        sys.exit('Exact signed archive preparation refused')
