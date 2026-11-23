import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from github_shadow_measure_report import BASELINE, LEDGER, NETWORK, SCOPE
import github_shadow_measure_run as wrap


class WrapperTest(unittest.TestCase):
    def test_actual_unprotected_is_rejected_before_any_io(self):
        # None paths prove trusted process context is checked first.
        for key, value in [('GITHUB_REF_PROTECTED', 'false'), ('GITHUB_REF', 'refs/heads/other'),
                           ('GITHUB_WORKFLOW_REF', 'forged'), ('GITHUB_EVENT_NAME', 'workflow_dispatch')]:
            env = dict(wrap.BASE_ENV, GITHUB_SHA='a'*40, GITHUB_RUN_ID='5', GITHUB_RUN_ATTEMPT='1')
            env[key]=value
            with patch.object(wrap, 'private') as filesystem, self.assertRaises(ValueError):
                wrap.run(packet=None, trusted_root=None, scratch=None, cache=None, env=env,
                    backend='a'*64,frontend='b'*64,sidecar=None,sidecar_sha256='c'*64,
                    runtime_identity=None,corepack_home=None)
            filesystem.assert_not_called()

    def test_frozen_inputs_real_report_and_cleanup_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            packet,scratch,cache = [root/n for n in ('packet','scratch','cache')]
            for p in (packet,scratch,cache):
                p.mkdir(0o700)
            hashes={}
            for n in wrap.LIMITS:
                q=packet/n; q.write_bytes(n.encode()); q.chmod(0o600)
                hashes[n]=hashlib.sha256(n.encode()).hexdigest()
            env=dict(wrap.BASE_ENV,GITHUB_SHA='a'*40,GITHUB_RUN_ID='5',GITHUB_RUN_ATTEMPT='1')
            backend,frontend=hashes['backend.zip'],hashes['frontend.zip']
            sidecar=scratch/'frozen'
            pinned=wrap.freeze(packet,sidecar,env,backend,frontend)
            kw=dict(packet=packet,trusted_root=root,scratch=scratch,cache=cache,env=env,backend=backend,
                frontend=frontend,sidecar=sidecar,sidecar_sha256=pinned,
                runtime_identity=lambda *_:True,corepack_home=root/'corepack')
            evidence=dict(commit=env['GITHUB_SHA'],dbProfile='m6-diagnostics-no-m7',
                migrationCount=43,migrationLedgerSha256=LEDGER,scope=SCOPE,browserUiTested=True,
                productionReady=False,credentialMode='synthetic',reconstructedIsolatedPairRecovery=True,
                reconstructedCommit=BASELINE,checks=['candidate-health','browser-home-login-workspace-logout'])
            complete=False
            def child(argv, **kwargs):
                self.assertIn('/usr/sbin',kwargs['env']['PATH'])
                output=b''
                if argv[0]=='/bin/bash':
                    lines=[NETWORK]
                    if complete: lines.append('Protected host teardown verified.')
                    output=('\n'.join(lines+[json.dumps(evidence)])+'\n').encode()
                return subprocess.CompletedProcess(argv,0,output)
            with patch.object(wrap,'bounded',side_effect=child) as invoked:
                with self.assertRaises(ValueError):
                    wrap.run(**kw)
                self.assertFalse((scratch/'stage-report.json').exists())
                complete=True
                out=wrap.run(**kw)
                self.assertEqual(out.stat().st_mode & 0o777,0o400)
                self.assertIs(json.loads(out.read_bytes())['productionReady'],False)
                out.unlink()
                with self.assertRaises(ValueError):
                    wrap.run(**dict(kw,sidecar_sha256='0'*64))
                (packet/'config.json').write_text('tampered')
                with self.assertRaises(ValueError):
                    wrap.run(**kw)
                self.assertEqual(invoked.call_count,4)
