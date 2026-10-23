#!/usr/bin/env bash
# Permanent release checks using only the existing restricted deployment connection.
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_PORT:?DEPLOY_PORT is required}"
ssh_args=(-T -i "$HOME/.ssh/zimage" -p "$DEPLOY_PORT" -o StrictHostKeyChecking=yes "zimage-deploy@$DEPLOY_HOST")
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

current_release() {
  local current
  if ! current=$(ssh "${ssh_args[@]}" 'readlink -f /opt/zimage/current'); then
    echo 'Cannot read current release; refusing to assume a rollback point.' >&2
    return 1
  fi
  if [[ ! "$current" =~ ^/opt/zimage/releases/([a-f0-9]{40})$ ]]; then
    echo 'Current release is not an exact retained commit; refusing to proceed.' >&2
    return 1
  fi
  printf '%s\n' "${BASH_REMATCH[1]}"
}

if [[ "${1:-}" == record && $# == 1 ]]; then
  current_release
  exit 0
fi
if [[ "${1:-}" != verify || $# != 3 || ! "$2" =~ ^[a-f0-9]{40}$ || ! "$3" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Usage: deployment-health.sh record | verify EXPECTED_SHA ORIGINAL_SHA' >&2
  exit 1
fi
expected=$2
original=$3
if ssh "${ssh_args[@]}" "python3 - $expected" < "$script_dir/verify-release.py"; then
  exit 0
fi

echo 'Published release verification failed; checking the exact original rollback point.' >&2
current=$(current_release) || exit 1
if [[ "$current" != "$expected" ]]; then
  echo 'Current release changed; refusing to roll back a different deployment.' >&2
  exit 1
fi
if [[ "$original" == "$expected" ]]; then
  echo 'Same-SHA redeployment had no version change; keeping the current release.' >&2
  exit 1
fi
# The installed helper verifies the restored version, login, static assets and
# anonymous account denial. New-page checks must not be applied to an old release.
if ! ssh "${ssh_args[@]}" "sudo /usr/local/sbin/zimage-release rollback $original"; then
  echo 'Rollback failed; the original verification failure remains unresolved.' >&2
  exit 1
fi
echo "Restored original release: $original" >&2
exit 1
