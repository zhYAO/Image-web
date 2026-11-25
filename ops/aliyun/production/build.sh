#!/usr/bin/env bash
# Runs only in the checked-out Linux build. Production SSH material is supplied later.
set -euo pipefail
require_clean_checkout() {
  local changes
  changes=$(git status --porcelain --untracked-files=normal)
  if [[ -n "$changes" ]]; then
    printf 'Pair build requires a clean checkout:\n%s\n' "$changes" >&2
    exit 1
  fi
}
out="$RUNNER_TEMP/zimage-pair"
mkdir -m 700 "$out"
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
require_clean_checkout
python3 - "$out" <<'PY'
import json, os, pathlib, runpy, sys
base = pathlib.Path(sys.argv[1])
handoff = runpy.run_path('ops/aliyun/linux-handoff.py')
(base/'target.json').write_text(json.dumps(handoff['TARGET']))
config = base/'public.json'
config.touch(mode=0o600)
config.write_text(json.dumps({k: os.environ[k] for k in handoff['PUBLIC_KEYS']}))
handoff['public_config'](config, handoff['digest'](config.read_bytes()))
PY
node ops/aliyun/package-release.mjs --check-target --target "$out/target.json"
pnpm install --frozen-lockfile
policy=$(node --input-type=module -e 'import {readPinnedPublicImages} from "./apps/web/build/public-image-build.mjs"; process.stdout.write(readPinnedPublicImages().manifestSha256)')
export ZIMAGE_PUBLIC_IMAGE_BASE_URL="https://www.zimage.store/static-assets/$policy"
node ops/aliyun/package-static-assets.mjs --runtime-profile model-only-jsquash --output "$out/resources" > "$out/resources.json"
export ZIMAGE_BUILD_SHA="$GITHUB_SHA" ZIMAGE_BUILD_SLIM=1 ZIMAGE_BUILD_CPUS=1 ZIMAGE_DEPLOYMENT_ENV=production
export NEXT_PUBLIC_DATA_MODE=http NEXT_PUBLIC_PHASE2_AUTH=true
export ZIMAGE_ASSET_NAMESPACE="release-$GITHUB_SHA"
export ZIMAGE_FRONTEND_COMPATIBILITY="$(jq -cn --arg sha "$GITHUB_SHA" '{apiRequirements:{major:1,minMinor:0,capabilities:["runtime.public-config.v1","runtime.meta.v1"]},allowedBackendReleases:[$sha]}')"
pnpm build:frontend
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @zimage/web exec next build --webpack
node apps/web/scripts/verify-built-retired-route.mjs
node apps/web/scripts/measure-dist.mjs --assert-slim --json "$out/size.json"
node ops/aliyun/package-release.mjs apps/web/.next "$out/layers" --assets "$(jq -er .versionDirectory "$out/resources.json")" --release-id "$GITHUB_SHA" --target "$out/target.json" > "$out/backend.json"
require_clean_checkout
python3 - "$out" <<'PY'
import json, os, pathlib, runpy, subprocess, sys, tarfile
root = pathlib.Path(sys.argv[1])
sha = os.environ['GITHUB_SHA']
front = pathlib.Path('apps/frontend/dist')
candidate = json.loads((front/'.release/candidate.json').read_text())
if (candidate['sourceIdentity']['dirty'] is not False or candidate['sourceIdentity']['sourceSHA'] != sha
        or candidate['allowedBackendReleases'] != [sha] or candidate['namespace'] != 'release-'+sha):
    raise ValueError('Frontend build identity mismatch')
policy = runpy.run_path('ops/aliyun/public-image-contract.py')
images = policy['validate'](json.loads((front/'public-image-contract.json').read_text()))
backend = json.loads((root/'layers/store/releases'/f'{sha}.json').read_text())
if backend.get('runtimeProfile') != 'model-only-jsquash' or backend.get('publicImages') != images:
    raise ValueError('Frontend and backend must share the verified public image contract and optimized runtime')
tree = subprocess.check_output(['git','rev-parse','HEAD:supabase/migrations'], text=True).strip()
meta = dict(sha=sha, migrations=tree, run=int(os.environ['GITHUB_RUN_NUMBER']),
            manifest=json.loads((root/'backend.json').read_text())['pack']['manifestSha256'])
(root/'release.json').write_text(json.dumps(meta))
(front/'version.json').write_text(json.dumps(dict(schemaVersion=1, frontendRelease=candidate['namespace'])))
with tarfile.open(root/'pair.tar', 'x') as archive:
    archive.add(root/'release.json', 'release.json')
    archive.add(root/'layers/transport.tgz', 'backend.tgz')
    for file in sorted(front.rglob('*')):
        if file.is_symlink(): raise ValueError('Unexpected static symlink')
        if file.is_file(): archive.add(file, 'frontend/'+file.relative_to(front).as_posix())
PY
