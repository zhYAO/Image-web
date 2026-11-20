#!/usr/bin/env bash
# This producer MUST NOT create a candidate.json, production receipt or approval.
set -euo pipefail
umask 077
component=${1:-}
[[ ( ${GITHUB_EVENT_NAME:-} == push || ${GITHUB_EVENT_NAME:-} == workflow_dispatch ) && ${GITHUB_REPOSITORY:-} == zhYAO/Image-web &&
   ${GITHUB_REF:-} == refs/heads/main && ${GITHUB_REF_PROTECTED:-} == true &&
   ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == Linux &&
   ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ && ${GITHUB_RUN_ID:-} =~ ^[1-9][0-9]{0,19}$ &&
   ${GITHUB_RUN_ATTEMPT:-} =~ ^[1-9][0-9]{0,7}$ ]]
[[ "$component" == backend || "$component" == frontend ]]
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" && -z "$(git status --porcelain)" ]]
[[ "$(node --version)" == v24.19.0 ]]
private=$(mktemp -d "$RUNNER_TEMP/zimage-private.XXXXXXXX")
trap 'rm -rf -- "$private"' EXIT
mkdir -- "$private/bin"
export PATH="$private/bin:$PATH"
delivery="$RUNNER_TEMP/zimage-rehearsal"
mkdir -- "$delivery"
if [[ "$component" == backend ]]; then
  [[ -n ${TARGET_JSON:-} && ${#TARGET_JSON} -le 16384 ]] || { echo "Missing or oversized ZIMAGE_RELEASE_TARGET_JSON in release-rehearsal." >&2; exit 1; }
  printf '%s\n' "$TARGET_JSON" > "$private/target.json"
  unset TARGET_JSON
  node ops/aliyun/package-release.mjs --check-target --target "$private/target.json"
else
  if [[ "$GITHUB_EVENT_NAME" == push ]]; then
    export MATCH_BACKEND_SHA="$GITHUB_SHA"
  fi
  [[ ${MATCH_BACKEND_SHA:-} =~ ^[a-f0-9]{40}$ ]] || { echo "Frontend diagnostic requires an exact backend commit SHA." >&2; exit 1; }
  [[ -n ${REHEARSAL_PUBLIC_CONFIG:-} && ${#REHEARSAL_PUBLIC_CONFIG} -le 16384 ]] || { echo "Missing or oversized ZIMAGE_REHEARSAL_PUBLIC_CONFIG_JSON from staging." >&2; exit 1; }
  printf '%s\n' "$REHEARSAL_PUBLIC_CONFIG" > "$private/config.json"
  unset REHEARSAL_PUBLIC_CONFIG
fi
node --input-type=module -e 'import{readPinnedPublicImages}from"./apps/web/build/public-image-build.mjs"; process.stdout.write(readPinnedPublicImages().manifestSha256)' > "$private/policy-sha"
policy=$(cat "$private/policy-sha")
[[ "$policy" =~ ^[a-f0-9]{64}$ ]]
[[ "$(corepack pnpm@11.19.0 --version)" == 11.19.0 ]]
corepack enable --install-directory "$private/bin" pnpm
export ZIMAGE_PUBLIC_IMAGE_BASE_URL="https://www.zimage.store/static-assets/$policy"
unset NEXT_PUBLIC_STATIC_ASSET_BASE_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY
pnpm install --frozen-lockfile
if [[ "$component" == backend ]]; then
  NEXT_PUBLIC_DATA_MODE=http NEXT_PUBLIC_PHASE2_AUTH=true ZIMAGE_DEPLOYMENT_ENV=production \
    NODE_OPTIONS=--max-old-space-size=4096 ZIMAGE_BUILD_SHA="$GITHUB_SHA" ZIMAGE_BUILD_SLIM=1 ZIMAGE_BUILD_CPUS=1 \
    pnpm --filter @zimage/web exec next build --webpack
  node ops/aliyun/package-static-assets.mjs --runtime-profile model-only-jsquash --output "$private/resources" > "$private/assets.json"
  asset=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["versionDirectory"])' "$private/assets.json")
  node ops/aliyun/package-release.mjs apps/web/.next "$private/backend" --assets "$asset" --release-id "$GITHUB_SHA" --target "$private/target.json" > "$private/build.json"
  manifest=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pack"]["manifestSha256"])' "$private/build.json")
  python3 -I -B ops/aliyun/release-transport.py unpack "$private/backend/transport.tgz" "$private/unpacked" --release-sha "$GITHUB_SHA" --manifest-sha256 "$manifest" > "$private/verify.json"
  python3 -I -B ops/aliyun/release-transport.py request "$private/unpacked" "$private/unpacked/releases/$GITHUB_SHA.json" --manifest-sha256 "$manifest" > "$private/required.json"
  cp -- "$private/backend/transport.tgz" "$delivery/transport.tgz"
  python3 -I -B ops/aliyun/github-rehearsal-receipt.py backend "$delivery" "$private/verify.json"
else
  export ZIMAGE_ASSET_NAMESPACE="rehearsal-$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  export ZIMAGE_FRONTEND_COMPATIBILITY
  ZIMAGE_FRONTEND_COMPATIBILITY=$(python3 -c 'import json,sys;print(json.dumps(dict(apiRequirements=dict(major=1,minMinor=0,capabilities=["runtime.public-config.v1","runtime.meta.v1"]),allowedBackendReleases=[sys.argv[1]])))' "$MATCH_BACKEND_SHA")
  pnpm build:frontend
  python3 -I -B ops/aliyun/frontend/pack.py --dist apps/frontend/dist --public-config "$private/config.json" --subject-only > "$delivery/frontend-subject.json"
  python3 -I -B ops/aliyun/github-rehearsal-receipt.py frontend "$delivery" apps/frontend/dist
fi

if [[ -n ${GITHUB_OUTPUT:-} ]]; then
  payload=transport.tgz
  if [[ "$component" == frontend ]]; then
    payload=frontend-rehearsal.tgz
    evidence_sha=$(sha256sum "$delivery/frontend-subject.json")
  else
    evidence_sha=$manifest
  fi
  archive_sha=$(sha256sum "$delivery/$payload")
  receipt_sha=$(sha256sum "$delivery/rehearsal-receipt.json")
  printf 'archive_sha=%s\nreceipt_sha=%s\nevidence_sha=%s\n' "${archive_sha%% *}" "${receipt_sha%% *}" "${evidence_sha%% *}" >> "$GITHUB_OUTPUT"
fi
