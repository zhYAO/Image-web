#!/usr/bin/env bash
# Local draft: run two isolated Vitest shards, then enforce the configured
# global coverage thresholds on their combined result. Not wired to Flow.
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  printf 'Usage: %s WEB_PROJECT_DIRECTORY\n' "$0" >&2
  exit 2
fi
repo_root="$(cd "$(dirname "$0")/../../../.." && pwd -P)"
web_root="$(cd "$1" && pwd -P)"
vitest="$repo_root/node_modules/vitest/vitest.mjs"
test -f "$vitest"
work="$(mktemp -d)"
mkdir "$work/reports"
pid1=''
pid2=''
finish_group() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    # The group leader stays alive and ignores TERM until KILL, preventing
    # process-group ID reuse while descendants are being stopped.
    kill -TERM -- "-$pid" 2>/dev/null || true
    sleep 0.2
    kill -KILL -- "-$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
cleanup() {
  finish_group "$pid1"
  finish_group "$pid2"
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

cd "$web_root"
node "$vitest" list --root "$web_root" --no-cache --filesOnly --json > "$work/inventory.json"
# Give each child a separate process group so cancellation includes its workers.
set -m
for shard in 1 2; do
  (
    # Keep the group leader alive until its parent has cleaned up descendants.
    trap '' TERM
    set +e
    (
      trap - TERM
      exec node "$vitest" run --root "$web_root" --no-cache --coverage --reporter=blob \
        --maxWorkers=1 --testTimeout=120000 --shard="$shard/2" \
        --outputFile.blob="$work/reports/shard-$shard.json" \
        --coverage.reportsDirectory="$work/coverage-$shard" \
        --coverage.thresholds.lines=0 --coverage.thresholds.statements=0 \
        --coverage.thresholds.functions=0 --coverage.thresholds.branches=0
    )
    status=$?
    printf '%s\n' "$status" > "$work/shard-$shard.status.tmp"
    mv "$work/shard-$shard.status.tmp" "$work/shard-$shard.status"
    while :; do sleep 1; done
  ) &
  if [[ "$shard" -eq 1 ]]; then pid1="$!"; else pid2="$!"; fi
done

failed=0
while [[ -n "$pid1" || -n "$pid2" ]]; do
  if [[ -n "$pid1" ]] && [[ -f "$work/shard-1.status" ]]; then
    status="$(cat "$work/shard-1.status")"
    [[ "$status" = 0 ]] || failed=1
    finish_group "$pid1"
    pid1=''
  elif [[ -n "$pid1" ]] && ! kill -0 "$pid1" 2>/dev/null; then
    wait "$pid1" 2>/dev/null || true
    pid1=''
    failed=1
  fi
  if [[ -n "$pid2" ]] && [[ -f "$work/shard-2.status" ]]; then
    status="$(cat "$work/shard-2.status")"
    [[ "$status" = 0 ]] || failed=1
    finish_group "$pid2"
    pid2=''
  elif [[ -n "$pid2" ]] && ! kill -0 "$pid2" 2>/dev/null; then
    wait "$pid2" 2>/dev/null || true
    pid2=''
    failed=1
  fi
  if [[ "$failed" -ne 0 ]]; then break; fi
  if [[ -n "$pid1" || -n "$pid2" ]]; then sleep 1; fi
done
if [[ "$failed" -ne 0 ]]; then
  printf 'A Web test shard failed; combined coverage is not accepted.\n' >&2
  exit 1
fi
for shard in 1 2; do
  report="$work/reports/shard-$shard.json"
  if [[ ! -f "$report" || -L "$report" || ! -s "$report" ]]; then
    printf 'Missing or invalid report for Web shard %s.\n' "$shard" >&2
    exit 1
  fi
done

# No threshold override here: merge applies the project's configured gate.
node "$vitest" run --root "$web_root" --no-cache --merge-reports="$work/reports" \
  --coverage --coverage.reportsDirectory="$work/coverage-merged" \
  --reporter=default --reporter=json --outputFile.json="$work/merged.json"
node "$repo_root/docs/superpowers/plans/assets/yunxiao-verify-web-report-draft.mjs" \
  "$work/inventory.json" "$work/merged.json"
