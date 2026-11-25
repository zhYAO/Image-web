#!/usr/bin/env bash
# Run after the pair build and app checks on the same runner. Unknown scope runs everything.
set -euo pipefail

paths="$RUNNER_TEMP/zimage-changed-paths"
if [[ "$GITHUB_EVENT_NAME" == pull_request && "${BASE_SHA:-}" =~ ^[a-f0-9]{40}$ &&
      "$BASE_SHA" == "$(git rev-parse HEAD^1)" ]] &&
    git diff --no-renames --name-only -z "$BASE_SHA" HEAD > "$paths" && [[ -s "$paths" ]]; then
  full=false
  while IFS= read -r -d '' path; do
    case "$path" in
      doc/licenses/*) full=true; break ;; # Packaging consumes the original font provenance.
      README.md|doc/*.md|docs/*.md|apps/frontend/src/pages/*|apps/frontend/tests/*) ;;
      *) full=true; break ;;
    esac
  done < "$paths"
  if [[ "$full" == false ]]; then
    echo 'Only docs or frontend pages/tests changed; pair and application checks passed.'
    exit 0
  fi
fi

echo 'Running full Web, Worker, release and local database regressions.'
source_dir=$(node ops/aliyun/prepare-candidate-fonts.mjs | jq -er .)
fonts=$(node ops/aliyun/package-static-assets.mjs --font-source "$source_dir" --fonts-only true --output "$RUNNER_TEMP/zimage-test-fonts")
ZIMAGE_SHARED_FONT_DIR=$(jq -er '.versionDirectory + "/fonts"' <<< "$fonts")
ZIMAGE_STATIC_ASSET_SHA256=$(jq -er .manifestSha256 <<< "$fonts")
export ZIMAGE_SHARED_FONT_DIR ZIMAGE_STATIC_ASSET_SHA256 ZIMAGE_TEST_ORIGINAL_FONT_SOURCE="$source_dir"

pnpm --filter @zimage/web exec vitest run --coverage --maxWorkers=1 --testTimeout=120000
pnpm --filter @zimage/web test:acceptance-budget
pnpm exec vitest run supabase/functions/generation-worker supabase/functions/cleanup-worker
node --test scripts/dev.test.mjs scripts/dev-split.test.mjs scripts/acceptance-credit-budget.test.mjs scripts/release.test.mjs
npm ci --prefix ops/aliyun/fixtures/legacy-sharp --ignore-scripts --no-audit --no-fund
node --test apps/web/scripts/ui-dependency-boundary.test.mjs apps/web/scripts/measure-dist.test.mjs \
  ops/aliyun/package-static-assets.test.mjs ops/aliyun/prepare-candidate-fonts.test.mjs \
  ops/aliyun/package-release.test.mjs ops/aliyun/native-font-probe.test.mjs \
  ops/aliyun/frontend/package.test.mjs ops/aliyun/backend/http-admission.test.cjs
for dir in ops/aliyun ops/aliyun/frontend ops/aliyun/backend; do
  python3 -B -m unittest discover -s "$dir" -p 'test_*.py'
done
NEXT_PUBLIC_DATA_MODE=mock pnpm build
node apps/web/scripts/verify-built-retired-route.mjs

pnpm exec supabase start --exclude studio,imgproxy,edge-runtime,logflare,vector,realtime,mailpit
pnpm exec supabase test db --local supabase/tests/database
generated="$RUNNER_TEMP/database.generated.ts"
pnpm exec supabase gen types typescript --local > "$generated"
diff --strip-trailing-cr --unified apps/web/lib/supabase/database.generated.ts "$generated"
