#!/usr/bin/env bash
set -euo pipefail

revision="${EXPECTED_COMMIT:?Flow must supply EXPECTED_COMMIT}"
if [[ ! "$revision" =~ ^[a-f0-9]{40}$ ]] || [[ "$(git rev-parse --verify HEAD)" != "$revision" ]]; then
  printf '%s\n' 'Flow checkout does not match expected commit.' >&2
  exit 1
fi
case "${1:-}" in
  quality|database|backend) ;;
  *) printf '%s\n' 'Expected Flow job quality, database or backend.' >&2; exit 1 ;;
esac
if [[ "$(uname -s)/$(uname -m)" != Linux/x86_64 ]]; then
  printf '%s\n' 'Flow checks require Linux x86_64.' >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
archive="${ZIMAGE_FLOW_NODE_CACHE:-$work}/node-v24.19.0-linux-x64.tar.gz"
bash docs/superpowers/plans/assets/yunxiao-node-archive-draft.sh \
  "$archive" f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4
tar -xzf "$archive" -C "$work"
export PATH="$work/node-v24.19.0-linux-x64/bin:$PATH"
npm install --global --prefix "$work/pnpm" pnpm@11.19.0
export PATH="$work/pnpm/bin:$PATH"
node ops/flow/checks.mjs "$1"
