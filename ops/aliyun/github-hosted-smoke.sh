#!/usr/bin/env bash
# Entry point only from github-rehearsal-review.sh after its verified intake.
set -euo pipefail
umask 077
[[ "$#" == 2 && "$(node --version)" == v24.19.0 && "$(pnpm --version)" == 11.19.0 ]]
private=${1:?}
repo=${2:?}
[[ "$private" == "$TMPDIR" && "$repo" == "$(pwd -P)" ]]
mkdir -- "$private/runtime"
result="$private/runtime"
python3 -I -B - "$repo" "$private" "$result" <<'PY'
import importlib.util
from pathlib import Path
import sys
repo, pre, root = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location("rehearsal_intake", repo / "ops/aliyun/github-rehearsal-intake.py")
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)
pins = intake.read_json(pre / "pins.json")
sha = pins["commit"]
if pins["frontendNamespace"] != f"rehearsal-{sha}-{pins['runId']}-{pins['attempt']}":
    raise ValueError("Fixture must never consume a production-shaped candidate")
for component, allowed in (
    ("backend", ["transport.tgz", "rehearsal-receipt.json"]),
    ("frontend", ["frontend-rehearsal.tgz", "frontend-subject.json", "rehearsal-receipt.json"]),
):
    out = root / component
    intake.extract_github_zip(pre / f"{component}.zip", out, pins[component]["artifactSha256"], allowed)
    intake.closure_receipt(out, component, pins[component], sha, pins["runId"], pins["attempt"])
store = root / "store"
manifest, body, provided = intake.load("transport", intake.HERE / "release-transport.py").unpack_bundle(
    root / "backend/transport.tgz", store, sha, pins["backend"]["manifestSha256"])
fm = intake.load("manifest", intake.HERE / "frontend/manifest.py")
fm.extract_strict(root / "frontend/frontend-rehearsal.tgz", root / "web",
                  validator=lambda name: None if name == ".release/candidate.json" else fm.payload_path(name),
                  max_bytes=100_000_000)
assembler = intake.load("assembler", intake.HERE / "three-layer-release.py")
assembler.assemble(store / "releases" / f"{sha}.json", store, root / "app",
                   Path("/opt/zimage/layer-cache"), pins["backend"]["manifestSha256"], True)
PY
pnpm install --frozen-lockfile
node ops/aliyun/isolated-auth-rehearsal.mjs "$repo" "$result/app" "$result/web"
