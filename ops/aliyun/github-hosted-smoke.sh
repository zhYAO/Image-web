#!/usr/bin/env bash
# Entry point only from github-rehearsal-review.sh after its verified intake.
set -euo pipefail
umask 077
[[ ( "$#" == 2 || ( "$#" == 3 && "$3" == hosted-shadow ) ) && "$(node --version)" == v24.19.0 && "$(pnpm --version)" == 11.19.0 ]]
mode=${3:-hosted-smoke}
if [[ "$mode" == hosted-shadow ]]; then
  [[ ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == Linux && -z ${GH_TOKEN:-} && -z ${GITHUB_TOKEN:-} ]]
fi
private=${1:?}
repo=${2:?}
[[ "$private" == "$TMPDIR" && "$repo" == "$(pwd -P)" ]]
mkdir -- "$private/runtime"
result="$private/runtime"
python3 -I -B - "$repo" "$private" "$result" "$mode" <<'PY'
import importlib.util
from pathlib import Path
import sys
repo, pre, root = map(Path, sys.argv[1:4])
mode = sys.argv[4]
spec = importlib.util.spec_from_file_location("rehearsal_intake", repo / "ops/aliyun/github-rehearsal-intake.py")
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)
pins = intake.read_json(pre / "pins.json")
sha = pins["commit"]
shadow = intake.hosted_namespace(pins, mode)
if shadow:
    report = intake.evaluate(pins, pre / "backend.zip", pre / "frontend.zip", intake.read_json(pre / "config.json"))
    if report.get("immutablePairVerified") is not True or report.get("productionReady") is not False or report.get("status") != "blocked":
        raise ValueError("Exact shadow bytes have not passed nonpromotable intake")
for component, allowed in (
    ("backend", ["transport.tgz", "rehearsal-receipt.json"]),
    ("frontend", ["frontend-rehearsal.tgz", "frontend-subject.json", "rehearsal-receipt.json"]),
):
    out = root / component
    intake.extract_github_zip(pre / f"{component}.zip", out, pins[component]["artifactSha256"], allowed)
    intake.closure_receipt(out, component, pins[component], sha, pins["runId"], pins["attempt"], shadow=shadow)
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
if [[ "$mode" == hosted-shadow ]]; then
  python3 -I -B ops/aliyun/prepare-m6-browser-fixture.py "$repo/supabase/migrations" "$private/m6"
  export PLAYWRIGHT_BROWSERS_PATH="$private/chromium"
  driver=$(node --input-type=module -e 'import {playwrightPath} from "./ops/aliyun/isolated-auth-browser.mjs"; console.log(playwrightPath(process.cwd()))')
  node "$(dirname "$driver")/cli.js" install --with-deps chromium
  node ops/aliyun/isolated-auth-shadow.mjs "$repo" "$result/app" "$result/web" --protected-main-shadow "$private/m6"
else
  node ops/aliyun/isolated-auth-rehearsal.mjs "$repo" "$result/app" "$result/web"
fi
