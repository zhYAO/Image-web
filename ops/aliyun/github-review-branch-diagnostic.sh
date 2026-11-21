#!/usr/bin/env bash
# Nonpromotable exact branch diagnostic. Never run the main release workflows.
set -euo pipefail
umask 077
[[ "$GITHUB_REPOSITORY" == zhYAO/Image-web && "$GITHUB_EVENT_NAME" == push &&
   "$GITHUB_REF" == refs/heads/codex/zimage-github-actions-review-20261120 &&
   "$GITHUB_WORKFLOW_REF" == "$GITHUB_REPOSITORY/.github/workflows/review-branch-diagnostic.yml@$GITHUB_REF" &&
   "$RUNNER_ENVIRONMENT" == github-hosted && "$RUNNER_OS" == Linux &&
   "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$GITHUB_RUN_ID" =~ ^[1-9][0-9]{0,19}$ &&
   "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]{0,7}$ ]] || exit 1
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" && -z "$(git status --porcelain)" ]]
[[ "$(node --version)" == v24.19.0 && "$(pnpm --version)" == 11.19.0 ]]
root=$(pwd -P)
private=$(mktemp -d "$TMPDIR/pair.XXXXXXXX")
trap 'rm -rf -- "$private"' EXIT
printf '%s\n' '{"schema":1,"runtime":{"node":"24.19.0","abi":"137","platform":"linux","arch":"x64","libc":"glibc-2.35"},"toolchain":{"packageManager":"pnpm@11.19.0"},"assemblyCacheRoot":"/opt/zimage/layer-cache"}' > "$private/target.json"
printf '%s\n' '{"schemaVersion":1,"formalAuth":true,"dataMode":"http","captchaSiteKey":null,"approvedLegalVersion":null,"registrationEnabled":false}' > "$private/config.json"
node ops/aliyun/package-release.mjs --check-target --target "$private/target.json"
policy=$(node --input-type=module -e 'import{readPinnedPublicImages}from"./apps/web/build/public-image-build.mjs"; process.stdout.write(readPinnedPublicImages().manifestSha256)')
[[ "$policy" =~ ^[a-f0-9]{64}$ ]]
export ZIMAGE_PUBLIC_IMAGE_BASE_URL="https://www.zimage.store/static-assets/$policy"
pnpm install --frozen-lockfile
NEXT_PUBLIC_DATA_MODE=http NEXT_PUBLIC_PHASE2_AUTH=true ZIMAGE_DEPLOYMENT_ENV=production \
  NODE_OPTIONS=--max-old-space-size=4096 ZIMAGE_BUILD_SHA="$GITHUB_SHA" ZIMAGE_BUILD_SLIM=1 ZIMAGE_BUILD_CPUS=1 \
  pnpm --filter @zimage/web exec next build --webpack
node ops/aliyun/package-static-assets.mjs --runtime-profile model-only-jsquash --output "$private/resources" > "$private/assets.json"
assets=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["versionDirectory"])' "$private/assets.json")
node ops/aliyun/package-release.mjs apps/web/.next "$private/packed" --assets "$assets" --release-id "$GITHUB_SHA" --target "$private/target.json" > "$private/backend.json"
backend_sha=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pack"]["manifestSha256"])' "$private/backend.json")
python3 -I -B ops/aliyun/release-transport.py unpack "$private/packed/transport.tgz" "$private/store" \
  --release-sha "$GITHUB_SHA" --manifest-sha256 "$backend_sha" > "$private/verified.json"
python3 -I -B ops/aliyun/release-transport.py request "$private/store" "$private/store/releases/$GITHUB_SHA.json" \
  --manifest-sha256 "$backend_sha" > "$private/required.json"
python3 -I -B - "$private/verified.json" "$GITHUB_SHA" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    result = json.load(f)
m = result["manifest"]
if not (m["releaseId"] == sys.argv[2] and m["schema"] == 3 and m["runtimeProfile"] == "model-only-jsquash"
        and m["productionReady"] is False and len(result["provided"]) == 7):
    raise ValueError("Expected exact full diagnostic backend")
PY
python3 -I -B ops/aliyun/three-layer-release.py assemble "$private/store/releases/$GITHUB_SHA.json" "$private/store" "$private/app" \
  --cache /opt/zimage/layer-cache --manifest-sha256 "$backend_sha" --allow-sample > "$private/assembly.json"

export ZIMAGE_ASSET_NAMESPACE="rehearsal-$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
export ZIMAGE_FRONTEND_COMPATIBILITY
ZIMAGE_FRONTEND_COMPATIBILITY=$(python3 -c 'import json,sys;print(json.dumps(dict(apiRequirements=dict(major=1,minMinor=0,capabilities=["runtime.public-config.v1","runtime.meta.v1"]),allowedBackendReleases=[sys.argv[1]])))' "$GITHUB_SHA")
pnpm build:frontend
python3 -I -B ops/aliyun/frontend/pack.py --dist apps/frontend/dist --public-config "$private/config.json" --subject-only > "$private/subject.json"
python3 -I -B - "$private/subject.json" "$ZIMAGE_ASSET_NAMESPACE" "$GITHUB_SHA" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    subject = json.load(f)
if not (subject["namespace"] == sys.argv[2] and subject["allowedBackendReleases"] == [sys.argv[3]]
        and subject["sourceIdentity"]["sourceSHA"] == sys.argv[3] and subject["sourceIdentity"]["dirty"] is False
        and subject["acceptanceRequired"] is True):
    raise ValueError("Frontend is not an exact, nonpromotable acceptance subject")
PY
node ops/aliyun/isolated-release-rehearsal.mjs "$private/app" "$root/apps/frontend/dist"
node ops/aliyun/isolated-auth-rehearsal.mjs "$root" "$private/app" "$root/apps/frontend/dist"
