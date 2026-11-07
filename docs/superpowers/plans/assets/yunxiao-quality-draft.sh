#!/usr/bin/env bash
# Draft for one manually initiated Flow quality job; not a production release.
set -euo pipefail

test "$(uname -m)" = x86_64
for tool in git curl sha256sum tar python3; do
  command -v "$tool" >/dev/null || { printf 'Missing required tool: %s\n' "$tool" >&2; exit 1; }
done
cd "${PROJECT_DIR:?Flow must supply PROJECT_DIR}"
test "$(git rev-parse HEAD)" = "${EXPECTED_COMMIT:?Set the approved main commit}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive=node-v24.19.0-linux-x64.tar.gz
curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 300 \
  "https://nodejs.org/dist/v24.19.0/$archive" --output "$work/$archive"
printf '%s  %s\n' \
  f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4 \
  "$work/$archive" | sha256sum --check -
tar -xzf "$work/$archive" -C "$work"
export PATH="$work/node-v24.19.0-linux-x64/bin:$PATH"
test "$(node --version)" = v24.19.0
npm install --global pnpm@11.19.0
test "$(pnpm --version)" = 11.19.0
export CI=true NEXT_TELEMETRY_DISABLED=1

pnpm install --frozen-lockfile

mkdir "$work/font-source"
for weight in Regular Bold; do
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 300 \
    "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-$weight.otf" \
    --output "$work/font-source/NotoSansCJKsc-$weight.otf"
done
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; for (const name of ["LICENSE.txt", "README.md"]) fs.writeFileSync(path.join(process.argv[1], name), fs.readFileSync(path.join("doc/licenses/apparel-noto", name), "utf8").replace(/\r?\n/g, "\r\n"));' "$work/font-source"
node ops/aliyun/package-static-assets.mjs --font-source "$work/font-source" --fonts-only true --output "$work/test-fonts" > "$work/test-fonts.json"
export ZIMAGE_SHARED_FONT_DIR="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).versionDirectory + "/fonts"' "$work/test-fonts.json")"
export ZIMAGE_STATIC_ASSET_SHA256="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).manifestSha256' "$work/test-fonts.json")"

pnpm lint
pnpm typecheck
pnpm --filter @zimage/domain test:coverage
pnpm --filter @zimage/frontend test:run
bash "$PROJECT_DIR/docs/superpowers/plans/assets/yunxiao-web-shards-draft.sh" "$PROJECT_DIR/apps/web"
pnpm --filter @zimage/web test:acceptance-budget
node --test scripts/dev.test.mjs scripts/dev-split.test.mjs scripts/acceptance-credit-budget.test.mjs scripts/release.test.mjs
node --test apps/web/scripts/ui-dependency-boundary.test.mjs apps/web/scripts/measure-dist.test.mjs ops/aliyun/package-static-assets.test.mjs ops/aliyun/package-release.test.mjs ops/aliyun/native-font-probe.test.mjs
python3 -m unittest discover -s ops/aliyun -p 'test_*.py'
python3 -m unittest discover -s ops/aliyun/frontend -p 'test_*.py'
python3 -m unittest discover -s ops/aliyun/backend -p 'test_*.py'
node --test ops/aliyun/frontend/package.test.mjs ops/aliyun/backend/http-admission.test.cjs
pnpm exec vitest run supabase/functions/generation-worker supabase/functions/cleanup-worker

revision="$(git rev-parse HEAD)"
export ZIMAGE_ASSET_NAMESPACE="ci-$revision"
export ZIMAGE_FRONTEND_COMPATIBILITY="{\"apiRequirements\":{\"major\":1,\"minMinor\":0,\"capabilities\":[\"runtime.public-config.v1\",\"runtime.meta.v1\"]},\"allowedBackendReleases\":[\"$revision\"]}"
pnpm build:frontend
NEXT_PUBLIC_DATA_MODE=mock pnpm build
node apps/web/scripts/verify-built-retired-route.mjs
