#!/usr/bin/env bash
# Permanent release checks using only the existing restricted deployment connection.
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_PORT:?DEPLOY_PORT is required}"
ssh_args=(-T -i "$HOME/.ssh/zimage" -p "$DEPLOY_PORT" -o StrictHostKeyChecking=yes "zimage-deploy@$DEPLOY_HOST")
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
layer_helper='/usr/bin/python3 -I /usr/local/libexec/zimage-three-layer/release-three-layer.py'
release_format=${RELEASE_FORMAT:-layers}
if [[ "$release_format" != layers && "$release_format" != full ]]; then
  echo 'RELEASE_FORMAT must be layers or explicit full.' >&2
  exit 1
fi

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

verify_installed_helper() {
  local expected actual
  expected=$(sha256sum "$script_dir/release.py")
  expected=${expected%% *}
  if ! actual=$(ssh "${ssh_args[@]}" 'sha256sum /usr/local/sbin/zimage-release'); then
    echo 'Cannot verify the installed release helper; refusing activation.' >&2
    return 1
  fi
  actual=${actual%% *}
  if [[ ! "$actual" =~ ^[a-f0-9]{64}$ || "$actual" != "$expected" ]]; then
    echo 'Installed release helper differs from this revision; administrator installation is required before activation.' >&2
    return 1
  fi
}

verify_layer_helper() {
  local name expected actual
  for name in release-three-layer.py release.py release-layers.py three-layer-release.py release-transport.py release-public-policy.json; do
    expected=$(sha256sum "$script_dir/$name")
    expected=${expected%% *}
    actual=$(ssh "${ssh_args[@]}" "sha256sum /usr/local/libexec/zimage-three-layer/$name") || {
      echo 'Missing reviewed layer helper closure; administrator installation is required.' >&2
      return 1
    }
    actual=${actual%% *}
    if [[ ! "$actual" =~ ^[a-f0-9]{64}$ || "$actual" != "$expected" ]]; then
      echo 'Installed layer helper closure differs; administrator installation is required.' >&2
      return 1
    fi
  done
  ssh "${ssh_args[@]}" "sudo $layer_helper check-target" >&2 || {
    echo 'Administrator must install and enable the exact verified target configuration.' >&2
    return 1
  }
}

retained_format() {
  local target=$1 format
  format=$(ssh "${ssh_args[@]}" "if test -e /opt/zimage/releases/$target/.three-layer-release.json || test -L /opt/zimage/releases/$target/.three-layer-release.json; then printf layers; elif test -e /opt/zimage/releases/$target/.manifest-sha256 || test -L /opt/zimage/releases/$target/.manifest-sha256; then printf invalid; else printf full; fi") || return 1
  if [[ "$format" != layers && "$format" != full ]]; then
    echo 'Retained release format is damaged or unknown; refusing recovery.' >&2
    return 1
  fi
  printf '%s\n' "$format"
}

verify_format_helper() {
  if [[ "$1" == layers ]]; then
    verify_layer_helper
  elif [[ "$1" == full ]]; then
    verify_installed_helper
  else
    echo 'Unknown release format; refusing activation or recovery.' >&2
    return 1
  fi
}

rollback_exact() {
  local target=$1 format
  format=$(retained_format "$target") || return 1
  verify_format_helper "$format" || return 1
  if [[ "$format" == layers ]]; then
    ssh "${ssh_args[@]}" "sudo $layer_helper rollback $target"
  else
    ssh "${ssh_args[@]}" "sudo /usr/local/sbin/zimage-release rollback $target"
  fi
}

if [[ "${1:-}" == check-install && $# == 1 ]]; then
  verify_format_helper "$release_format"
  exit 0
fi

if [[ "${1:-}" == record && $# == 1 ]]; then
  verify_format_helper "$release_format"
  original=$(current_release)
  original_format=$(retained_format "$original")
  if [[ "$original_format" != "$release_format" ]]; then
    verify_format_helper "$original_format"
  fi
  if ! python3 "$script_dir/verify-release.py" "$original" --public-recovery >&2; then
    echo 'Current public release is not verified; stopping before activation.' >&2
    exit 1
  fi
  printf '%s\n' "$original"
  exit 0
fi
if [[ "${1:-}" == rollback && $# == 2 ]]; then
  target=$2
  if [[ "$target" == previous ]]; then
    target=$(ssh "${ssh_args[@]}" 'readlink -f /opt/zimage/previous')
    if [[ ! "$target" =~ ^/opt/zimage/releases/([a-f0-9]{40})$ ]]; then
      echo 'Cannot externally verify an unversioned rollback target; refusing activation.' >&2
      exit 1
    fi
    target=${BASH_REMATCH[1]}
  fi
  if [[ ! "$target" =~ ^[a-f0-9]{40}$ ]]; then
    echo 'Rollback target must be an exact retained SHA or versioned previous.' >&2
    exit 1
  fi
  rollback_exact "$target"
  restored=$(current_release)
  if [[ "$restored" != "$target" ]]; then
    echo 'Rollback selected an unexpected release; external verification refused.' >&2
    exit 1
  fi
  python3 "$script_dir/verify-release.py" "$restored" --public-recovery
  exit 0
fi
if [[ "${1:-}" != verify || $# != 3 || ! "$2" =~ ^[a-f0-9]{40}$ || ! "$3" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Usage: deployment-health.sh check-install | record | verify EXPECTED_SHA ORIGINAL_SHA | rollback SHA_OR_previous' >&2
  exit 1
fi
expected=$2
original=$3
if ssh "${ssh_args[@]}" "python3 - $expected" < "$script_dir/verify-release.py" \
  && python3 "$script_dir/verify-release.py" "$expected" --public-only; then
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
if ! rollback_exact "$original"; then
  echo 'Rollback failed; the original verification failure remains unresolved.' >&2
  exit 1
fi
if ! python3 "$script_dir/verify-release.py" "$original" --public-recovery; then
  echo 'Original release selected, but external recovery verification failed.' >&2
  exit 1
fi
echo "Restored original release: $original" >&2
exit 1
