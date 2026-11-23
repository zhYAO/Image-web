"""A single noninteractive SSH session. A lost connection never triggers a write retry."""
import json
import os
from pathlib import Path
import ipaddress
import re
import shutil
import subprocess
import sys
import tempfile

from check import SHA, NAMESPACE, probe


def deliver(process, sha, archive, bundle):
    header = f'{sha} {bundle.stat().st_size} {archive.stat().st_size}\n'.encode()
    process.stdin.write(header)
    for file in (bundle, archive):
        with file.open('rb') as src:
            shutil.copyfileobj(src, process.stdin)
    process.stdin.flush()
    initial = None
    accepted = []
    while line := process.stdout.readline(512):
        msg = json.loads(line)
        phase, source, namespace = msg
        if not SHA.fullmatch(source) or not NAMESPACE.fullmatch(namespace):
            raise ValueError('Invalid host response')
        if phase == 'before' and initial is None:
            initial = (source, namespace)
        elif phase in ('candidate','live') and initial and (source, namespace) == (sha, 'release-'+sha):
            pass
        elif phase in ('restoration','restored-live') and initial == (source, namespace):
            pass
        else:
            raise ValueError('Unexpected host response')
        try:
            probe(source, namespace)
        except Exception as error:
            print(f'Public {phase} probe failed: {error}', file=sys.stderr)
            reply = b'no\n'
        else:
            accepted.append(phase)
            reply = b'yes\n'
        process.stdin.write(reply)
        process.stdin.flush()
    status = process.wait()
    if status == 0 and accepted == ['before', 'candidate', 'live']:
        return
    if status == 20 and initial and accepted[-2:] == ['restoration','restored-live']:
        raise RuntimeError('Deployment failed; the retained pair was restored and verified publicly')
    raise RuntimeError(f'Deployment incomplete (SSH exit {status}); inspect host journal before any write')


def main():
    address = str(ipaddress.ip_address(os.environ['ECS_ADDRESS']))
    host_key = os.environ['SSH_HOST_KEY']
    if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,2}', host_key):
        raise ValueError('Expected one independently pinned Ed25519 host key')
    bundle = Path(os.environ['BUNDLE'])
    archive = Path(os.environ['RUNNER_TEMP'])/'zimage-pair/pair.tar'
    with tempfile.TemporaryDirectory() as tmp:
        key = Path(tmp)/'identity'
        key.touch(mode=0o600)
        key.write_text(os.environ.pop('SSH_KEY').strip()+'\n')
        hosts = Path(tmp)/'hosts'
        hosts.write_text('zimage-production '+host_key+'\n')
        args = ['ssh', '-F', '/dev/null', '-T', '-i', str(key), '-o', 'IdentitiesOnly=yes',
                '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=zimage-production',
                '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UserKnownHostsFile='+str(hosts),
                '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=20',
                '-o', 'ServerAliveCountMax=3', 'zimage-release@'+address]
        with subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
            deliver(process, os.environ['GITHUB_SHA'], archive, bundle)


if __name__ == '__main__':
    main()
