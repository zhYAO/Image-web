#!/usr/bin/env bash
set -euo pipefail
archive="$1"
checksum="$2"
mkdir -p "$(dirname "$archive")"
verify() { printf '%s  %s\n' "$checksum" "$1" | sha256sum --check -; }
if [[ -f "$archive" && ! -L "$archive" ]] && verify "$archive" >/dev/null 2>&1; then
  printf 'Verified Node archive cache hit.\n'
  exit 0
fi
rm -f "$archive"
temporary="$(mktemp "${archive}.tmp.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
mirror='https://npmmirror.com/mirrors/node/v24.19.0/node-v24.19.0-linux-x64.tar.gz'
official='https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.gz'
if ! curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 10 --max-time 45 \
  "$mirror" --output "$temporary"; then
  printf 'Node mirror unavailable; trying official source.\n' >&2
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 10 --max-time 45 \
    "$official" --output "$temporary"
fi
# A downloaded mismatch is a hard failure, not a reason to trust another source.
verify "$temporary"
mv -f "$temporary" "$archive"
