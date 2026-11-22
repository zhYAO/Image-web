#!/usr/bin/env bash
# Nonpromotable exact branch diagnostic. Never run the main release workflows.
set -euo pipefail
umask 077
[[ "$GITHUB_REPOSITORY" == zhYAO/Image-web && "$GITHUB_EVENT_NAME" == push &&
   "$GITHUB_REF" == refs/heads/codex/zimage-m6-runtime-proof-20261122 &&
   "$GITHUB_WORKFLOW_REF" == "$GITHUB_REPOSITORY/.github/workflows/m6-runtime-proof.yml@$GITHUB_REF" &&
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
pool="$private/pnpm-store"
build_pair() (
source=$1
release_sha=$2
private=$3
scope=$4
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

if [[ "$scope" == backend-only ]]; then exit 0; fi
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
fixture="$private/m6"
FIXTURE="$fixture" python3 -I -B - <<'PY_FIXTURE'
import hashlib, os, re, shutil
from pathlib import Path
fixture = Path(os.environ['FIXTURE'])
assert not fixture.exists()
fixture.mkdir()
(fixture / 'supabase/migrations').mkdir(parents=True)
# Snapshot of the 43 verified migration names, not production data.
names = ["active_business_session_asset_reads","apparel_catalog","chat_usage_settlement","commerce_package_orders","commerce_reference_history","commerce_single_task_limits","commerce_tasks","commerce_xhs_poster","creative_batch_history_access","creative_batch_legacy_insert_schedule","creative_batch_progress_owner_access","creative_batch_review_progress","creative_batch_worker","credits","credits_safe_updates","doubao_edge_relay","durable_generation_rejections","ecommerce_workflows","isolated_provider_diagnostics","openai_chat_edge_relay","openai_models_disabled","phase1_advisor_hardening","phase1_chat","phase1_cleanup","phase1_cleanup_schedule","phase1_enabled_overrides_health","phase1_foundation","phase1_generation_emergency_stop","phase1_generation_queue","phase1_generation_schedule","phase1_modern_secret_key_scheduling","phase1_preview_guards","phase1_public_write_hardening","phase1_safety_audit","phase2_auth_accounts","phase2_auth_runtime_fixes","phase2_generation_reliability","retire_creative_batch_cron","retire_minimax_preserve_history","seedream_5_models","seedream_plan_only_image_admission","session_activity_summary","unknown_generation_health_once"]
expected = set(names)
skipped = 'verified_openai_chat_metering'
seen = set()
for src in sorted(Path('supabase/migrations').glob('*.sql')):
    match = re.fullmatch(r'([0-9]{14})_([a-z0-9_]+)\.sql', src.name)
    assert match, src.name
    stamp, name = match.groups()
    if name == skipped:
        continue
    assert name in expected and name not in seen, src.name
    seen.add(name)
    body = src.read_bytes()
    if name == 'isolated_provider_diagnostics':
        assert hashlib.sha256(body).hexdigest() == '7fc3d2c1144692d25d52e0f50e57b3ad05bf4b8131c0bc8545b2efee9c830923'
        stamp = '20261106123202'
    if name == 'chat_usage_settlement':
        stamp = '20261106083858'
    (fixture / 'supabase/migrations' / f'{stamp}_{name}.sql').write_bytes(body)
assert seen == expected
(fixture / 'expected-migration-names.txt').write_text('\n'.join(names) + '\n')

selected = sorted((fixture / 'supabase/migrations').glob('*.sql'))
(fixture / 'expected-migration-ledger.txt').write_text(''.join(
    f'{src.stem.replace("_", "|", 1)}\n' for src in selected
))
PY_FIXTURE
build_pair "$root" "$GITHUB_SHA" "$candidate" full
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -czf "$candidate/frontend-diagnostic.tgz" -C "$root/apps/frontend/dist" .
printf 'Candidate %s in run %s attempt %s; non-promotable backend and frontend digests:\n' "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
sha256sum "$candidate/packed/transport.tgz" "$candidate/frontend-diagnostic.tgz"
export PLAYWRIGHT_BROWSERS_PATH="$private/chromium"
driver=$(node --input-type=module -e 'import {playwrightPath} from "./ops/aliyun/isolated-auth-browser.mjs"; console.log(playwrightPath(process.cwd()))')
node "$(dirname "$driver")/cli.js" install --with-deps chromium
if [[ ${ZIMAGE_REVIEW_RECONSTRUCTED_PAIR:-0} == 1 ]]; then
  baseline=7a811b326aa4b344cee08bc5a33c04e44a780fd4
  baseline_checkout="$private/baseline-source"
  git clone --quiet --no-checkout --filter=blob:none https://github.com/zhYAO/Image-web.git "$baseline_checkout"
  git -C "$baseline_checkout" fetch --quiet --depth 1 origin "$baseline"
  git -C "$baseline_checkout" checkout --quiet --detach "$baseline"
  bash ops/aliyun/reconstruct-7a-browser-fixture.sh "$baseline_checkout" "$private/reconstructed" "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  export ZIMAGE_RECONSTRUCTED_PAIR="$private/reconstructed"
fi
if [[ -z ${ZIMAGE_SHADOW_OUTPUT:-} ]]; then
  node ops/aliyun/isolated-auth-rehearsal.mjs "$root" "$candidate/app" "$root/apps/frontend/dist" --m6-diagnostics-no-m7 "$fixture"
else
  [[ ${ZIMAGE_REVIEW_RECONSTRUCTED_PAIR:-0} == 1 && -f "$ZIMAGE_SHADOW_OUTPUT" ]]
  node ops/aliyun/isolated-auth-rehearsal.mjs "$root" "$candidate/app" "$root/apps/frontend/dist" --m6-diagnostics-no-m7 "$fixture" > "$private/browser-result.json"
  cat "$private/browser-result.json"
  python3 -I -B - "$private" "$GITHUB_SHA" >> "$ZIMAGE_SHADOW_OUTPUT" <<'PY_PROOF'
import hashlib, json, pathlib, re, sys
private = pathlib.Path(sys.argv[1])
result = json.loads((private / 'browser-result.json').read_bytes())
expected = ['frontend-shell', 'candidate-health', 'anonymous-session-denied', 'wrong-password-denied',
            'password-login', 'live-session-rpc', 'logout', 'browser-home-login-workspace-logout']
if not (result['commit'] == sys.argv[2] and result['scope'] == 'loopback-nginx-browser-and-http'
        and result['browserUiTested'] is True and result['productionReady'] is False
        and result['credentialMode'] == 'synthetic' and result['dbProfile'] == 'm6-diagnostics-no-m7'
        and result['migrationCount'] == 43 and result['checks'] == expected
        and result['reconstructedBrowserRecovery'] is True
        and result['reconstructedCommit'] == '7a811b326aa4b344cee08bc5a33c04e44a780fd4'
        and re.fullmatch(r'[a-f0-9]{64}', result['migrationLedgerSha256'])):
    raise ValueError('Missing verified shadow diagnostic results')
for name, filename in (('backend','candidate/packed/transport.tgz'),
                       ('frontend','candidate/frontend-diagnostic.tgz')):
    with (private / filename).open('rb') as f:
        print(name + '=' + hashlib.sha256(f.read()).hexdigest())
print('ledger=' + result['migrationLedgerSha256'])
import os
for name in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
    print('proof_' + name.lower() + '=' + os.environ[name])
PY_PROOF
fi
