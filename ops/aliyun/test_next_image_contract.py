"""Synthetic metadata/real archive tests. Never claims a Linux Next build."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
from unittest.mock import patch
import unittest

from test_three_layer_release import PortableFixture

HERE = Path(__file__).resolve().parent
POLICY = json.loads((HERE / 'public-images.json').read_text(encoding='utf-8'))
BASE = 'https://www.zimage.store/static-assets/6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24'
CONTRACT = {'schema': 1, 'baseUrl': BASE, 'manifestSha256': BASE.rsplit('/', 1)[1], 'files': POLICY['files']}


class NextImages(PortableFixture):
    def setUp(self):
        super().setUp()
        self.legacy_config, self.legacy_assets = copy.deepcopy(self.config), self.assets
        for name in self.m.config_sources(3):
            if not (self.project / name).exists(): self.put(self.project / name, 'reviewed source fixture')
        self.config['env'].update(ZIMAGE_PUBLIC_IMAGE_BASE_URL=BASE, ZIMAGE_PUBLIC_IMAGE_CONTRACT=json.dumps(CONTRACT))
        self.config['images'] = {'remotePatterns': [{'protocol': 'https', 'hostname': 'www.zimage.store', 'port': '',
            'pathname': '/static-assets/' + CONTRACT['manifestSha256'] + '/commerce/**', 'search': ''}]}
        self.set_config()
        metadata = self.m.parse((self.assets / 'asset-manifest.json').read_bytes())
        metadata['files'] = [entry for entry in metadata['files'] if entry['kind'] == 'font']
        metadata['publicImages'] = copy.deepcopy(CONTRACT)
        self.new_assets(metadata)

    def new_assets(self, metadata):
        body = self.m.canonical(metadata)
        self.assets = self.root / 'resources' / self.m.digest(body)
        for entry in metadata['files']:
            self.put(self.assets / entry['path'], (self.legacy_assets / entry['path']).read_bytes())
        self.put(self.assets / 'asset-manifest.json', body)

    def new_pack(self, **kwargs):
        return self.pack(schema=3, asset_delivery_mode='public-images', **kwargs)

    def test_schema3_binds_distinct_image_resource_and_config_identities_and_keeps_fonts(self):
        report = self.new_pack()
        manifest = self.m.parse(Path(report['manifest']).read_bytes())
        self.m.validate_manifest(manifest)
        self.assertEqual(manifest['publicImages'], CONTRACT)
        self.assertNotEqual(manifest['assetsVersion'], CONTRACT['manifestSha256'])
        self.assertEqual(manifest['compiledAssetBaseUrl'], BASE)
        self.assertEqual(manifest['runtimeBinding']['schema'], 3)
        self.assertEqual(manifest['configFingerprint']['publicImages'], CONTRACT)
        self.assertEqual(manifest['generatedPublicLink']['target'], '/opt/zimage/layer-cache/assets/' + manifest['assetsVersion'])
        self.assertEqual(self.m.layer_binding(manifest, 'code')['publicImageContractSha256'], self.m.digest(self.m.canonical(CONTRACT)))
        entries, _ = self.m.resource_entries((self.assets / 'asset-manifest.json').read_bytes())
        self.assertEqual({entry['path'] for entry in entries}, self.m.FONT_FILES)
        for entry in entries: self.assertEqual((self.assets / entry['path']).read_bytes(), (self.legacy_assets / entry['path']).read_bytes())

    def test_compiled_base_pattern_policy_and_legacy_conflicts_fail_before_output(self):
        original = copy.deepcopy(self.config)
        for kind in ['base', 'pattern', 'policy', 'legacy', 'missing']:
            self.config = copy.deepcopy(original)
            if kind == 'base': self.config['env']['ZIMAGE_PUBLIC_IMAGE_BASE_URL'] = BASE + '/'
            if kind == 'pattern': self.config['images']['remotePatterns'][0]['search'] = '?x=1'
            if kind == 'policy':
                changed = copy.deepcopy(CONTRACT); changed['files'][0]['sha256'] = '0' * 64
                self.config['env']['ZIMAGE_PUBLIC_IMAGE_CONTRACT'] = json.dumps(changed)
            if kind == 'legacy': self.config['env']['NEXT_PUBLIC_STATIC_ASSET_BASE_URL'] = 'https://other.test/static-assets/' + '0' * 64
            if kind == 'missing': self.config['env'].pop('ZIMAGE_PUBLIC_IMAGE_CONTRACT')
            self.set_config()
            with self.subTest(kind=kind), self.assertRaises(ValueError): self.new_pack()
            self.assertFalse(self.store.exists())

    def test_schema2_cannot_silently_consume_schema3_or_new_resource_metadata(self):
        with self.assertRaisesRegex(ValueError, 'schema 3'): self.pack()
        self.config = self.legacy_config; self.set_config()
        with self.assertRaisesRegex(ValueError, 'schema 3'): self.pack()

    def test_asset_marker_mismatch_and_renamed_copy_are_rejected(self):
        metadata = self.m.parse((self.assets / 'asset-manifest.json').read_bytes())
        metadata['publicImages']['files'][0]['sha256'] = '0' * 64
        self.new_assets(metadata)
        with self.assertRaisesRegex(ValueError, 'identities differ'): self.new_pack()
        metadata['publicImages'] = copy.deepcopy(CONTRACT); self.new_assets(metadata)
        self.put(self.source / 'node_modules/renamed.webp', (HERE.parents[1] / 'apps/web/public' / POLICY['files'][0]['path']).read_bytes())
        with self.assertRaisesRegex(ValueError, 'copied'): self.new_pack()

    def test_layer_binding_rejects_changed_image_identity(self):
        report = self.new_pack()
        manifest = self.m.parse(Path(report['manifest']).read_bytes())
        changed = copy.deepcopy(manifest)
        changed['publicImages']['files'][0]['sha256'] = '0' * 64
        with self.assertRaises(ValueError): self.m.validate_manifest(changed)
        changed = copy.deepcopy(manifest); changed['configFingerprint']['publicImages'] = None
        with self.assertRaises(ValueError): self.m.validate_manifest(changed)

    def model_only(self):
        self.config['env'].update(ZIMAGE_IMAGE_ENGINE='jsquash', ZIMAGE_APPAREL_TEXT_MODE='model-only')
        self.config['images']['unoptimized'] = True
        self.set_config()
        return { 'schema': 2, 'productionReady': False, 'runtimeProfile': self.m.MODEL_ONLY_PROFILE,
                 'publicImages': copy.deepcopy(CONTRACT), 'files': [] }

    def test_schema3_model_only_requires_and_binds_fontless_assets(self):
        fontless = self.model_only()
        with self.assertRaisesRegex(ValueError, 'Unsupported asset manifest'): self.new_pack()
        self.new_assets(fontless)
        report = self.new_pack()
        manifest = self.m.parse(Path(report['manifest']).read_bytes())
        self.m.validate_manifest(manifest)
        profile = self.m.MODEL_ONLY_PROFILE
        self.assertEqual(manifest['runtimeProfile'], profile)
        self.assertEqual(manifest['configFingerprint']['runtimeProfile'], profile)
        self.assertEqual(self.m.layer_binding(manifest, 'code')['runtimeProfile'], profile)
        self.assertEqual(manifest['layers']['assets']['rawBytes'], 0)
        with self.assertRaisesRegex(ValueError, 'profile/config binding'):
            changed = copy.deepcopy(manifest)
            del changed['runtimeProfile']
            self.m.validate_manifest(changed)

    def test_fontless_schema_rejects_downgrade_fonts_and_native_image_engine(self):
        metadata = self.model_only()
        legacy = self.m.parse((self.legacy_assets / 'asset-manifest.json').read_bytes())
        metadata['files'] = [entry for entry in legacy['files'] if entry['kind'] == 'font']
        self.new_assets(metadata)
        with self.assertRaisesRegex(ValueError, 'Font in model-only'): self.new_pack()
        metadata['files'] = []
        self.new_assets(metadata)
        self.put(self.source / 'node_modules/.pnpm/sharp@1/node_modules/sharp/index.js', 'legacy')
        with self.assertRaisesRegex(ValueError, 'Legacy font or native image engine'): self.new_pack()
        self.config['env'].pop('ZIMAGE_IMAGE_ENGINE')
        self.set_config()
        with self.assertRaisesRegex(ValueError, 'Unsupported asset manifest'): self.new_pack()

    def test_old_schema1_and_2_manifest_bytes_match_original_d3117ac_implementation(self):
        self.config = self.legacy_config; self.set_config(); self.assets = self.legacy_assets
        baseline = self.root / 'old-tools'; baseline.mkdir()
        for name in ['three-layer-release.py', 'release-layers.py', 'release-public-policy.json']:
            body = subprocess.check_output(['git', '-C', str(HERE.parents[1]), 'show', 'd3117ac:' + 'ops/aliyun/' + name])
            (baseline / name).write_bytes(body)
        spec = importlib.util.spec_from_file_location('old_image_layers', baseline / 'three-layer-release.py')
        old = importlib.util.module_from_spec(spec); spec.loader.exec_module(old)
        for schema in [1, 2]:
            options = {'schema': schema, **({'target': self.target} if schema == 2 else {'assembly_cache_root': self.root / 'legacy-cache'})}
            with patch.object(old, 'runtime_identity', return_value=self.runtime), patch.object(self.m, 'runtime_identity', return_value=self.runtime):
                before = old.pack(self.source, self.root / ('old-' + str(schema)), self.project, self.assets, '1' * 40, **options)
                after = self.m.pack(self.source, self.root / ('new-' + str(schema)), self.project, self.assets, '1' * 40, **options)
            self.assertEqual(Path(before['manifest']).read_bytes(), Path(after['manifest']).read_bytes())


if __name__ == '__main__': unittest.main()
