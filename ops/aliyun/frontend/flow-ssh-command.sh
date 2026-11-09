#!/bin/sh
set -eu

if [ "${SSH_ORIGINAL_COMMAND:-}" != frontend-operation-v1 ]; then
    printf '%s\n' 'Only the approved frontend operation protocol is available.' >&2
    exit 126
fi

exec /usr/bin/sudo -n -- /usr/bin/python3 -I -B /opt/zimage/frontend-flow-tools/flow_release.py
