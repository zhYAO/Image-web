"""Actual CLI round-trip against an existing commit, no new commits/network."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
spec = importlib.util.spec_from_file_location('pack_cli_manifest', HERE / 'manifest.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PackagingCliTests(unittest.TestCase):
    def test_locked_node_packages_and_reverifies_real_archive_with_sidecars(self):
        node = os.environ.get('ZIMAGE_TEST_NODE', shutil.which('node'))
        if not node or subprocess.check_output([node, '--version'], text=True).strip() != 'v24.19.0':
            self.skipTest('Set ZIMAGE_TEST_NODE to existing locked Node 24.19.0; never installs runtimes')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            clean = root / 'clean-source'
            env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
            def git(*args):
                result = subprocess.run(['git', *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                return result.stdout
            # Read-only local object sharing; no fetch, account, commit or root
            # repository mutation. Sparse checkout avoids copying the app tree.
            git('clone', '--shared', '--no-checkout', str(PROJECT), str(clean))
            git('-C', str(clean), 'config', 'core.sparseCheckout', 'true')
            (clean / '.git/info/sparse-checkout').write_text('/package.json\n/pnpm-lock.yaml\n')
            git('-C', str(clean), 'checkout', '--force', 'HEAD')
            self.assertEqual(git('-C', str(clean), 'status', '--porcelain'), b'')
            dist = root / 'dist'
            (dist / 'assets').mkdir(parents=True)
            (dist / '.release').mkdir()
            (dist / 'index.html').write_text('<h1>Fixture only</h1><script type="module" src="/frontend-assets/fixture-only/assets/main.js"></script>')
            (dist / 'assets/main.js').write_text('import("./lazy.js");')
            (dist / 'assets/lazy.js').write_text('export const fixture=true;')
            candidate = {'schemaVersion': 1, 'namespace': 'fixture-only', 'apiRequirements': {'major': 1, 'minMinor': 0, 'capabilities': []}, 'allowedBackendReleases': ['fixture-backend']}
            candidate['sourceIdentity'] = {'sourceSHA': git('-C', str(clean), 'rev-parse', 'HEAD').strip().decode(),
                                           'treeFingerprint': m.digest(git('-C', str(clean), 'ls-tree', '-r', '--full-tree', 'HEAD')),
                                           'lockfileSha256': m.digest((clean / 'pnpm-lock.yaml').read_bytes()), 'dirty': False}
            candidate['buildToolchainFingerprint'] = m.digest(m.canonical({'node': '24.19.0', 'packageManager': 'pnpm@11.19.0'}))
            (dist / '.release/candidate.json').write_bytes(m.canonical(candidate))
            public = {'schemaVersion': 1, 'formalAuth': True, 'dataMode': 'http', 'captchaSiteKey': None, 'approvedLegalVersion': None, 'registrationEnabled': False}
            config_path = root / 'public.json'
            config_path.write_bytes(m.canonical(public))
            _, _, subject = m.candidate_files(dist, public)
            evidence = dict(subject, backendReleases=[{'backendRelease': 'fixture-backend', 'acceptanceSha256': 'e' * 64}])
            evidence_path = root / 'fixture-evidence.json'
            evidence_path.write_bytes(m.canonical(evidence))
            options = {'assetNamespace': candidate['namespace'], 'sourceSHA': git('-C', str(clean), 'rev-parse', 'HEAD').strip().decode(),
                       'treeFingerprint': m.digest(git('-C', str(clean), 'ls-tree', '-r', '--full-tree', 'HEAD')),
                       'build': {'toolchainFingerprint': m.digest(m.canonical({'node': '24.19.0', 'packageManager': 'pnpm@11.19.0'})),
                                 'lockfileSha256': m.digest((clean / 'pnpm-lock.yaml').read_bytes())},
                       'apiRequirements': candidate['apiRequirements'], 'verifiedBackendReleases': ['fixture-backend']}
            options_path = root / 'options.json'
            options_path.write_bytes(m.canonical(options))
            result = subprocess.run([node, str(HERE / 'package.mjs'), '--dist', str(dist), '--output', str(root / 'artifact.tgz'),
                                     '--options', str(options_path), '--public-config', str(config_path), '--evidence', str(evidence_path), '--project', str(clean)],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(hashlib.sha256(Path(report['archive']).read_bytes()).hexdigest(), report['archiveSha256'])
            self.assertEqual(hashlib.sha256(Path(report['manifestPath']).read_bytes()).hexdigest(), report['manifestSha256'])
            self.assertFalse(report['productionReady'])
            approval = json.loads(Path(report['approvalRequestPath']).read_text())
            self.assertEqual(approval['artifactId'], report['artifactId'])
            self.assertEqual(approval['backendReleases'][0]['backendRelease'], 'fixture-backend')
            self.assertFalse((dist / '.release/manifest.json').exists())
            request_result = subprocess.run([node, str(HERE / 'transport.mjs'), 'request', '--archive', report['archive'], '--manifest-sha256', report['manifestSha256']],
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(request_result.returncode, 0, request_result.stderr)
            request = json.loads(request_result.stdout)
            inventory = root / 'inventory.json'
            # Deliberately advisory hints; the publisher tests separately prove
            # these cannot authorize missing or corrupted server cache objects.
            inventory.write_bytes(m.canonical(dict(request, found=request['objects'])))
            bundle_result = subprocess.run([node, str(HERE / 'transport.mjs'), 'bundle', '--archive', report['archive'], '--manifest-sha256', report['manifestSha256'],
                                            '--inventory', str(inventory), '--output', str(root / 'delta.tgz')],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(bundle_result.returncode, 0, bundle_result.stderr)
            delta = json.loads(bundle_result.stdout)
            self.assertEqual(delta['uploadBlobBytes'], 0)
            self.assertEqual(delta['reusedBlobCount'], len(request['objects']))
            self.assertEqual(hashlib.sha256(Path(delta['archive']).read_bytes()).hexdigest(), delta['archiveSha256'])
            # A dirty source is refused before a second archive is created.
            (clean / 'untracked-secret.env').write_text('fixture only')
            command = [node, str(HERE / 'package.mjs'), '--dist', str(dist), '--output', str(root / 'dirty.tgz'),
                       '--options', str(options_path), '--public-config', str(config_path), '--evidence', str(evidence_path), '--project', str(clean)]
            rejected = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn('clean', rejected.stderr)
            self.assertFalse((root / 'dirty.tgz').exists())


if __name__ == '__main__': unittest.main()
