"""Local filesystem/Node fixtures only: no SSH, services, providers or cloud calls."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('release-layers.py')
SHA = 'a' * 40


class LayeredReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zimage-layer-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.store, self.project = (self.root / name for name in ('source', 'store', 'project'))
        self.put(self.project, 'pnpm-lock.yaml', 'lockfileVersion: 9\nnext: 16.4.1\nsharp: 0.35.5\n')
        self.put(self.project, 'apps/web/package.json', json.dumps({'dependencies': {'next': '16.4.1', 'sharp': '0.35.5'}}))
        self.put(self.source, 'apps/web/.next/required-server-files.json', json.dumps({'config': {'output': 'standalone', 'distDir': '.next', 'env': {'ZIMAGE_BUILD_SHA': SHA}}}))
        self.put(self.source, 'apps/web/.next/BUILD_ID', SHA)
        self.put(self.source, 'apps/web/.next/server/main.js', 'application code')
        self.put(self.source, 'apps/web/.next/static/chunks/main.js', 'browser code')
        self.put(self.source, 'apps/web/public/commerce/apparel-v2/main-1.webp', 'image')
        self.put(self.source, 'apps/web/public/commerce/apparel-v2/manifest.json', '{}')
        for name in ('Regular', 'Bold'):
            self.put(self.source, f'apps/web/server/apparel/fonts/NotoSansCJKsc-{name}.otf', name)
        self.put(self.source, 'apps/web/server/apparel/fonts/LICENSE.txt', 'font license')
        self.put(self.source, 'node_modules/.pnpm/next/node_modules/next/package.json', json.dumps({'version': '16.4.1'}))
        self.put(self.source, 'apps/web/node_modules/sharp/package.json', json.dumps({'version': '0.35.5'}))
        link = self.source / 'apps/web/node_modules/next'
        link.symlink_to(os.path.relpath(self.source / 'node_modules/.pnpm/next/node_modules/next', link.parent))
        self.put(self.source, 'packages/domain/value.json', '{"value":42}')
        link = self.source / 'apps/web/node_modules/domain'
        link.symlink_to(os.path.relpath(self.source / 'packages/domain', link.parent))
        self.put(self.source, 'apps/web/server.js', '''const fs = require('node:fs');
console.log(JSON.stringify([require('./node_modules/next/package.json').version,
  require('./node_modules/domain/value.json').value,
  fs.readFileSync(__dirname+'/public/commerce/apparel-v2/main-1.webp','utf8'),
  fs.readFileSync(__dirname+'/server/apparel/fonts/NotoSansCJKsc-Regular.otf','utf8')]));
''')

    @staticmethod
    def put(root, name, text):
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def command(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)

    def packed(self, release='one', *args):
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', release, '--expected-build-sha', SHA, *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def assembly_args(self, report, destination, *extra, allow_sample=True):
        return ['assemble', report['manifest'], self.store, destination,
                '--manifest-sha256', report['manifestSha256'], *(['--allow-sample'] if allow_sample else []), *extra]

    def assemble(self, report, destination, *extra):
        result = self.command(*self.assembly_args(report, destination, *extra))
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def manifest(self, report):
        return json.loads(Path(report['manifest']).read_text())

    def test_first_install_assembles_a_runnable_release_and_reports_all_transfer_bytes(self):
        report = self.packed()
        dest = self.root / 'installed'
        self.assemble(report, dest)
        result = subprocess.run(['node', str(dest / 'apps/web/server.js')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ['16.4.1', 42, 'image', 'Regular'])
        self.assertEqual(set(self.manifest(report)['layers']), {'code', 'dependencies', 'static', 'fonts'})
        self.assertGreater(report['firstInstallBytes'], report['dailyCodeBytes'])
        self.assertLessEqual(report['dailyCodeBytes'], 10_000_000)

    def test_even_matching_build_is_labeled_local_prototype_and_needs_explicit_override(self):
        report = self.packed()
        self.assertFalse(self.manifest(report)['productionReady'])
        result = self.command(*self.assembly_args(report, self.root / 'installed', allow_sample=False))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--allow-sample', result.stderr)

    def test_missing_generated_server_client_or_build_id_cannot_fake_a_tiny_code_package(self):
        for name in ('apps/web/.next/static', 'apps/web/.next/server', 'apps/web/.next/BUILD_ID'):
            with self.subTest(missing=name):
                target = self.source / name
                held = self.root / ('held-' + target.name)
                target.rename(held)
                release_id = 'incomplete-' + target.name
                try:
                    result = self.command('pack', self.source, self.store, '--project', self.project,
                                          '--release-id', release_id, '--expected-build-sha', SHA)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Required build output', result.stderr)
                    self.assertFalse((self.store / ('releases/' + release_id + '.json')).exists())
                finally:
                    held.rename(target)

    def test_store_cannot_contain_input_release(self):
        store = self.root / 'outer-store'
        source = store / 'layers'
        shutil.copytree(self.source, source, symlinks=True)
        result = self.command('pack', source, store, '--project', self.project,
                              '--release-id', 'overlap', '--expected-build-sha', SHA)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('overlap', result.stderr)
        self.assertEqual(list(source.glob('*.tgz')), [])

    def test_symlinked_store_output_directory_cannot_write_into_input(self):
        self.store.mkdir()
        (self.store / 'layers').symlink_to(self.source, target_is_directory=True)
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', 'overlap', '--expected-build-sha', SHA)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('store', result.stderr)
        self.assertEqual(list(self.source.glob('*.tgz')), [])

    def test_assembly_cannot_publish_inside_layer_store(self):
        report = self.packed()
        destination = self.store / 'assembled'
        result = self.command(*self.assembly_args(report, destination))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('overlap', result.stderr)
        self.assertFalse(destination.exists())

    def test_code_change_reuses_other_layers_and_old_release_still_assembles(self):
        first = self.packed()
        self.put(self.source, 'apps/web/.next/server/main.js', 'new application code')
        second = self.packed('two')
        a, b = self.manifest(first)['layers'], self.manifest(second)['layers']
        for kind in ('dependencies', 'static', 'fonts'):
            self.assertEqual(a[kind], b[kind])
        self.assertNotEqual(a['code']['identity'], b['code']['identity'])
        self.assemble(second, self.root / 'new')
        self.assemble(first, self.root / 'rollback')
        self.assertEqual((self.root / 'rollback/apps/web/.next/server/main.js').read_text(), 'application code')

    def test_client_build_output_is_in_daily_code_layer_not_reusable_image_layer(self):
        first = self.packed()
        self.put(self.source, 'apps/web/.next/static/chunks/main.js', 'new browser code')
        second = self.packed('two')
        a, b = self.manifest(first)['layers'], self.manifest(second)['layers']
        self.assertNotEqual(a['code']['identity'], b['code']['identity'])
        self.assertEqual(a['static'], b['static'])
        index = json.loads((self.store / b['code']['index']).read_text())
        self.assertIn('apps/web/.next/static/chunks/main.js', [entry['path'] for entry in index['entries']])

    def test_lockfile_or_dependency_content_change_invalidates_dependency_layer(self):
        first = self.manifest(self.packed())['layers']['dependencies']['identity']
        self.put(self.project, 'pnpm-lock.yaml', 'changed lockfile')
        second = self.manifest(self.packed('two'))['layers']['dependencies']['identity']
        self.assertNotEqual(first, second)
        self.put(self.source, 'apps/web/node_modules/sharp/extra.js', 'new native wrapper')
        third = self.manifest(self.packed('three'))['layers']['dependencies']['identity']
        self.assertNotEqual(second, third)

    def test_missing_layer_blocks_publication(self):
        report = self.packed()
        p = self.store / self.manifest(report)['layers']['fonts']['archive']
        p.rename(p.with_suffix('.withheld'))
        dest = self.root / 'installed'
        self.assertNotEqual(self.command(*self.assembly_args(report, dest)).returncode, 0)
        self.assertFalse(dest.exists())

    def test_corrupt_layer_blocks_publication(self):
        report = self.packed()
        p = self.store / self.manifest(report)['layers']['static']['archive']
        p.write_bytes(b'corrupt')
        dest = self.root / 'installed'
        self.assertNotEqual(self.command(*self.assembly_args(report, dest)).returncode, 0)
        self.assertFalse(dest.exists())

    def test_wrong_manifest_digest_blocks_publication(self):
        report = self.packed()
        Path(report['manifest']).write_text('{}')
        self.assertNotEqual(self.command(*self.assembly_args(report, self.root / 'installed')).returncode, 0)

    def test_runtime_mismatch_blocks_publication_even_with_a_known_manifest_digest(self):
        report = self.packed()
        m = self.manifest(report)
        m['runtime']['abi'] = 'impossible'
        p = self.root / 'changed.json'
        p.write_text(json.dumps(m))
        report.update(manifest=str(p), manifestSha256=hashlib.sha256(p.read_bytes()).hexdigest())
        self.assertNotEqual(self.command(*self.assembly_args(report, self.root / 'installed')).returncode, 0)

    def test_existing_destination_is_never_overwritten(self):
        report = self.packed()
        dest = self.root / 'installed'
        self.put(dest, 'keep', 'unchanged')
        self.assertNotEqual(self.command(*self.assembly_args(report, dest)).returncode, 0)
        self.assertEqual((dest / 'keep').read_text(), 'unchanged')

    def test_parallel_assembly_publishes_exactly_one_complete_release(self):
        report = self.packed()
        dest = self.root / 'installed'
        cmd = [sys.executable, str(SCRIPT), *map(str, self.assembly_args(report, dest))]
        processes = [subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(2)]
        results = [(p.communicate(timeout=30), p.returncode) for p in processes]
        self.assertEqual(sum(code == 0 for _, code in results), 1, results)
        self.assertTrue((dest / 'apps/web/server.js').is_file())
        self.assertTrue((dest / '.layer-release.json').is_file())

    def test_small_budget_refuses_publication_instead_of_omitting_required_code(self):
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', 'tiny', '--expected-build-sha', SHA, '--code-budget', 1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('code budget exceeded', result.stderr)
        self.assertFalse((self.store / 'releases/tiny.json').exists())

    def test_static_and_font_changes_are_pinned_independently_per_release(self):
        first = self.packed()
        self.put(self.source, 'apps/web/public/commerce/apparel-v2/main-1.webp', 'new image')
        self.put(self.source, 'apps/web/server/apparel/fonts/NotoSansCJKsc-Regular.otf', 'new font')
        second = self.packed('two')
        a, b = self.manifest(first)['layers'], self.manifest(second)['layers']
        for kind in ('static', 'fonts'):
            self.assertNotEqual(a[kind]['identity'], b[kind]['identity'])
        self.assertEqual(a['code'], b['code'])
        self.assertEqual(a['dependencies'], b['dependencies'])
        self.assemble(first, self.root / 'rollback')
        self.assertEqual((self.root / 'rollback/apps/web/public/commerce/apparel-v2/main-1.webp').read_text(), 'image')
        self.assertEqual((self.root / 'rollback/apps/web/server/apparel/fonts/NotoSansCJKsc-Regular.otf').read_text(), 'Regular')

    def test_repeated_pack_is_byte_deterministic_with_new_release_id(self):
        first, second = self.packed(), self.packed('two')
        self.assertEqual(self.manifest(first)['layers'], self.manifest(second)['layers'])

    def test_trace_can_keep_sharp_only_in_pnpm_store_without_app_level_link(self):
        p = self.source / 'apps/web/node_modules/sharp/package.json'
        target = self.source / 'node_modules/.pnpm/sharp/node_modules/sharp/package.json'
        target.parent.mkdir(parents=True)
        p.rename(target)
        report = self.packed()
        self.assertEqual(self.manifest(report)['actualVersions']['sharp'], ['0.35.5'])

    def test_unused_internal_pnpm_alias_can_remain_dangling_like_standalone_trace(self):
        (self.source / 'apps/web/node_modules/optional').symlink_to('../../../node_modules/not-traced')
        report = self.packed()
        dest = self.root / 'installed'
        self.assemble(report, dest)
        self.assertTrue((dest / 'apps/web/node_modules/optional').is_symlink())

    def test_wrong_next_version_cannot_masquerade_as_current_production_build(self):
        self.put(self.source, 'node_modules/.pnpm/next/node_modules/next/package.json', '{"version":"16.3.0"}')
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', 'bad', '--expected-build-sha', SHA)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('dependency version mismatch', result.stderr)

    def test_excluded_source_png_in_staging_is_rejected_by_layer_packer_too(self):
        self.put(self.source, 'apps/web/public/commerce/apparel-v2/source-hero.png', 'source')
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', 'bad', '--expected-build-sha', SHA)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('excluded release path', result.stderr)

    def test_index_path_traversal_cannot_be_assembled(self):
        report = self.packed()
        m = self.manifest(report)
        layer = m['layers']['static']
        index = json.loads((self.store / layer['index']).read_text())
        index['entries'][0]['path'] = '../escaped'
        body = json.dumps(index).encode()
        identity = hashlib.sha256(body).hexdigest()
        layer['index'] = f'layers/static-{identity}.json'
        layer['identity'] = identity
        layer['indexBytes'] = len(body)
        (self.store / layer['index']).write_bytes(body)
        old_archive = self.store / layer['archive']
        layer['archive'] = f'layers/static-{identity}.tgz'
        (self.store / layer['archive']).write_bytes(old_archive.read_bytes())
        p = self.root / 'changed.json'
        p.write_text(json.dumps(m))
        report.update(manifest=str(p), manifestSha256=hashlib.sha256(p.read_bytes()).hexdigest())
        result = self.command(*self.assembly_args(report, self.root / 'installed'))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'escaped').exists())
        self.assertFalse((self.root / 'installed').exists())

    def test_development_build_requires_sample_label_and_explicit_sample_assembly(self):
        self.put(self.source, 'apps/web/.next/required-server-files.json', json.dumps({'config': {'env': {'ZIMAGE_BUILD_SHA': 'development'}}}))
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', 'bad', '--expected-build-sha', SHA)
        self.assertNotEqual(result.returncode, 0)
        report = self.packed('sample', '--sample-label', 'development fixture, not production')
        self.assertFalse(self.manifest(report)['productionReady'])
        self.assertNotEqual(self.command(*self.assembly_args(report, self.root / 'blocked', allow_sample=False)).returncode, 0)
        self.assemble(report, self.root / 'sample-install', '--allow-sample')

    def test_external_or_dangling_dependency_link_is_rejected(self):
        (self.source / 'apps/web/node_modules/escape').symlink_to('/tmp')
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', 'bad', '--expected-build-sha', SHA)
        self.assertNotEqual(result.returncode, 0)

    def test_existing_release_manifest_is_never_replaced(self):
        first = self.packed()
        before = Path(first['manifest']).read_bytes()
        result = self.command('pack', self.source, self.store, '--project', self.project,
                              '--release-id', 'one', '--expected-build-sha', SHA)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(Path(first['manifest']).read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
