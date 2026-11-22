#!/usr/bin/env bash
# Source reconstruction only; never upload, promote, or write outside disposable checkout/output.
set -euo pipefail
umask 077
sha=7a811b326aa4b344cee08bc5a33c04e44a780fd4
[[ $# == 3 ]] || { echo "usage: $0 DETACHED_CHECKOUT NEW_SCRATCH_OUTPUT RUN_ID-RUN_ATTEMPT" >&2; exit 2; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 && "$(getconf GNU_LIBC_VERSION)" == 'glibc 2.35' ]]
[[ $(node -p 'process.versions.node + "/" + process.versions.modules') == 24.19.0/137 ]]
[[ $(pnpm --version) == 11.19.0 && "$3" =~ ^[1-9][0-9]*-[1-9][0-9]*$ ]]
src=$(realpath -e -- "$1")
out=$(realpath -m -- "$2")
scratch=$(realpath -e -- "${TMPDIR:-/tmp}")
[[ "$src" == "$scratch/"* && "$out" == "$scratch/"* && "$out" != "$src/"* && "$src" != "$out/"* ]]
[[ ! -e "$out" && ! -L "$out" ]]
cd -- "$src"
[[ $(git rev-parse HEAD) == "$sha" && -z $(git status --porcelain) ]]
if git symbolic-ref -q HEAD >/dev/null; then echo 'Expected detached baseline checkout' >&2; exit 1; fi
[[ ! -e apps/web/.next && ! -e apps/frontend/dist ]]
unset TURBOPACK NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY \
  NEXT_PUBLIC_SENTRY_DSN SENTRY_AUTH_TOKEN SUPABASE_SECRET_KEY
mkdir -- "$out"
pnpm install --frozen-lockfile --store-dir "$out/pnpm-store"
mkdir -- "$out/font-source"
for weight in Regular Bold; do
  f=NotoSansCJKsc-$weight.otf
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 120 --retry 2 \
    "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/$f" -o "$out/font-source/$f"
done
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; for (const name of ["LICENSE.txt", "README.md"]) fs.writeFileSync(path.join(process.argv[1], name), fs.readFileSync(path.join("doc/licenses/apparel-noto", name), "utf8").replace(/\r?\n/g, "\r\n"));' "$out/font-source"
node ops/aliyun/package-static-assets.mjs --font-source "$out/font-source" --output "$out/resources" > "$out/resources.json"
res=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).versionDirectory' "$out/resources.json")
digest=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).manifestSha256' "$out/resources.json")
[[ "$res" == "$out/resources/"* && "$digest" =~ ^[a-f0-9]{64}$ ]]
export ZIMAGE_SHARED_FONT_DIR="$res/fonts" ZIMAGE_STATIC_ASSET_SHA256="$digest" NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_DATA_MODE=http NEXT_PUBLIC_PHASE2_AUTH=true ZIMAGE_DEPLOYMENT_ENV=production \
 NODE_OPTIONS=--max-old-space-size=4096 ZIMAGE_BUILD_SHA="$sha" ZIMAGE_BUILD_SLIM=1 NEXT_PUBLIC_STATIC_ASSET_BASE_URL='' \
 pnpm --filter @zimage/web exec next build --webpack
test "$(cat apps/web/.next/BUILD_ID)" = "$sha"
test -f apps/web/.next/standalone/apps/web/server.js
cp -a -- apps/web/.next/standalone "$out/app"
cp -a -- apps/web/.next/static "$out/app/apps/web/.next/static"
export ZIMAGE_ASSET_NAMESPACE="rehearsal-$sha-$3"
export ZIMAGE_FRONTEND_COMPATIBILITY="{\"apiRequirements\":{\"major\":1,\"minMinor\":0,\"capabilities\":[\"runtime.public-config.v1\",\"runtime.meta.v1\"]},\"allowedBackendReleases\":[\"$sha\"]}"
pnpm build:frontend
cp -a -- apps/frontend/dist "$out/web"
node --input-type=module -e 'import fs from "node:fs"; const [f,sha,ns]=process.argv.slice(1), c=JSON.parse(fs.readFileSync(f)); if (c.namespace!==ns || c.sourceIdentity?.sourceSHA!==sha || c.sourceIdentity?.dirty!==false || JSON.stringify(c.allowedBackendReleases)!==JSON.stringify([sha])) process.exit(1);' "$out/web/.release/candidate.json" "$sha" "$ZIMAGE_ASSET_NAMESPACE"
printf 'source-reconstructed-nonpromotable\n%s\n%s\n' "$sha" "$digest" > "$out/RECONSTRUCTION_ONLY"
printf 'APP_ROOT=%s\nWEB_ROOT=%s\nRESOURCE_ROOT=%s\nRESOURCE_DIGEST=%s\n' "$out/app" "$out/web" "$res" "$digest"
