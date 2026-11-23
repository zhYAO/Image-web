"""Portable real pack/unpack fixtures; no service, account or live acceptance."""
import copy
from contextlib import redirect_stdout
import io
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('images_manifest', HERE / 'manifest.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
POLICY = json.loads((HERE.parent / 'public-images.json').read_text(encoding='utf-8'))
BASE = 'https://www.zimage.store/static-assets/6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24'
CONTRACT = {'schema': 1, 'baseUrl': BASE, 'manifestSha256': BASE.rsplit('/', 1)[1], 'files': POLICY['files']}


class PublicImages(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='zimage-image-contract-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.dist = self.root / 'dist'
        (self.dist / '.release').mkdir(parents=True)
        self.config = {'schemaVersion': 1, 'formalAuth': True, 'dataMode': 'http', 'captchaSiteKey': None, 'approvedLegalVersion': None, 'registrationEnabled': False}
        self.options = {'assetNamespace': 'images-fixture', 'sourceSHA': 'a' * 40, 'treeFingerprint': 'b' * 64,
                        'build': {'toolchainFingerprint': 'c' * 64, 'lockfileSha256': 'd' * 64},
                        'apiRequirements': {'major': 1, 'minMinor': 0, 'capabilities': []}, 'verifiedBackendReleases': ['offline']}
        self.candidate = {'schemaVersion': 1, 'namespace': 'images-fixture', 'apiRequirements': self.options['apiRequirements'],
                          'allowedBackendReleases': ['offline'], 'sourceIdentity': {'sourceSHA': 'a' * 40, 'treeFingerprint': 'b' * 64, 'lockfileSha256': 'd' * 64, 'dirty': False},
                          'buildToolchainFingerprint': 'c' * 64}
        (self.dist / '.release/candidate.json').write_bytes(m.canonical(self.candidate))
        (self.dist / 'index.html').write_text('<h1>Offline fixture</h1>', encoding='utf-8')

    def external(self):
        (self.dist / m.IMAGE_METADATA).write_bytes(m.canonical(CONTRACT))
        (self.dist / 'index.html').write_text(''.join('<img src="' + BASE + '/' + item['path'] + '">' for item in POLICY['files']), encoding='utf-8')

    def subject(self):
        return m.candidate_files(self.dist, self.config)[2]

    def pack(self):
        evidence = dict(self.subject(), backendReleases=[{'backendRelease': 'offline', 'acceptanceSha256': 'e' * 64}])
        return m.pack(self.dist, self.root / 'fixture.tgz', self.options, self.config, evidence)

    def test_legacy_pack_and_verify_identity_unchanged(self):
        subject = self.subject()
        self.assertEqual(subject['publicConfigFingerprint'], m.digest(m.canonical(self.config)))
        report = self.pack()
        self.assertEqual(m.unpack(report['archive'], self.root / 'out', report['manifestSha256'])['schemaVersion'], 1)

    def test_all62_subject_cli_pack_unpack_verify_same_bound_contract(self):
        self.external()
        subject = self.subject()
        self.assertNotEqual(subject['publicConfigFingerprint'], m.digest(m.canonical(self.config)))
        config = self.root / 'config.json'
        config.write_bytes(m.canonical(self.config))
        arguments = ['--dist', str(self.dist), '--public-config', str(config), '--subject-only']
        if os.name == 'nt':
            cli_spec = importlib.util.spec_from_file_location('image_pack_cli', HERE / 'pack.py')
            cli = importlib.util.module_from_spec(cli_spec)
            cli_spec.loader.exec_module(cli)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(cli.main(arguments), 0)
            result = output.getvalue()
        else:
            process = subprocess.run([sys.executable, '-I', '-B', str(HERE / 'pack.py'), *arguments], capture_output=True)
            self.assertEqual(process.returncode, 0, process.stderr)
            result = process.stdout
        self.assertEqual(json.loads(result)['payloadIndexSha256'], subject['payloadIndexSha256'])
        report = self.pack()
        value = m.unpack(report['archive'], self.root / 'out', report['manifestSha256'])
        self.assertEqual(value['build']['publicConfigFingerprint'], subject['publicConfigFingerprint'])
        self.assertEqual(m.verify(self.root / 'out', report['manifestSha256']), value)

    def test_missing_or_preview_contract_cannot_admit_remote_images(self):
        self.external()
        (self.dist / m.IMAGE_METADATA).unlink()
        with self.assertRaisesRegex(ValueError, 'External'): self.subject()
        (self.dist / '.release/external-images.json').write_text('{}')
        with self.assertRaises(ValueError): self.subject()

    def test_foreign_unknown_query_case_and_nonimage_remote_resources_fail(self):
        self.external()
        for url in [BASE + '/commerce/unlisted.webp', BASE + '/' + POLICY['files'][0]['path'] + '?x=1', BASE.replace('www.zimage.store', 'other.test') + '/x.webp', '//www.zimage.store/x.webp', 'https://other.test/code.js', BASE + '/fonts/a.otf']:
            with self.subTest(urlKind=url.rsplit('/', 1)[-1]):
                (self.dist / 'index.html').write_text('<img src="' + url + '">', encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'External'): self.subject()

    def test_hash_path_origin_extra_field_and_version_mismatch_fail(self):
        self.external()
        for field in ['hash', 'path', 'origin', 'extra', 'version', 'order']:
            value = copy.deepcopy(CONTRACT)
            if field == 'hash': value['files'][0]['sha256'] = '0' * 64
            if field == 'path': value['files'][0]['path'] = 'commerce/unlisted.webp'
            if field == 'origin': value['baseUrl'] = BASE.replace('www.zimage.store', 'other.test')
            if field == 'extra': value['approved'] = True
            if field == 'version': value['manifestSha256'] = '0' * 64
            if field == 'order': value['files'].reverse()
            (self.dist / m.IMAGE_METADATA).write_bytes(m.canonical(value))
            with self.subTest(field=field), self.assertRaises(ValueError): self.subject()

    def test_renamed_image_copy_rejected_and_acceptance_cannot_cross_config(self):
        self.external()
        evidence = dict(self.subject(), backendReleases=[{'backendRelease': 'offline', 'acceptanceSha256': 'e' * 64}])
        original = HERE.parents[2] / 'apps/web/public' / POLICY['files'][0]['path']
        (self.dist / 'renamed.webp').write_bytes(original.read_bytes())
        with self.assertRaisesRegex(ValueError, 'copied'): self.subject()
        (self.dist / 'renamed.webp').unlink()
        self.config['captchaSiteKey'] = 'offline-public-fixture'
        with self.assertRaisesRegex(ValueError, 'acceptance'): m.pack(self.dist, self.root / 'bad.tgz', self.options, self.config, evidence)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--closure-fixture':
        # Shared JS/Python fixture oracle. No production entry point or bypass.
        config = {'schemaVersion': 1, 'formalAuth': True, 'dataMode': 'http', 'captchaSiteKey': None, 'approvedLegalVersion': None, 'registrationEnabled': False}
        try:
            m.candidate_files(Path(sys.argv[2]), config)
            print('accepted')
        except ValueError:
            print('rejected')
    else:
        unittest.main()
