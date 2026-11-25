"""Run the inline dispatch step with isolated key fixtures and no network."""
import os
import re
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

WORKFLOW = Path(__file__).resolve().parents[3] / '.github/workflows/production-ssh-identity.yml'
STUB = r'''#!/usr/bin/python3 -IB
import os, signal, sys
from pathlib import Path
root = Path(os.environ['FIXTURE'])
mode = os.environ['CASE']
name = Path(sys.argv[0]).name
args = sys.argv[1:]
assert 'RELEASE_KEY' not in os.environ
with (root/'calls').open('a') as f: print(name, *args, file=f)
sock = Path(os.environ['SSH_AUTH_SOCK'])
(root/'workdir').write_text(str(sock.parent))
if name == 'ssh-agent':
    assert args == ['-D', '-a', str(sock), '-t', '60']
    (root/'pid').write_text(str(os.getpid()))
    signal.pause()
elif name == 'ssh-add':
    if args == ['-l']:
        sys.exit(1 if (root/'pid').exists() else 2)
    if args == ['-t','60','-']:
        assert sys.stdin.buffer.read().rstrip() == (root/'client').read_bytes().rstrip()
    elif args == ['-L']:
        print((root/'client.pub').read_text().strip())
    else: sys.exit(3)
elif name == 'ssh':
    assert args[-2:] == ['--', 'zimage-release@192.0.2.10']
    if args[0] == '-G':
        import subprocess
        if mode == 'invalid-option':
            args[1:1] = ['-o', 'NoSuchSSHProbeOption=yes']
        sys.exit(subprocess.run(['/usr/bin/ssh', *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode)
    if '-O' in args:
        op = args[args.index('-O')+1]
        assert op in ('check', 'exit')
        sys.exit(int((mode == 'bad-mux' and op == 'check') or (mode == 'bad-exit' and op == 'exit')))
    assert '-fNTnM' in args
    assert 'IdentityAgent='+str(sock) in args
    public = sock.parent/'identity.pub'
    assert args[args.index('-i')+1] == str(public)
    assert public.read_text().split() == (root/'client.pub').read_text().split()[:2]
    assert (sock.parent/'hosts').read_text().split() == ['zimage-production', *(root/'host.pub').read_text().split()[:2]]
    # The real client expands these exact arguments offline. -G never connects.
    import subprocess
    cfg = subprocess.check_output(['/usr/bin/ssh','-G',*args[args.index('-F'):]], text=True, stderr=subprocess.DEVNULL)
    for item in ('sessiontype none','requesttty false','clearallforwardings yes','forwardagent no'):
        assert item in cfg.splitlines(), item
    assert 'port 22' in cfg.splitlines()
    assert len(os.fsencode(args[args.index('-S')+1])) + 17 < 108
    log = sock.parent/'ssh.log'
    if mode == 'no-log':
        sys.exit(255)
    sep = '\n' if mode == 'signed-lf' else '\r\n'
    def finish(lines, rc=255):
        log.write_bytes((sep.join(lines) + sep).encode())
        sys.exit(rc)
    if mode == 'refused':
        finish(['ssh: connect to host 192.0.2.10 port 22: Connection refused'])
    if mode == 'timeout':
        finish(['ssh: connect to host 192.0.2.10 port 22: Connection timed out'])
    if mode == 'deadline':
        finish(['debug1: Connecting to fixture.'], 124)
    lines = ['debug1: Connection established.']
    if mode == 'no-banner':
        finish(lines)
    lines.append('debug1: Remote protocol version 2.0, remote software version DO-NOT-PRINT-ME')
    if mode == 'bad-pin':
        finish(lines + ['Host key verification failed.'])
    if mode == 'no-algorithm':
        finish(lines + ['Unable to negotiate with 192.0.2.10 port 22: no matching host key type found.'])
    if mode != 'wrong-alias':
        lines.append("debug1: Host 'zimage-production' is known and matches the ED25519 host key.")
    if mode == 'bad-kex':
        finish(lines)
    lines.append('debug1: SSH2_MSG_NEWKEYS received')
    if mode == 'no-service':
        finish(lines)
    lines.append('debug1: SSH2_MSG_SERVICE_ACCEPT received')
    if mode != 'key-denied':
        lines.append('debug1: Server accepts key: '+str(public)+' ED25519 '+os.environ['EXPECTED_KEY_SHA256']+' explicit agent')
    if mode not in ('bad-signature','key-denied'):
        lines.append('Authenticated to fixture ([192.0.2.10]:22) using "publickey".')
    finish(lines, 255 if mode in ('bad-signature','key-denied','bad-start') else 0)
else: sys.exit(3)
'''

