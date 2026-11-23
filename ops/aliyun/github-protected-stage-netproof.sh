#!/usr/bin/env bash
# Disposable hosted diagnostic only. No application, real credential, or signing.
set -euo pipefail
umask 077
ref=refs/heads/codex/zimage-protected-stage-netproof-20261122
[[ ${GITHUB_REPOSITORY:-} == zhYAO/Image-web && ${GITHUB_EVENT_NAME:-} == push &&
   ${GITHUB_REF:-} == "$ref" && ${GITHUB_WORKFLOW_REF:-} == "zhYAO/Image-web/.github/workflows/protected-stage-netproof.yml@$ref" &&
   ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == Linux && "$(uname -m)" == x86_64 &&
   -z ${GH_TOKEN:-} && -z ${GITHUB_TOKEN:-} &&
   ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ && "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]
[[ "$(getconf GNU_LIBC_VERSION)" == 'glibc 2.35' ]]
[[ ${ZIMAGE_FROZEN_BASELINE:-0} != 1 || ${ZIMAGE_FROZEN_CANDIDATE:-0} == 1 ]]
root=$(pwd -P)
scratch=$(mktemp -d "$RUNNER_TEMP/zimage-netproof.XXXXXXXX")
image=docker.io/library/ubuntu@sha256:45e9ddc6895604674618a409ca9f73d301da8fdb75fe330e8e9a27b3b219e4ad
network=zimage-staging-internal
iface=zimg-netproof
bridge=172.31.219.1
peer=172.31.219.2
id='' mock='' gateway='' tripwire='' denied=0 allowed=0 reply_allowed=0
# Only connection-tracked replies from the exact candidate listener to the
# local bridge address; NEW candidate traffic still hits the deny rule.
reply_rule=(-i "$iface" -s "$peer" -d "$bridge" -p tcp --sport 3100
  -m conntrack --ctstate ESTABLISHED --ctdir REPLY
  --ctorigsrc "$bridge" --ctorigdst "$peer" --ctorigdstport 3100 -j ACCEPT)
cleanup() {
  status=$?
  set +e
  if [[ -n "$gateway" ]]; then kill "$gateway"; wait "$gateway"; fi
  if [[ -n "$tripwire" ]]; then kill "$tripwire"; wait "$tripwire"; fi
  if [[ -n "$mock" ]]; then kill "$mock"; wait "$mock"; fi
  if [[ "$reply_allowed" == 1 ]]; then sudo iptables -D INPUT "${reply_rule[@]}"; fi
  if [[ "$allowed" == 1 ]]; then sudo iptables -D INPUT -i "$iface" -s "$peer" -d "$bridge" -p tcp --dport 8443 -j ACCEPT; fi
  if [[ "$denied" == 1 ]]; then sudo iptables -D INPUT -i "$iface" -s "$peer" -j REJECT; fi
  if [[ -n "$id" ]]; then docker network rm "$id" >/dev/null; fi
  rm -rf -- "$scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
! docker network inspect "$network" >/dev/null 2>&1
! ip link show "$iface" >/dev/null 2>&1
docker pull --platform linux/amd64 "$image" >/dev/null
curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 120 \
  https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz -o "$scratch/node.tar.xz"
printf '%s  %s\n' 14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647 "$scratch/node.tar.xz" | sha256sum --check --status
tar -xOf "$scratch/node.tar.xz" node-v24.19.0-linux-x64/bin/node > "$scratch/node"
printf '%s  %s\n' bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12 "$scratch/node" | sha256sum --check --status
chmod 0555 "$scratch/node"
id=$(docker network create --driver bridge --internal --subnet 172.31.219.0/29 --gateway "$bridge" \
  --opt "com.docker.network.bridge.name=$iface" "$network")
[[ "$id" =~ ^[a-f0-9]{64}$ ]]
docker network inspect --format '{{.Internal}} {{.EnableIPv6}} {{.Driver}} {{len .Containers}}' "$id" | grep -Fx 'true false bridge 0'
sudo iptables -I INPUT 1 -i "$iface" -s "$peer" -j REJECT
denied=1
sudo iptables -I INPUT 1 -i "$iface" -s "$peer" -d "$bridge" -p tcp --dport 8443 -j ACCEPT
allowed=1
bash ops/aliyun/prepare-isolated-gateway-tls.sh "$scratch/tls" "$bridge"
cat > "$scratch/mock.py" <<'PY'
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        if self.path != '/auth/v1/user':
            self.send_error(403)
            return
        b = b'{"syntheticBoundary":true}'
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(b)))
        self.end_headers()
        self.wfile.write(b)
HTTPServer((sys.argv[1],int(sys.argv[2])), Handler).serve_forever()
PY
python3 -I -B "$scratch/mock.py" 127.0.0.1 55421 & mock=$!
python3 -I -B "$scratch/mock.py" "$bridge" 55422 & tripwire=$!
python3 -I -B ops/aliyun/isolated-supabase-gateway.py --listen-ip "$bridge" --candidate-ip "$peer" \
  --certificate "$scratch/tls/gateway.pem" --private-key "$scratch/tls/gateway.key" --netproof-mock-origin & gateway=$!
for _ in $(seq 1 30); do
  kill -0 "$mock" "$gateway" "$tripwire"
  if ss -ltn | grep -Fq "$bridge:8443"; then break; fi
  sleep .1
done
kill -0 "$mock" "$gateway" "$tripwire"
curl --noproxy "*" --max-time 2 --silent --show-error --fail "http://$bridge:55422/auth/v1/user" | grep -Fx '{"syntheticBoundary":true}'
cp "$root/ops/aliyun/probe-isolated-gateway.mjs" "$scratch/probe.mjs"
chmod 0444 "$scratch/probe.mjs"
docker run --rm --pull never --platform linux/amd64 --network "$id" --ip "$peer" \
  --add-host "zimage-fixture-gateway:$bridge" --user 65532:65532 --cap-drop ALL --read-only \
  --security-opt no-new-privileges:true --pids-limit 64 --memory 256m \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
  --mount "type=bind,src=$scratch/node,dst=/node,readonly,bind-recursive=disabled" \
  --mount "type=bind,src=$scratch/probe.mjs,dst=/proof.mjs,readonly,bind-recursive=disabled" \
  --mount "type=bind,src=$scratch/tls/ca.pem,dst=/fixture-ca.pem,readonly,bind-recursive=disabled" \
  --env NODE_EXTRA_CA_CERTS=/fixture-ca.pem --env ZIMAGE_SYNTHETIC_NET_PROBE=1 \
  "$image" /node /proof.mjs "$bridge"
printf '%s\n' 'Linux synthetic network boundary only; no candidate release, database, signing or deployment.'
if [[ ${ZIMAGE_FROZEN_CANDIDATE:-0} == 1 ]]; then
  # Never reuse Supabase API or database ports for the mock. Only restart
  # the owned diagnostic gateway to switch its fixed upstream; keep TLS,
  # exact bridge, firewall and container isolation unchanged.
  kill "$mock" "$tripwire" "$gateway"
  wait "$mock" || true; mock=''
  wait "$tripwire" || true; tripwire=''
  wait "$gateway" || true; gateway=''
  python3 -I -B - <<'PY_PORT'
import socket
ports=(54320,54321,54322,54323,54324,54329)
sockets=[]
try:
    for port in ports:
        s=socket.socket()
        sockets.append(s)
        s.bind(('0.0.0.0',port))
except OSError:
    raise SystemExit('Disposable Supabase localhost port unavailable')
finally:
    for s in sockets: s.close()
PY_PORT
  python3 -I -B ops/aliyun/isolated-supabase-gateway.py --listen-ip "$bridge" --candidate-ip "$peer" \
    --certificate "$scratch/tls/gateway.pem" --private-key "$scratch/tls/gateway.key" & gateway=$!
  for _ in $(seq 1 30); do
    kill -0 "$gateway"
    if ss -ltn | grep -Fq "$bridge:8443"; then break; fi
    sleep .1
  done
  kill -0 "$gateway"
  ss -ltn | grep -F "$bridge:8443" >/dev/null
  frozen="$RUNNER_TEMP/zimage-frozen-92663"
  test -d "$frozen" && test ! -L "$frozen" && test -d "$frozen/files" && test ! -L "$frozen/files"
  test ! -e /opt/zimage && test ! -L /opt/zimage
  sudo install -d -m 0755 /opt/zimage
  sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0700 /opt/zimage/layer-cache
  python3 -I -B ops/aliyun/prepare-92663-isolated-pair.py "$frozen/files" "$frozen/verified.json" \
    "$scratch/prepared" /opt/zimage/layer-cache > "$scratch/preparation.json"
  trusted_commit=$(python3 -I -B - "$scratch/preparation.json" <<'PY_COMMIT'
import json, re, sys
verified = json.load(open(sys.argv[1]))
if verified['applicationStarted'] is not False or verified['productionReady'] is not False or not re.fullmatch('[a-f0-9]{40}', verified['commit']):
    raise ValueError('Trusted materializer output invalid')
print(verified['commit'])
PY_COMMIT
)
  cat "$scratch/preparation.json"
  chmod 0755 "$scratch/prepared/app" /opt/zimage/layer-cache
  [[ "$(node --version)" == v24.19.0 && "$(pnpm --version)" == 11.19.0 ]]
  pnpm install --frozen-lockfile
  python3 -I -B ops/aliyun/prepare-m6-browser-fixture.py "$root/supabase/migrations" "$scratch/m6"
  export PLAYWRIGHT_BROWSERS_PATH="$scratch/chromium"
  driver=$(node --input-type=module -e 'import {playwrightPath} from "./ops/aliyun/isolated-auth-browser.mjs"; console.log(playwrightPath(process.cwd()))')
  node "$(dirname "$driver")/cli.js" install --with-deps chromium
  local_route=$(ip -4 route get "$peer")
  [[ " $local_route " == *" dev $iface "* && " $local_route " == *" src $bridge "* ]]
  sudo iptables -I INPUT 1 "${reply_rule[@]}"
  reply_allowed=1
  sudo iptables -C INPUT "${reply_rule[@]}"
  baseline_args=()
  if [[ ${ZIMAGE_FROZEN_BASELINE:-0} == 1 ]]; then
    old_sha=7a811b326aa4b344cee08bc5a33c04e44a780fd4
    old_source="$scratch/baseline-source"
    git init -q "$old_source"
    git -C "$old_source" fetch --quiet --depth 1 https://github.com/zhYAO/Image-web.git "$old_sha"
    git -C "$old_source" checkout --quiet --detach "$old_sha"
    TMPDIR="$scratch" bash ops/aliyun/reconstruct-7a-browser-fixture.sh "$old_source" "$scratch/baseline" "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    # Reconstructed fixture permissions only; source preparation used umask 077.
    # Candidate and verified layer bytes/modes stay untouched.
    find "$scratch/baseline/app" "$scratch/baseline/resources" -type d -exec chmod a+rx {} +
    find "$scratch/baseline/app" "$scratch/baseline/resources" -type f -exec chmod a+r {} +
    baseline_args+=("$scratch/baseline")
  fi
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$scratch" RUNNER_ENVIRONMENT=github-hosted RUNNER_OS=Linux \
    ZIMAGE_TRUSTED_ARCHIVE_COMMIT="$trusted_commit" PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" LANG=C.UTF-8 NEXT_TELEMETRY_DISABLED=1 \
    node ops/aliyun/isolated-auth-92663-container.mjs "$root" "$scratch/prepared/app" "$scratch/prepared/web" \
      --protected-main-shadow "$scratch/m6" "$scratch/node" "$scratch/tls/ca.pem" "$id" "${baseline_args[@]}"
fi
