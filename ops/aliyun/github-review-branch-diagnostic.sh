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
target_json="$private/target.json"
public_config="$private/config.json"
printf '%s\n' '{"schema":1,"runtime":{"node":"24.19.0","abi":"137","platform":"linux","arch":"x64","libc":"glibc-2.35"},"toolchain":{"packageManager":"pnpm@11.19.0"},"assemblyCacheRoot":"/opt/zimage/layer-cache"}' > "$target_json"
printf '%s\n' '{"schemaVersion":1,"formalAuth":true,"dataMode":"http","captchaSiteKey":null,"approvedLegalVersion":null,"registrationEnabled":false}' > "$public_config"
baseline=532d953cdd8fb4cc2446b83de77f435e13041315
test "$baseline" != "$GITHUB_SHA"
test "$(git rev-parse --verify "$baseline^{commit}")" = "$baseline"
git merge-base --is-ancestor "$baseline" "$GITHUB_SHA"
base_checkout="$private/baseline-source"
pool="$private/pnpm-store"
cleanup() {
  if [[ -d "$base_checkout" ]]; then git -C "$root" worktree remove --force "$base_checkout"; fi
  rm -rf -- "$private"
}
trap cleanup EXIT
build_pair() (
source=$1
release_sha=$2
private=$3
cd "$source"
test "$(git rev-parse HEAD)" = "$release_sha"
test -z "$(git status --porcelain)"
mkdir -m 700 "$private"
node ops/aliyun/package-release.mjs --check-target --target "$target_json"
policy=$(node --input-type=module -e 'import{readPinnedPublicImages}from"./apps/web/build/public-image-build.mjs"; process.stdout.write(readPinnedPublicImages().manifestSha256)')
[[ "$policy" =~ ^[a-f0-9]{64}$ ]]
export ZIMAGE_PUBLIC_IMAGE_BASE_URL="https://www.zimage.store/static-assets/$policy"
export npm_config_store_dir="$pool"
pnpm install --frozen-lockfile --store-dir "$pool"
NEXT_PUBLIC_DATA_MODE=http NEXT_PUBLIC_PHASE2_AUTH=true ZIMAGE_DEPLOYMENT_ENV=production \
  NODE_OPTIONS=--max-old-space-size=4096 ZIMAGE_BUILD_SHA="$release_sha" ZIMAGE_BUILD_SLIM=1 ZIMAGE_BUILD_CPUS=1 \
  pnpm --filter @zimage/web exec next build --webpack
node ops/aliyun/package-static-assets.mjs --runtime-profile model-only-jsquash --output "$private/resources" > "$private/assets.json"
assets=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["versionDirectory"])' "$private/assets.json")
node ops/aliyun/package-release.mjs apps/web/.next "$private/packed" --assets "$assets" --release-id "$release_sha" --target "$target_json" > "$private/backend.json"
backend_sha=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pack"]["manifestSha256"])' "$private/backend.json")
python3 -I -B ops/aliyun/release-transport.py unpack "$private/packed/transport.tgz" "$private/store" \
  --release-sha "$release_sha" --manifest-sha256 "$backend_sha" > "$private/verified.json"
python3 -I -B ops/aliyun/release-transport.py request "$private/store" "$private/store/releases/$release_sha.json" \
  --manifest-sha256 "$backend_sha" > "$private/required.json"
python3 -I -B - "$private/verified.json" "$release_sha" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    result = json.load(f)
m = result["manifest"]
if not (m["releaseId"] == sys.argv[2] and m["schema"] == 3 and m["runtimeProfile"] == "model-only-jsquash"
        and m["productionReady"] is False and len(result["provided"]) == 7):
    raise ValueError("Expected exact full diagnostic backend")
PY
python3 -I -B ops/aliyun/three-layer-release.py assemble "$private/store/releases/$release_sha.json" "$private/store" "$private/app" \
  --cache /opt/zimage/layer-cache --manifest-sha256 "$backend_sha" --allow-sample > "$private/assembly.json"

