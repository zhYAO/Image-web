#!/usr/bin/env bash
# Nonpromotable exact branch diagnostic. Never run the main release workflows.
set -euo pipefail
umask 077
[[ "$GITHUB_REPOSITORY" == zhYAO/Image-web && "$GITHUB_EVENT_NAME" == push &&
   "$GITHUB_REF" == refs/heads/codex/zimage-exact-shadow-diagnostic-20261122 &&
   "$GITHUB_WORKFLOW_REF" == "$GITHUB_REPOSITORY/.github/workflows/exact-shadow-diagnostic.yml@$GITHUB_REF" &&
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
export ZIMAGE_ASSET_NAMESPACE="release-${release_sha:0:12}"
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
build_pair "$root" "$GITHUB_SHA" "$candidate" full
freeze="$private/frozen"
mkdir -m 700 "$freeze" "$freeze/home" "$private/backend" "$private/frontend"
cp "$candidate/packed/transport.tgz" "$private/backend/transport.tgz"
cp "$candidate/subject.json" "$private/frontend/frontend-subject.json"
# Local wire-format fixtures contain no production acceptance. Do not change
# GITHUB_REF, workflow, event, or ref protection to impersonate protected main.
ZIMAGE_PROTECTED_MAIN_BROWSER_SHADOW=true python3 -I -B ops/aliyun/github-rehearsal-receipt.py \
  backend "$private/backend" "$candidate/verified.json"
ZIMAGE_PROTECTED_MAIN_BROWSER_SHADOW=true MATCH_BACKEND_SHA="$GITHUB_SHA" \
  python3 -I -B ops/aliyun/github-rehearsal-receipt.py frontend "$private/frontend" "$root/apps/frontend/dist"
cp "$public_config" "$freeze/config.json"
tree=$(git ls-tree -r --full-tree HEAD | sha256sum)
lock=$(sha256sum pnpm-lock.yaml)
python3 -I -B - "$private" "$freeze" "${tree%% *}" "${lock%% *}" <<'PY'
import hashlib, json, os, sys, zipfile
from pathlib import Path
work, out = map(Path, sys.argv[1:3])
e = os.environ
commit = e['GITHUB_SHA']
pins = dict(lane='browser-shadow', commit=commit, runId=int(e['GITHUB_RUN_ID']),
            attempt=int(e['GITHUB_RUN_ATTEMPT']), frontendNamespace='release-' + commit[:12],
            treeFingerprint=sys.argv[3], lockfileSha256=sys.argv[4])
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as src:
        for block in iter(lambda: src.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()
for name, archive, extra, files in (
        ('backend', 'transport.tgz', 'manifestSha256', ('transport.tgz',)),
        ('frontend', 'frontend-rehearsal.tgz', 'subjectSha256', ('frontend-rehearsal.tgz', 'frontend-subject.json'))):
    source = work / name
    zip_path = out / (name + '.zip')
    members = (*files, 'rehearsal-receipt.json')
    with zipfile.ZipFile(zip_path, 'x') as z:
        for member in sorted(members):
            info = zipfile.ZipInfo(member)
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            with (source / member).open('rb') as src, z.open(info, 'w') as dst:
                while True:
                    block = src.read(1024 * 1024)
                    if not block: break
                    dst.write(block)
    evidence = (json.loads((work/'candidate/backend.json').read_bytes())['pack']['manifestSha256']
                if name == 'backend' else digest(source/'frontend-subject.json'))
    pins[name] = dict(artifactSha256=digest(zip_path), archiveSha256=digest(source/archive),
                      receiptSha256=digest(source/'rehearsal-receipt.json'), **{extra: evidence})
(out/'pins.json').write_text(json.dumps(pins, sort_keys=True) + '\n')
for name in ('config.json','pins.json','backend.zip','frontend.zip'):
    (out/name).chmod(0o400)
print('Frozen local diagnostic ZIP identities for ' + commit)
PY
env -i PATH="$PATH" HOME="$freeze/home" TMPDIR="$freeze" COREPACK_HOME="$COREPACK_HOME" \
  RUNNER_ENVIRONMENT=github-hosted RUNNER_OS=Linux LANG=C.UTF-8 NEXT_TELEMETRY_DISABLED=1 \
  bash ops/aliyun/github-hosted-smoke.sh "$freeze" "$root" hosted-shadow
if [[ ${ZIMAGE_ECS_BYTE_PROOF:-0} == 1 ]]; then
  handoff="$RUNNER_TEMP/zimage-ecs-byte-proof"
  mkdir -m 700 "$handoff"
  python3 -I -B - "$freeze" "$handoff" >> "$ZIMAGE_ECS_OUTPUT" <<'PY'
import hashlib, json, os, shutil, stat, sys
from pathlib import Path
src, dst = map(Path, sys.argv[1:])
names = ('backend.zip', 'frontend.zip', 'pins.json', 'config.json')
sizes = {}
hashes = {}
for name in names:
    member = src / name
    info = member.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size <= 0:
        raise ValueError('Unexpected proof member')
    sizes[name] = info.st_size
if sum(sizes.values()) > 39_990_000:
    raise ValueError('Diagnostic evidence exceeds size cap')
for name in names:
    with (src / name).open('rb') as f:
        hashes[name] = hashlib.sha256(f.read()).hexdigest()
    shutil.copyfile(src / name, dst / name)
pins = json.loads((dst / 'pins.json').read_bytes())
e = os.environ
if (pins['commit'], pins['runId'], pins['attempt'], pins['lane']) != (e['GITHUB_SHA'], int(e['GITHUB_RUN_ID']), int(e['GITHUB_RUN_ATTEMPT']), 'browser-shadow'):
    raise ValueError('Wrong exact byte proof identity')
if any(pins[key]['artifactSha256'] != hashes[key + '.zip'] for key in ('backend', 'frontend')):
    raise ValueError('Proof digest changed')
statement = dict(schemaVersion=1, kind='nonpromotable-ecs-byte-proof', productionReady=False, repository=e['GITHUB_REPOSITORY'],
                 workflow=e['GITHUB_WORKFLOW_REF'], commit=e['GITHUB_SHA'], runId=pins['runId'], attempt=pins['attempt'],
                 browserShadowPassed=True, files={n: dict(bytes=sizes[n], sha256=hashes[n]) for n in names})
body = (json.dumps(statement, sort_keys=True, separators=(',', ':')) + '\n').encode()
if len(body) + sum(sizes.values()) > 40_000_000:
    raise ValueError('Diagnostic evidence exceeds size cap')
(dst / 'statement.json').write_bytes(body)
for key, value in (('backend', hashes['backend.zip']), ('frontend', hashes['frontend.zip']),
                   ('statement', hashlib.sha256(body).hexdigest()), ('attempt', str(pins['attempt']))):
    print(key + '=' + value)
PY
fi
