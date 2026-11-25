"""A single noninteractive SSH session. A lost connection never triggers a write retry."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import ipaddress
import re
import shutil
import subprocess
import sys
import tempfile

from check import SHA, NAMESPACE
from kit import identity, source_contents

CLIENT_FINGERPRINT = 'SHA256:2KEGjp7U/rFuYaMGzq9WKQKv61ZDvbVKJSc1kqG+AyE'
AFTER_PUBLIC_ACK = {
    'before': {'candidate', 'restoration'}, 'candidate': {'live', 'restoration'},
    'live': {'restoration'}, 'restoration': {'restored-live'}, 'restored-live': set(),
}


class Restored(RuntimeError):
    """The receiver exited 20 after both independent public restoration probes passed."""


def fetch_public(path, local):
    if local:
        raise ValueError('The sender only checks the public origin')
    # setup-node supplies PATH. No inherited Node hooks, proxy settings or credentials.
    return subprocess.check_output(['node', Path(__file__).with_name('sender_fetch.cjs'), path],
                                   env={'PATH': os.environ['PATH']}, stdin=subprocess.DEVNULL, timeout=8)


def probe(sha, namespace):
    # Bind the transport on a private instance; the receiver uses the original module.
    spec = importlib.util.spec_from_file_location('sender_contract', Path(__file__).with_name('check.py'))
    contract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contract)
    contract.fetch = fetch_public
    contract.probe(sha, namespace)


def deliver(process, sha, archive, bundle):
    receiver_id = identity(source_contents())
    header = f'{receiver_id} {sha} {bundle.stat().st_size} {archive.stat().st_size}\n'.encode()
    process.stdin.write(header)
    for file in (bundle, archive):
        with file.open('rb') as src:
            shutil.copyfileobj(src, process.stdin)
    process.stdin.flush()
    initial = None
    last_verified = None
    expected = {'before'}
    while line := process.stdout.readline(512):
        msg = json.loads(line)
        phase, source, namespace = msg
        if phase not in expected or not SHA.fullmatch(source) or not NAMESPACE.fullmatch(namespace):
            raise ValueError('Invalid host response')
        if phase == 'before':
            initial = (source, namespace)
        elif (source, namespace) != ((sha, 'release-'+sha) if phase in ('candidate', 'live') else initial):
            raise ValueError('Unexpected release in host response')
        try:
            probe(source, namespace)
        except Exception as error:
            print(f'Public {phase} probe failed: {error}', file=sys.stderr)
            reply = b'no\n'
            last_verified = None
            expected = {'restoration'} if phase in ('candidate', 'live') else set()
        else:
            reply = b'yes\n'
            last_verified = phase
            expected = AFTER_PUBLIC_ACK[phase]
        process.stdin.write(reply)
        process.stdin.flush()
    status = process.wait()
    if status == 0 and last_verified == 'live':
        return
    if status == 20 and last_verified == 'restored-live':
        raise Restored('Deployment failed; the retained pair was restored and verified publicly')
    raise RuntimeError(f'Deployment incomplete (SSH exit {status}); inspect host journal before any write')


def ed25519_blob(key):
    if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,2}', key):
        raise ValueError('Expected one independently pinned Ed25519 host key')
    blob = base64.b64decode(key.split()[1], validate=True)
    if len(blob) != 51 or not blob.startswith(b'\0\0\0\x0bssh-ed25519\0\0\0\x20'):
        raise ValueError('Invalid Ed25519 public key')
    return blob


def main():
    phase = 'not-sent'
    try:
        address = str(ipaddress.ip_address(os.environ['ECS_ADDRESS']))
        host_key = os.environ['SSH_HOST_KEY']
        ed25519_blob(host_key)
        bundle = Path(os.environ['BUNDLE'])
        archive = Path(os.environ['RUNNER_TEMP'])/'zimage-pair/pair.tar'
        with tempfile.TemporaryDirectory() as tmp:
            key = Path(tmp)/'identity'
            key.touch(mode=0o600, exist_ok=False)
            key.write_bytes((os.environ.pop('SSH_KEY').strip()+'\n').encode('ascii'))
            env = {'PATH': '/usr/bin:/bin', 'SSH_ASKPASS_REQUIRE': 'never'}
            public = subprocess.check_output(['/usr/bin/ssh-keygen', '-y', '-f', str(key)], env=env,
                                             stdin=subprocess.DEVNULL, text=True, timeout=5)
            blob = ed25519_blob(' '.join(public.split()[:2]))
            if 'SHA256:'+base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=') != CLIENT_FINGERPRINT:
                raise ValueError('Release client fingerprint mismatch')
            hosts = Path(tmp)/'hosts'
            hosts.write_text('zimage-production '+host_key+'\n')
            args = ['/usr/bin/ssh', '-F', '/dev/null', '-T', '-i', str(key), '-o', 'IdentitiesOnly=yes',
                    '-o', 'IdentityAgent=none', '-o', 'PreferredAuthentications=publickey', '-o', 'ForwardAgent=no',
                    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=zimage-production',
                    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UserKnownHostsFile='+str(hosts),
                    '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'UpdateHostKeys=no', '-o', 'ConnectionAttempts=1',
                    '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=20',
                    '-o', 'ServerAliveCountMax=3', '--', 'zimage-release@'+address]
            with subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env) as process:
                phase = 'unconfirmed'
                deliver(process, os.environ['GITHUB_SHA'], archive, bundle)
                phase = 'committed'
    except Restored as error:
        phase = 'restored'
        print(error, file=sys.stderr)
    except Exception as error:
        print(error, file=sys.stderr)
    if output := os.environ.get('GITHUB_OUTPUT'):
        with open(output, 'a') as out:
            print('phase='+phase, file=out)
    return {'committed': 0, 'restored': 20, 'unconfirmed': 21, 'not-sent': 1}[phase]


if __name__ == '__main__':
    sys.exit(main())