export ZIMAGE_ASSET_NAMESPACE="rehearsal-$release_sha-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
export ZIMAGE_FRONTEND_COMPATIBILITY
ZIMAGE_FRONTEND_COMPATIBILITY=$(python3 -c 'import json,sys;print(json.dumps(dict(apiRequirements=dict(major=1,minMinor=0,capabilities=["runtime.public-config.v1","runtime.meta.v1"]),allowedBackendReleases=[sys.argv[1]])))' "$release_sha")
pnpm build:frontend
python3 -I -B ops/aliyun/frontend/pack.py --dist apps/frontend/dist --public-config "$public_config" --subject-only > "$private/subject.json"
python3 -I -B - "$private/subject.json" "$ZIMAGE_ASSET_NAMESPACE" "$release_sha" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    subject = json.load(f)
if not (subject["namespace"] == sys.argv[2] and subject["allowedBackendReleases"] == [sys.argv[3]]
        and subject["sourceIdentity"]["sourceSHA"] == sys.argv[3] and subject["sourceIdentity"]["dirty"] is False
        and subject["acceptanceRequired"] is True):
    raise ValueError("Frontend is not an exact, nonpromotable acceptance subject")
PY
)

candidate="$private/candidate"
retained="$private/baseline"
build_pair "$root" "$GITHUB_SHA" "$candidate"
# Report candidate byte counts before the separate baseline build and runtime.
node apps/web/scripts/measure-dist.mjs --runtime-audit --json "$candidate/dist-bytes.json" > "$candidate/dist-bytes.log"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -czf "$candidate/frontend-diagnostic.tgz" -C "$root/apps/frontend/dist" .
python3 -I -B ops/aliyun/review-release-sizes.py "$GITHUB_SHA" "$candidate" "$root/apps/frontend/dist"

git worktree add --detach "$base_checkout" "$baseline"
build_pair "$base_checkout" "$baseline" "$retained"
candidate_digest=$(sha256sum < "$candidate/packed/transport.tgz" | cut -d ' ' -f1)
baseline_digest=$(sha256sum < "$retained/packed/transport.tgz" | cut -d ' ' -f1)
test "$candidate_digest" != "$baseline_digest"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -czf "$retained/frontend-diagnostic.tgz" -C "$base_checkout/apps/frontend/dist" .
candidate_front=$(sha256sum < "$candidate/frontend-diagnostic.tgz" | cut -d ' ' -f1)
baseline_front=$(sha256sum < "$retained/frontend-diagnostic.tgz" | cut -d ' ' -f1)
test "$candidate_front" != "$baseline_front"
same_app=no
if git diff --quiet "$baseline" "$GITHUB_SHA" -- apps packages pnpm-lock.yaml; then same_app=yes; fi
printf 'ZIMAGE_DISTINCT_PAIR baseline=%s candidate=%s baselineTransport=%s candidateTransport=%s baselineFrontend=%s candidateFrontend=%s sameApplicationSource=%s\n' \
  "$baseline" "$GITHUB_SHA" "$baseline_digest" "$candidate_digest" "$baseline_front" "$candidate_front" "$same_app"
node ops/aliyun/isolated-release-rehearsal.mjs "$retained/app" "$base_checkout/apps/frontend/dist" \
  "$candidate/app" "$root/apps/frontend/dist"
node ops/aliyun/isolated-auth-rehearsal.mjs "$root" "$candidate/app" "$root/apps/frontend/dist"

# No trust from the runner reaches this closed namespace. Copy the pinned tool
# as root only on an ephemeral hosted VM, never install a machine service.
outer_net=$(readlink /proc/self/ns/net)
outer_mount=$(readlink /proc/self/ns/mnt)
trusted_node="$private/rehearsal-node"
sudo -n /usr/bin/install -o 0 -g 0 -m 0555 "$(realpath "$(command -v node)")" "$trusted_node"
sudo -n /usr/bin/unshare --net --mount --pid --fork --mount-proc --kill-child \
  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C.UTF-8 /usr/bin/python3 -I -B \
  "$root/ops/aliyun/review-schema3-admission.py" "$candidate" "$trusted_node" "$outer_net" "$outer_mount" \
  "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$candidate_digest"
