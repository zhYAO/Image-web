#!/usr/bin/env bash
# Runs only in the checked-out Linux build. Production SSH material is supplied later.
set -euo pipefail
out="$RUNNER_TEMP/zimage-pair"
mkdir -m 700 "$out"
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
test -z "$(git status --porcelain)"
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
font_source=$(node ops/aliyun/prepare-candidate-fonts.mjs | jq -er .)
node ops/aliyun/package-static-assets.mjs --font-source "$font_source" --output "$out/resources" > "$out/resources.json"
export ZIMAGE_SHARED_FONT_DIR="$(jq -er .versionDirectory "$out/resources.json")/fonts"
export ZIMAGE_STATIC_ASSET_SHA256="$(jq -er .manifestSha256 "$out/resources.json")"
export ZIMAGE_BUILD_SHA="$GITHUB_SHA" ZIMAGE_BUILD_SLIM=1 ZIMAGE_DEPLOYMENT_ENV=production
export NEXT_PUBLIC_DATA_MODE=http NEXT_PUBLIC_PHASE2_AUTH=true NEXT_PUBLIC_STATIC_ASSET_BASE_URL=''
export ZIMAGE_SENTRY_DSN="$NEXT_PUBLIC_SENTRY_DSN" ZIMAGE_SENTRY_TRACES_SAMPLE_RATE="$NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE"
export ZIMAGE_ASSET_NAMESPACE="release-$GITHUB_SHA"
export ZIMAGE_FRONTEND_COMPATIBILITY="$(jq -cn --arg sha "$GITHUB_SHA" '{apiRequirements:{major:1,minMinor:0,capabilities:["runtime.public-config.v1","runtime.meta.v1"]},allowedBackendReleases:[$sha]}')"
pnpm build:frontend
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @zimage/web exec next build --webpack
node apps/web/scripts/verify-built-retired-route.mjs
node apps/web/scripts/measure-dist.mjs --assert-slim --json "$out/size.json"
node ops/aliyun/package-release.mjs apps/web/.next "$out/layers" --assets "$(jq -er .versionDirectory "$out/resources.json")" --release-id "$GITHUB_SHA" --target "$out/target.json" > "$out/backend.json"
test -z "$(git status --porcelain)"
python3 - "$out" <<'PY'
import json, os, pathlib, subprocess, sys, tarfile
root = pathlib.Path(sys.argv[1])
sha = os.environ['GITHUB_SHA']
front = pathlib.Path('apps/frontend/dist')
candidate = json.loads((front/'.release/candidate.json').read_text())
if (candidate['sourceIdentity']['dirty'] is not False or candidate['sourceIdentity']['sourceSHA'] != sha
        or candidate['allowedBackendReleases'] != [sha] or candidate['namespace'] != 'release-'+sha):
    raise ValueError('Frontend build identity mismatch')
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
