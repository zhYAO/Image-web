#!/usr/bin/env bash
# Creates ephemeral material in an empty host-owned scratch directory only.
set -euo pipefail
umask 077
[[ $# == 2 && "$1" == /* && ! -e "$1" && ! -L "$1" ]]
ip=$2
python3 -I -B - "$ip" <<'PY'
from ipaddress import IPv4Address, ip_network
import sys
ip = IPv4Address(sys.argv[1])
if str(ip) != sys.argv[1] or (str(ip) != '127.0.0.1' and ip not in ip_network('172.16.0.0/12')):
    raise SystemExit('Expected exact private bridge IPv4 address')
PY
mkdir -m 700 "$1"
cd "$1"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 -keyout ca.key -out ca.pem \
  -subj '/CN=ZImage disposable fixture CA' -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
  -addext 'keyUsage=critical,keyCertSign' >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -keyout gateway.key -out gateway.csr \
  -subj '/CN=ZImage synthetic Supabase gateway' >/dev/null 2>&1
printf 'subjectAltName=IP:%s,DNS:zimage-fixture-gateway\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$ip" > extensions
openssl x509 -req -days 1 -sha256 -in gateway.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
  -extfile extensions -out gateway.pem >/dev/null 2>&1
openssl verify -CAfile ca.pem -verify_ip "$ip" gateway.pem >/dev/null
rm -f -- ca.key ca.srl gateway.csr extensions
# Only this public CA is mounted read-only into the candidate, never gateway.key.
chmod 0444 ca.pem gateway.pem
