#!/usr/bin/env python3
"""Host-only preparation of already downloaded proof; never starts the app."""
import importlib.util
import json
import shutil
import tempfile
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
    exact = verifier.verify(proof, verified)
    if (exact['files']['backend.zip']['sha256'] != verifier.BACKEND_ZIP
            or exact['files']['frontend.zip']['sha256'] != verifier.FRONTEND_ZIP):
        raise ValueError('Signed files differ from independent outer ZIP digests')
    materialize = load('generic_hosted_pair', HERE / 'prepare-hosted-shadow-pair.py')
    # Generic entrypoint deliberately rejects extra attestation members.
    # Copy only four verified files to fresh 0700 sibling; generic intake
    # independently rechecks the resulting ZIPs against fixed digests.
    with tempfile.TemporaryDirectory(prefix='verified-originals-', dir=out.parent) as name:
        inputs = Path(name)
        for n in verifier.FILES:
            shutil.copyfile(proof / n, inputs / n)
            (inputs / n).chmod(0o400)
            if verifier.read(inputs / n, 40_000_000 if n.endswith('.zip') else 16384)[0] != exact['files'][n]:
                raise ValueError('Copied original changed after verification')
        materialize.run(inputs, out, cache, materialize.module(), commit=verifier.SHA, run_id=verifier.RUN,
                        attempt=1, backend_sha256=verifier.BACKEND_ZIP, frontend_sha256=verifier.FRONTEND_ZIP)
    print(json.dumps(dict(commit=verifier.SHA, namespace='release-' + verifier.SHA[:12],
                          applicationStarted=False, productionReady=False)))


if __name__ == '__main__':
    try:
        main()
    except (KeyError, OSError, TypeError, ValueError):
        sys.exit('Exact signed archive preparation refused')
