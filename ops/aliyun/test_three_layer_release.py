"""Offline, temporary-fixture coverage for the opt-in three-layer prototype."""
import concurrent.futures
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('three-layer-release.py')


class ThreeLayers(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'three-layer implementation is missing')
        spec = importlib.util.spec_from_file_location('three_layers_under_test', SCRIPT)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.tmp = tempfile.TemporaryDirectory(prefix='zimage-three-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source, self.store, self.project, self.cache = [self.root / p for p in ('source', 'store', 'project', 'cache')]
        self.put(self.project / 'pnpm-lock.yaml', 'lock-v1')
        self.dist = 'apps/web/.next-build-qa/'
        self.put(self.source / (self.dist + 'required-server-files.json'), json.dumps({'config': {'distDir': '.next-build-qa', 'env': {'ZIMAGE_BUILD_SHA': 'qa-actual-marker'}}}))
        self.put(self.source / (self.dist + 'BUILD_ID'), 'qa-actual-build-id')
        self.put(self.source / (self.dist + 'server/chunks/business.js'), 'server business')
        self.put(self.source / (self.dist + 'static/chunks/client.js'), 'client business')
        self.put(self.source / (self.dist + 'server/chunks/business.js.map'), 'retained debug map')
        self.put(self.source / (self.dist + 'server/app/page.js.nft.json'), '{"files":[]}')
        self.put(self.source / 'apps/web/server.js', 'standalone server')
        self.put(self.source / 'packages/domain/index.js', 'workspace business')
        self.put(self.source / 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js', 'runtime library')
        self.put(self.source / 'node_modules/.pnpm/pkg@1/node_modules/pkg/native.node', b'ELF fixture')
        self.symlink(self.source / 'apps/web/node_modules/pkg', '../../../node_modules/.pnpm/pkg@1/node_modules/pkg')
        self.symlink(self.source / 'apps/web/node_modules/domain', '../../../packages/domain')
        files = []
        values = {'commerce/example.jpg': b'original public pixels', 'fonts/NotoSansCJKsc-Regular.otf': b'original regular font',
                  'fonts/NotoSansCJKsc-Bold.otf': b'original bold font', 'fonts/LICENSE.txt': b'original license', 'fonts/README.md': b'original provenance'}
        for name, value in sorted(values.items()):
            kind = 'font' if name.startswith('fonts/') else 'public'
            files.append({'path': name, 'kind': kind, 'bytes': len(value), 'sha256': self.m.digest(value), 'mime': 'font/otf' if name.endswith('.otf') else 'text/plain'})
        body = self.m.canonical({'schema': 1, 'productionReady': False, 'files': files})
        self.assets = self.root / 'input-assets' / self.m.digest(body)
        for name, value in values.items():
            self.put(self.assets / name, value)
            staged = self.source / ('apps/web/server/apparel/' + name if name.startswith('fonts/') else 'apps/web/public/' + name)
            self.put(staged, value)
        self.put(self.assets / 'asset-manifest.json', body)

    def put(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value.encode() if isinstance(value, str) else value)

    def symlink(self, path, target):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(target)

    def pack(self, release='one', **kwargs):
        return self.m.pack(self.source, self.store, self.project, self.assets, release, assembly_cache_root=self.cache, **kwargs)

    def assemble(self, packed, name='app', **kwargs):
        return self.m.assemble(Path(packed['manifest']), self.store, self.root / name, self.cache, packed['manifestSha256'], True, **kwargs)

    def test_pack_raw_metadata_and_actual_marker(self):
        p = self.pack(source_commit='1' * 40)
        body = Path(p['manifest']).read_bytes()
        m = json.loads(body)
        self.assertFalse(m['productionReady'])
        self.assertEqual(m['build']['marker'], 'qa-actual-marker')
        self.assertEqual(m['build']['buildId'], 'qa-actual-build-id')
        self.assertFalse(m['build']['markerMatchesSourceCommit'])
        code = json.loads((self.store / m['layers']['code']['index']).read_bytes())
        paths = {e['path'] for e in code['entries']}
        self.assertIn(self.dist + 'server/chunks/business.js', paths)
        self.assertIn(self.dist + 'static/chunks/client.js', paths)
        self.assertIn('packages/domain/index.js', paths)
        self.assertFalse(any('/public/' in n or '/fonts/' in n or 'node_modules' in n.split('/') for n in paths))
        self.assertNotIn(self.dist + 'server/chunks/business.js.map', paths)
        self.assertEqual(m['raw']['releaseManifestBytes'], len(body))
        generated = len(os.fsencode(str(self.cache / 'assets' / self.assets.name)))
        self.assertEqual(m['raw']['generatedPublicSymlinkBytes'], generated)
        self.assertEqual(m['raw']['codeBytes'], sum(e.get('bytes', 0) + (len(os.fsencode(e['target'])) if e['type'] == 'symlink' else 0) for e in code['entries']) + generated + m['layers']['code']['indexBytes'] + len(body))
        expected = m['raw']['codeBytes'] + sum(m['layers'][k]['rawBytes'] + m['layers'][k]['symlinkTargetBytes'] + m['layers'][k]['indexBytes'] for k in ('runtime', 'assets'))
        self.assertEqual(m['raw']['totalBytes'], expected)
        self.assertIsNone(m['budgetBytes'])
        self.assertIsNone(m['budgetPassed'])
        self.assertEqual(m['layers']['assets']['identity'], self.assets.name)

    def test_code_changes_reuse_runtime_assets_and_preserve_workspace_links(self):
        a = self.pack('one')
        first = self.assemble(a, 'app-one')
        self.put(self.source / (self.dist + 'server/chunks/business.js'), 'changed business')
        b = self.pack('two')
        second = self.assemble(b, 'app-two')
        for kind in ('runtime', 'assets'):
            self.assertEqual(a['layers'][kind]['identity'], b['layers'][kind]['identity'])
            self.assertTrue(second['cache'][kind]['reused'])
        self.assertNotEqual(a['layers']['code']['identity'], b['layers']['code']['identity'])
        app = self.root / 'app-two'
        self.assertEqual((app / 'apps/web/node_modules/domain/index.js').read_text(), 'workspace business')
        self.assertEqual((app / 'apps/web/node_modules/pkg/index.js').read_text(), 'runtime library')
        runtime_file = Path(first['cache']['runtime']['directory']) / 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js'
        self.assertEqual(runtime_file.stat().st_ino, (app / 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js').stat().st_ino)
        self.assertEqual(stat.S_IMODE(runtime_file.stat().st_mode), 0o444)
        self.assertEqual(stat.S_IMODE(runtime_file.parent.stat().st_mode), 0o555)
        self.assertEqual(Path(second['environment']['ZIMAGE_SHARED_FONT_DIR']).parent.name, self.assets.name)
        public = app / 'apps/web/public'
        self.assertTrue(public.is_symlink())
        self.assertEqual(os.readlink(public), str(self.cache / 'assets' / self.assets.name))
        self.assertEqual((public / 'commerce/example.jpg').read_bytes(), (self.assets / 'commerce/example.jpg').read_bytes())
        self.assertTrue((self.source / (self.dist + 'server/chunks/business.js.map')).exists())
        self.assertTrue((self.root / 'app-one' / (self.dist + 'server/chunks/business.js')).exists())

    def test_runtime_identity_binds_lock_abi_and_file_content(self):
        a = self.pack('base')['layers']['runtime']['identity']
        self.put(self.project / 'pnpm-lock.yaml', 'different lock')
        self.assertNotEqual(a, self.pack('lock')['layers']['runtime']['identity'])
        self.put(self.project / 'pnpm-lock.yaml', 'lock-v1')
        rt = self.m.runtime_identity()
        with patch.object(self.m, 'runtime_identity', return_value={**rt, 'abi': 'other-abi'}):
            p = self.pack('abi')
        self.assertNotEqual(a, p['layers']['runtime']['identity'])
        with patch.object(self.m, 'runtime_identity', return_value={**rt, 'node': rt['node'] + '-different-version'}):
            self.assertNotEqual(a, self.pack('node-version')['layers']['runtime']['identity'])
        with self.assertRaisesRegex(ValueError, 'Runtime'):
            self.assemble(p)
        self.put(self.source / 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js', 'different runtime')
        self.assertNotEqual(a, self.pack('content')['layers']['runtime']['identity'])
        with patch.object(self.m, 'runtime_identity', return_value={**rt, 'libc': 'non-glibc'}):
            with self.assertRaisesRegex(ValueError, 'glibc'):
                self.pack('unsupported')

    def test_explicit_raw_budget_cannot_be_hidden_by_gzip(self):
        self.put(self.source / (self.dist + 'server/chunks/big.js'), b'0' * 10_000_001)
        with self.assertRaisesRegex(ValueError, 'raw.*budget'):
            self.pack('too-large', budget=10_000_000)
        self.assertFalse((self.store / 'releases/too-large.json').exists())
        p = self.pack('explicit-cap', budget=30_000_000)
        m = json.loads(Path(p['manifest']).read_bytes())
        self.assertEqual(m['budgetBytes'], 30_000_000)
        self.assertTrue(m['budgetPassed'])
        self.assertGreater(m['raw']['codeBytes'], 10_000_000)
        self.assertLess(m['layers']['code']['archiveBytes'], 100_000)
        self.assertFalse(m['productionReady'])

    def test_default_has_no_code_budget_and_reports_it_as_unconfigured(self):
        self.put(self.source / (self.dist + 'server/chunks/big.js'), b'0' * 10_000_001)
        packed = self.pack('default-unbounded')
        manifest = json.loads(Path(packed['manifest']).read_bytes())
        for value in (packed, manifest, self.assemble(packed)):
            self.assertIsNone(value['budgetBytes'])
            self.assertIsNone(value['budgetPassed'])
            self.assertGreater(value['raw']['codeBytes'], 10_000_000)
            self.assertFalse(value['productionReady'])

    def test_wrong_missing_or_corrupt_resources_block_pack(self):
        original = self.assets / 'commerce/example.jpg'
        original.write_bytes(b'corruption')
        with self.assertRaisesRegex(ValueError, 'asset'):
            self.pack('bad-asset')
        original.unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.pack('missing-asset')
        self.put(original, b'original public pixels')
        self.put(self.source / 'apps/web/public/commerce/example.jpg', 'wrong staged resource')
        with self.assertRaisesRegex(ValueError, 'asset'):
            self.pack('staged-mismatch')
        wrong = self.assets.with_name('0' * 64)
        shutil.copytree(self.assets, wrong)
        with self.assertRaisesRegex(ValueError, 'asset'):
            self.m.pack(self.source, self.store, self.project, wrong, 'wrong-version', assembly_cache_root=self.cache)
        self.assertFalse((self.store / 'releases').exists())

    def test_trust_gate_missing_layers_and_cache_tamper_block_app(self):
        p = self.pack()
        with self.assertRaisesRegex(ValueError, 'allow-sample'):
            self.m.assemble(Path(p['manifest']), self.store, self.root / 'no-gate', self.cache, p['manifestSha256'], False)
        with self.assertRaisesRegex(ValueError, 'manifest'):
            self.m.assemble(Path(p['manifest']), self.store, self.root / 'wrong-trust', self.cache, '0' * 64, True)
        a = self.assemble(p, 'good')
        runtime_file = Path(a['cache']['runtime']['directory']) / 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js'
        runtime_file.chmod(0o644)
        runtime_file.write_text('tampered runtime')
        runtime_file.chmod(0o444)
        with self.assertRaisesRegex(ValueError, 'cache'):
            self.assemble(p, 'bad-cache')
        self.assertFalse((self.root / 'bad-cache').exists())
        (self.store / p['layers']['assets']['archive']).unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.assemble(p, 'missing-layer')
        self.assertFalse((self.root / 'missing-layer').exists())

    def test_asset_cache_extra_member_blocks_reuse(self):
        p = self.pack()
        a = self.assemble(p)
        asset_cache = Path(a['cache']['assets']['directory'])
        asset_cache.chmod(0o755)
        self.put(asset_cache / 'extra.txt', 'unexpected')
        asset_cache.chmod(0o555)
        with self.assertRaisesRegex(ValueError, 'cache'):
            self.assemble(p, 'extra-cache')
        self.assertFalse((self.root / 'extra-cache').exists())

    def test_disjoint_symlink_outputs_and_external_links_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'overlap'):
            self.m.pack(self.source, self.source / 'store', self.project, self.assets, 'overlap', assembly_cache_root=self.cache)
        self.store.mkdir()
        external = self.root / 'external'
        external.mkdir()
        (self.store / 'layers').symlink_to(external)
        with self.assertRaisesRegex(ValueError, '[Ss]ymlink|[Uu]nsafe'):
            self.pack()
        self.assertEqual(list(external.iterdir()), [])
        (self.store / 'layers').unlink()
        self.symlink(self.source / 'node_modules/unsafe', '/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.pack('unsafe')
        (self.source / 'node_modules/unsafe').unlink()
        p = self.pack('safe')
        alias = self.root / 'alias'
        alias.symlink_to(external)
        with self.assertRaisesRegex(ValueError, '[Ss]ymlink'):
            self.m.assemble(Path(p['manifest']), self.store, alias / 'app', self.cache, p['manifestSha256'], True)
        self.assertEqual(list(external.iterdir()), [])

    def test_concurrent_no_overwrite_and_cross_filesystem_copy_reporting(self):
        p = self.pack()
        def run(_):
            try:
                return self.assemble(p, 'racing')
            except (ValueError, FileExistsError):
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(run, range(2)))
        self.assertEqual(sum(value is not None for value in outcomes), 1)
        with self.assertRaises((ValueError, FileExistsError)):
            self.pack()
        with patch.object(self.m.os, 'link', side_effect=OSError(errno.EXDEV, 'cross-device fixture')):
            copied = self.assemble(p, 'copied')
        self.assertEqual(copied['runtimeReuse']['hardlinkedBytes'], 0)
        self.assertGreater(copied['runtimeReuse']['copiedBytes'], 0)
        self.assertTrue((self.root / 'racing/apps/web/server.js').exists())

    def test_archive_escape_duplicate_extra_and_external_link_members_are_rejected(self):
        for number, attack in enumerate(('escape', 'duplicate', 'extra', 'external-link', 'missing')):
            packed = self.pack('malicious-' + str(number))
            manifest_path = Path(packed['manifest'])
            manifest = json.loads(manifest_path.read_bytes())
            layer = manifest['layers']['code']
            archive_path = self.store / layer['archive']
            original = archive_path.read_bytes()
            with tarfile.open(fileobj=io.BytesIO(original), mode='r:gz') as reader:
                members = [(item, reader.extractfile(item).read() if item.isfile() else None) for item in reader]
            with tarfile.open(archive_path, 'w:gz') as writer:
                for index, (item, value) in enumerate(members):
                    if attack == 'missing' and index == 0:
                        continue
                    if attack == 'external-link' and index == 0:
                        item.type, item.linkname, item.size = tarfile.SYMTYPE, '/etc/passwd', 0
                        value = None
                    writer.addfile(item, io.BytesIO(value) if value is not None else None)
                if attack == 'duplicate':
                    item, value = members[-1]
                    writer.addfile(item, io.BytesIO(value) if value is not None else None)
                elif attack in ('escape', 'extra'):
                    item = tarfile.TarInfo('../escaped' if attack == 'escape' else 'extra.txt')
                    item.size, item.mode = 3, 0o644
                    writer.addfile(item, io.BytesIO(b'bad'))
            layer['archiveSha256'], layer['archiveBytes'] = self.m.file_digest(archive_path), archive_path.stat().st_size
            manifest_body = self.m.finish_manifest(manifest)
            manifest_path.write_bytes(manifest_body)
            packed['manifestSha256'] = self.m.digest(manifest_body)
            with self.assertRaisesRegex(ValueError, '[Aa]rchive'):
                self.assemble(packed, 'bad-archive-' + str(number))
            self.assertFalse((self.root / ('bad-archive-' + str(number))).exists())
            self.assertFalse((self.root / 'escaped').exists())
            archive_path.write_bytes(original)

    def test_cached_symlink_replacement_is_detected(self):
        packed = self.pack()
        assembled = self.assemble(packed)
        cache = Path(assembled['cache']['runtime']['directory'])
        link = cache / 'apps/web/node_modules/domain'
        link.parent.chmod(0o755)
        link.unlink()
        link.symlink_to('/etc')
        link.parent.chmod(0o555)
        with self.assertRaisesRegex(ValueError, 'cache.*symlink'):
            self.assemble(packed, 'bad-link')
        self.assertFalse((self.root / 'bad-link').exists())

    def test_bound_cache_root_and_repeated_concurrent_release_id_are_rejected(self):
        def publish(_):
            try:
                return self.pack('same-release')
            except ValueError:
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(publish, range(2)))
        self.assertEqual(sum(value is not None for value in results), 1)
        packed = next(value for value in results if value is not None)
        body = Path(packed['manifest']).read_bytes()
        with self.assertRaisesRegex(ValueError, 'cache root'):
            self.m.assemble(Path(packed['manifest']), self.store, self.root / 'wrong-cache-app', self.root / 'other-cache', packed['manifestSha256'], True)
        self.assertEqual(Path(packed['manifest']).read_bytes(), body)
        self.assertFalse((self.root / 'wrong-cache-app').exists())
        self.assertEqual((self.source / 'apps/web/server.js').read_text(), 'standalone server')
        self.assertEqual((self.assets / 'commerce/example.jpg').read_bytes(), b'original public pixels')

    def test_restrictive_child_umask_keeps_owned_cache_paths_traversable(self):
        parent_mode = stat.S_IMODE(self.root.stat().st_mode)
        source_mode = stat.S_IMODE((self.source / 'apps/web/server.js').stat().st_mode)
        def command(*args):
            result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True,
                                    preexec_fn=lambda: os.umask(0o077))
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        packed = command('pack', self.source, self.store, '--project', self.project, '--assets', self.assets,
                         '--assembly-cache-root', self.cache, '--release-id', 'umask-fixture')
        command('assemble', packed['manifest'], self.store, self.root / 'readable-app', '--cache', self.cache,
                '--manifest-sha256', packed['manifestSha256'], '--allow-sample')
        for directory, _, _ in os.walk(self.cache, followlinks=False):
            self.assertEqual(stat.S_IMODE(Path(directory).stat().st_mode) & 0o005, 0o005, directory)
        for directory in (self.cache, self.cache / 'assets', self.cache / 'runtime'):
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), parent_mode)
        self.assertEqual(stat.S_IMODE((self.source / 'apps/web/server.js').stat().st_mode), source_mode)

    def compiled_pattern(self, **changes):
        return {'protocol': 'https', 'hostname': 'assets.qa.invalid', 'port': '45951',
                'pathname': f'/static-assets/{self.assets.name}/commerce/**', 'search': '', **changes}

    def set_patterns(self, patterns):
        target = self.source / (self.dist + 'required-server-files.json')
        value = json.loads(target.read_bytes())
        value['config']['images'] = {'remotePatterns': patterns}
        self.put(target, json.dumps(value))

    def test_changed_asset_manifest_with_identical_payload_rejects_stale_compiled_version(self):
        self.set_patterns([self.compiled_pattern()])
        body = json.loads((self.assets / 'asset-manifest.json').read_bytes())
        body['provenanceRevision'] = 'Metadata changed; every resource byte is identical'
        body = self.m.canonical(body)
        changed = self.assets.with_name(self.m.digest(body))
        shutil.copytree(self.assets, changed)
        self.put(changed / 'asset-manifest.json', body)
        with self.assertRaisesRegex(ValueError, 'compiled asset'):
            self.m.pack(self.source, self.store, self.project, changed, 'stale-compiled', assembly_cache_root=self.cache)
        self.assertFalse((self.store / 'releases/stale-compiled.json').exists())

    def test_compiled_resource_patterns_require_exact_https_version_and_query_restriction(self):
        for number, changes in enumerate(({'protocol': 'http'}, {'hostname': '*.qa.invalid'}, {'hostname': 'host?query'},
                                          {'search': '?x=1'}, {'pathname': '/static-assets/' + '0' * 64 + '/commerce/**'},
                                          {'pathname': f'/static-assets/{self.assets.name}/**'}, {'port': '*'})):
            self.set_patterns([self.compiled_pattern(**changes)])
            with self.assertRaisesRegex(ValueError, 'compiled asset'):
                self.pack('bad-pattern-' + str(number))
        pattern = self.compiled_pattern()
        del pattern['search']
        self.set_patterns([pattern])
        with self.assertRaisesRegex(ValueError, 'compiled asset'):
            self.pack('unrestricted-query')
        self.set_patterns([self.compiled_pattern()])
        packed = self.pack('valid-compiled')
        manifest = json.loads(Path(packed['manifest']).read_bytes())
        self.assertEqual(manifest['compiledAssetBaseUrl'], f'https://assets.qa.invalid:45951/static-assets/{self.assets.name}')
        self.assemble(packed, 'valid-compiled-app')

    def test_assembly_rechecks_actual_compiled_resource_config(self):
        self.set_patterns([self.compiled_pattern(pathname='/static-assets/' + '0' * 64 + '/commerce/**')])
        # Simulate a trusted, older packer without the new pack-time guard.
        with patch.object(self.m, 'validate_compiled_assets', return_value=None):
            packed = self.pack('old-packer')
        with self.assertRaisesRegex(ValueError, 'compiled asset'):
            self.assemble(packed, 'stale-compiled-app')
        self.assertFalse((self.root / 'stale-compiled-app').exists())

    def test_original_symlink_cannot_escape_through_generated_public_link(self):
        good = self.pack('good-before-public-escape')
        previous = self.assemble(good, 'previous-app')
        previous_marker = (self.root / 'previous-app/.three-layer-release.json').read_bytes()
        runtime_cache = Path(previous['cache']['runtime']['directory'])
        asset_cache = Path(previous['cache']['assets']['directory'])
        runtime_digest = self.m.file_digest(runtime_cache / 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js')
        self.symlink(self.source / 'leak', 'apps/web/public/../../../project/pnpm-lock.yaml')
        self.assertTrue((self.source / 'leak').resolve(strict=False).is_relative_to(self.source))
        malicious = self.pack('public-escape')
        with self.assertRaisesRegex(ValueError, 'symlink.*public|symlink.*escapes'):
            self.assemble(malicious, 'unsafe-public-app')
        self.assertFalse((self.root / 'unsafe-public-app').exists())
        self.assertEqual(list(self.root.glob('.unsafe-public-app.pending-*')), [])
        self.assertEqual((self.root / 'previous-app/.three-layer-release.json').read_bytes(), previous_marker)
        self.assertEqual((self.root / 'previous-app/apps/web/public/commerce/example.jpg').read_bytes(), b'original public pixels')
        self.assertEqual(self.m.file_digest(runtime_cache / 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js'), runtime_digest)
        self.assertEqual((asset_cache / 'commerce/example.jpg').read_bytes(), b'original public pixels')
        self.assertEqual((self.project / 'pnpm-lock.yaml').read_text(), 'lock-v1')
        self.assertTrue((self.source / 'leak').is_symlink())

    def test_source_size_change_between_lstat_and_digest_cannot_publish_manifest(self):
        target = self.source / (self.dist + 'server/chunks/business.js')
        original_digest, original_read = self.m.file_digest, self.m.read_regular
        changed = False
        def mutate_once(path):
            nonlocal changed
            if Path(path) == target and not changed:
                changed = True
                target.write_bytes(b'changed source payload with more bytes')
        def racing_digest(path):
            mutate_once(path)
            return original_digest(path)
        def racing_read(path):
            mutate_once(path)
            return original_read(path)
        with patch.object(self.m, 'file_digest', side_effect=racing_digest), patch.object(self.m, 'read_regular', side_effect=racing_read):
            with self.assertRaisesRegex(ValueError, '[Cc]hanged|size'):
                self.pack('inventory-race')
        self.assertTrue(changed)
        self.assertFalse((self.store / 'releases/inventory-race.json').exists())

    def test_shared_archive_tool_rejects_stale_index_size_before_truncation(self):
        target = self.source / (self.dist + 'server/chunks/business.js')
        target.write_bytes(b'changed source payload with more bytes')
        entry = {'path': target.relative_to(self.source).as_posix(), 'type': 'file', 'mode': 0o644,
                 'bytes': 15, 'sha256': self.m.file_digest(target)}
        with self.assertRaisesRegex(ValueError, '[Ss]ize'):
            self.m.make_archive(self.source, self.root / 'must-not-publish.tgz', [entry])
        self.assertFalse((self.root / 'must-not-publish.tgz').exists())


if __name__ == '__main__':
    unittest.main()