class SSHIdentity(unittest.TestCase):
    def test_isolated_workflow(self):
        yaml = WORKFLOW.read_text()
        self.assertIn('on:\n  workflow_dispatch:\npermissions: {}\n', yaml)
        self.assertIn('    environment: production\n', yaml)
        self.assertIn("github.ref == 'refs/heads/main' && github.ref_protected", yaml)
        self.assertEqual(yaml.count('secrets.'), 1)
        self.assertNotRegex(yaml, r'\b(?:uses|inputs):|pull_request|send\.py|ssh-keyscan')
        self.assertIn("EXPECTED_KEY_SHA256: 'SHA256:2KEGjp7U/rFuYaMGzq9WKQKv61ZDvbVKJSc1kqG+AyE'", yaml)

    def test_step(self):
        step = textwrap.dedent(WORKFLOW.read_text().split('        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('client','host'):
                subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-f',str(root/name)], check=True)
            for name in ('ssh-agent','ssh-add','ssh'):
                p = root/name
                p.write_text(STUB)
                p.chmod(0o700)
                # Replace exact binary names only, leaving ssh-keygen and other tools real.
                step = re.sub(r'/usr/bin/'+name+r'(?![-\w])', str(p), step)
            script = root/'step.sh'
            script.write_text(step)
            fingerprint = subprocess.check_output(['/usr/bin/ssh-keygen','-E','sha256','-lf',str(root/'client.pub')], text=True).split()[1]
            pub = ' '.join((root/'host.pub').read_text().split()[:2])
            env = dict(PATH='/usr/bin:/bin', GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_REPOSITORY='zhYAO/Image-web',
                       GITHUB_REF='refs/heads/main', GITHUB_REF_PROTECTED='true', ECS_ADDRESS='192.0.2.10',
                       HOST_KEY='192.0.2.10 '+pub, RELEASE_KEY=(root/'client').read_text(), EXPECTED_KEY_SHA256=fingerprint,
                       FIXTURE=tmp, SSH_AUTH_SOCK='/unrelated-agent')
            cases = [
                ('wrong-ref', {'GITHUB_REF':'refs/heads/topic'}, 'Refused event or ref', False),
                ('not-manual', {'GITHUB_EVENT_NAME':'push'}, 'Refused event or ref', False),
                ('missing', {'RELEASE_KEY':''}, 'release-secret=missing', False),
                ('wrong-client', {'EXPECTED_KEY_SHA256':'SHA256:'+'A'*43}, 'client-fingerprint=mismatch', False),
                ('wrong-name', {'HOST_KEY':'other.example '+pub}, 'different endpoint', False),
                ('invalid-option', {}, 'client-options=rejected', False),
                ('no-log', {}, 'ssh-log=missing', True),
                ('refused', {}, 'tcp=refused', True),
                ('timeout', {}, 'tcp=timeout', True),
                ('deadline', {}, 'tcp=unconfirmed deadline=expired', True),
                ('no-algorithm', {}, 'negotiation=no-common-algorithm', True),
                ('no-banner', {}, 'ssh-banner=unconfirmed', True),
                ('bad-pin', {}, 'pinned-host=rejected', True),
                ('wrong-alias', {}, 'pinned-host=unverified', True),
                ('bad-kex', {}, 'key-exchange=unconfirmed', True),
                ('no-service', {}, 'auth-service=unconfirmed', True),
                ('bad-start', {}, 'master-start=failed', True),
                ('signed-lf', {}, 'signed-publickey-auth=verified', True),
                ('key-denied', {}, 'release-public-key=unconfirmed', True),
                ('bad-signature', {}, 'signed-publickey-auth=unconfirmed', True),
                ('bad-mux', {}, 'master-check=failed', True),
                ('bad-exit', {}, 'master-exit=failed', True),
                ('signed', {}, 'signed-publickey-auth=verified', True),
                ('signed-raw-pin', {'HOST_KEY':pub}, 'signed-publickey-auth=verified', True)]
            for case, change, message, connects in cases:
                with self.subTest(case=case):
                    for name in ('calls','workdir','pid'):
                        (root/name).unlink(missing_ok=True)
                    run = subprocess.run(['/bin/bash','--noprofile','--norc',str(script)],
                                         env=env | change | {'CASE':case}, capture_output=True, text=True, timeout=12)
                    output = run.stdout+run.stderr
                    self.assertIn(message, output)
                    ok = case.startswith('signed')
                    self.assertEqual(run.returncode == 0, ok)
                    self.assertEqual('signed-publickey-auth=verified' in output, ok)
                    self.assertNotIn(env['RELEASE_KEY'].strip(), output)
                    calls = (root/'calls').read_text() if (root/'calls').exists() else ''
                    self.assertEqual(calls.count('ssh -vv -E '), int(connects))
                    self.assertNotIn('DO-NOT-PRINT-ME', output)
                    if ok:
                        self.assertIn(' -O check -- ', calls)
                        self.assertIn(' -O exit -- ', calls)
                    if (root/'workdir').exists():
                        self.assertFalse(Path((root/'workdir').read_text()).exists())
                    if (root/'pid').exists():
                        with self.assertRaises(ProcessLookupError):
                            os.kill(int((root/'pid').read_text()), 0)
