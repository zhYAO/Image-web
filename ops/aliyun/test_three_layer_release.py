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
import uuid
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('three-layer-release.py')


@unittest.skipUnless(os.name == 'posix', 'Requires real Linux/glibc, POSIX modes and symlink assembly; Windows is not acceptance evidence')
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
            if not name.startswith('fonts/'):
                self.put(self.source / ('apps/web/public/' + name), value)
        self.put(self.assets / 'asset-manifest.json', body)

    def put(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value.encode() if isinstance(value, str) else value)

    def symlink(self, path, target):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(target)

    def pack(self, release='one', **kwargs):
        return self.m.pack(self.source, self.store, self.project, self.assets, release, assembly_cache_root=self.cache, schema=1, **kwargs)

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
            self.m.pack(self.source, self.store, self.project, wrong, 'wrong-version', assembly_cache_root=self.cache, schema=1)
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
            self.m.pack(self.source, self.source / 'store', self.project, self.assets, 'overlap', assembly_cache_root=self.cache, schema=1)
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
                         '--assembly-cache-root', self.cache, '--release-id', 'umask-fixture', '--schema', '1')
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
            self.m.pack(self.source, self.store, self.project, changed, 'stale-compiled', assembly_cache_root=self.cache, schema=1)
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


class PortableFixture(unittest.TestCase):
    """Synthetic Linux metadata only; does not assert native Linux compatibility."""
    runtime = {'node': '24.19.0', 'abi': '137', 'platform': 'linux', 'arch': 'x64', 'libc': 'glibc-2.36'}

    def setUp(self):
        spec = importlib.util.spec_from_file_location('portable_layers', SCRIPT)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        # mkdir(0755) avoids Python 3.14's Windows private-directory ACL behavior.
        self.root = Path(tempfile.gettempdir()) / ('zimage-contract-' + uuid.uuid4().hex)
        self.root.mkdir(mode=0o755)
        self.addCleanup(shutil.rmtree, self.root)
        self.source, self.store, self.project = [self.root / p for p in ('source', 'store', 'project')]
        self.put(self.project / 'pnpm-lock.yaml', 'lock-v1')
        self.put(self.project / 'package.json', json.dumps({'packageManager': 'pnpm@11.19.0'}))
        self.put(self.project / 'apps/web/next.config.ts', 'export default {output: "standalone"}')
        self.put(self.project / 'apps/web/build/static-assets-config.mjs', 'export const assets = true;')
        self.dist = 'apps/web/.next-build-qa/'
        self.config = {'distDir': '.next-build-qa', 'env': {'ZIMAGE_BUILD_SHA': 'one'},
                       'outputFileTracingRoot': str(self.project), 'output': 'standalone',
                       'transpilePackages': ['@zimage/domain'], 'experimental': {'cpus': 1}}
        self.set_config()
        for name, body in {'BUILD_ID': 'build-one', 'server/chunks/main.js': 'server', 'static/chunks/client.js': 'client'}.items():
            self.put(self.source / (self.dist + name), body)
        self.put(self.source / 'apps/web/server.js', 'server entry')
        self.put(self.source / 'node_modules/pkg/index.js', 'runtime library')
        self.put(self.source / 'node_modules/pkg/alias.js', 'another alias target')
        files = []
        values = {'commerce/example.jpg': b'pixels', **{'fonts/' + name: name.encode() for name in
                  ('NotoSansCJKsc-Regular.otf', 'NotoSansCJKsc-Bold.otf', 'LICENSE.txt', 'README.md')}}
        for name, body in sorted(values.items()):
            files.append({'path': name, 'kind': 'font' if name.startswith('fonts/') else 'public',
                          'bytes': len(body), 'sha256': self.m.digest(body), 'mime': 'text/plain'})
        body = self.m.canonical({'schema': 1, 'productionReady': False, 'files': files})
        self.assets = self.root / 'resources' / self.m.digest(body)
        for name, value in values.items():
            self.put(self.assets / name, value)
        self.put(self.assets / 'asset-manifest.json', body)
        self.target = {'schema': 1, 'runtime': dict(self.runtime), 'toolchain': {'packageManager': 'pnpm@11.19.0'},
                       'assemblyCacheRoot': '/opt/zimage/layer-cache'}

    def put(self, path, body):
        path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        path.write_bytes(body.encode() if isinstance(body, str) else body)

    def set_config(self):
        self.put(self.source / (self.dist + 'required-server-files.json'), json.dumps({'config': self.config}))

    def pack(self, release='1' * 40, **kwargs):
        with patch.object(self.m, 'runtime_identity', return_value=dict(self.runtime)):
            return self.m.pack(self.source, self.store, self.project, self.assets, release, target=self.target, **kwargs)


class LayerContract(PortableFixture):
    @staticmethod
    def elf_header(machine=62, elf_class=2, byte_order=1):
        body = bytearray(64)
        body[:6] = b'\x7fELF' + bytes((elf_class, byte_order))
        body[18:20] = machine.to_bytes(2, 'little' if byte_order == 1 else 'big')
        return bytes(body)

    def test_foreign_shared_library_extensions_reject_before_outputs(self):
        # A valid Linux addon does not excuse an unused foreign library.
        self.put(self.source / 'node_modules/pkg/native.node', self.elf_header())
        for index, suffix in enumerate(('.dll', '.DLL', '.DlL', '.dylib', '.DYLIB', '.DyLiB')):
            with self.subTest(suffix=suffix):
                path = self.source / ('node_modules/pkg/unused' + suffix)
                self.put(path, b'MZ' + b'\0' * 62)
                try:
                    with self.assertRaisesRegex(ValueError, 'foreign|native|Linux'):
                        self.pack('foreign-library-' + str(index))
                    self.assertFalse(self.store.exists())
                finally:
                    path.unlink()

    def test_shared_library_elf_headers_must_match_target(self):
        headers = (b'MZ' + b'\0' * 62, self.elf_header(machine=183),
                   self.elf_header(elf_class=1), self.elf_header(byte_order=2), b'\x7fELF')
        for name in ('libvips.so', 'libvips.so.42', 'libvips.so.42.3.1', 'libVips.SO.2'):
            for body in headers:
                with self.subTest(name=name, header=body[:20]):
                    path = self.source / ('node_modules/pkg/' + name)
                    self.put(path, body)
                    try:
                        with self.assertRaisesRegex(ValueError, 'native|ELF|architecture'):
                            self.m.validate_native_files(self.source, [{'path': path.relative_to(self.source).as_posix(), 'type': 'file'}], self.runtime)
                    finally:
                        path.unlink()

    def test_valid_linux_shared_library_names_are_accepted(self):
        for name in ('libvips.so', 'libvips.so.42', 'libvips.so.42.3.1', 'libVips.SO.2', 'addon.NODE'):
            self.put(self.source / ('node_modules/pkg/' + name), self.elf_header())
        self.pack()  # Synthetic matching ELF headers only; no native loading.

    def test_shared_library_metadata_and_backups_are_not_classified_as_natives(self):
        for name in ('libvips.so.map', 'libvips.so.1.debug', 'libvips.so.backup', 'library.dll.txt', 'lib.dylib.LICENSE'):
            self.put(self.source / ('node_modules/pkg/' + name), 'non-native metadata')
        self.pack()

    def test_windows_native_payload_is_rejected_even_with_linux_metadata(self):
        self.put(self.source / 'node_modules/pkg/native.node', b'MZ' + b'\0' * 62)
        with self.assertRaisesRegex(ValueError, 'native|ELF'):
            self.pack()
        self.assertFalse(self.store.exists())

    def test_synthetic_elf_header_must_match_target_architecture(self):
        body = bytearray(64)
        body[:6] = b'\x7fELF\x02\x01'
        body[18:20] = (183).to_bytes(2, 'little')
        self.put(self.source / 'node_modules/pkg/native.node', bytes(body))
        with self.assertRaisesRegex(ValueError, 'native|architecture'):
            self.pack()
        self.assertFalse(self.store.exists())
        body[18:20] = (62).to_bytes(2, 'little')
        self.put(self.source / 'node_modules/pkg/native.node', bytes(body))
        self.pack()  # Header validation only, not native execution acceptance.

    def test_project_toolchain_drift_is_rejected_before_outputs(self):
        self.put(self.project / 'package.json', json.dumps({'packageManager': 'pnpm@11.18.0'}))
        with self.assertRaisesRegex(ValueError, 'packageManager'):
            self.pack()
        self.assertFalse(self.store.exists())

    def test_matching_changed_runtime_target_changes_runtime_identity(self):
        first = self.pack()['layers']['runtime']['identity']
        for index, (field, value) in enumerate((('node', '24.20.0'), ('abi', '138'), ('libc', 'glibc-2.37'), ('arch', 'arm64'))):
            runtime = {**self.runtime, field: value}
            target = {**self.target, 'runtime': runtime}
            with patch.object(self.m, 'runtime_identity', return_value=runtime):
                packed = self.m.pack(self.source, self.store, self.project, self.assets, str(index + 2) * 40, target=target)
            self.assertNotEqual(first, packed['layers']['runtime']['identity'])

    def test_symbolic_trace_inventory_target_changes_runtime_identity(self):
        original = self.m.inspect_source
        def inventory(target):
            entries, omitted = original(self.source, '.next-build-qa')
            return sorted(entries + [{'path': 'node_modules/pkg/link', 'type': 'symlink', 'mode': 0o777, 'target': target}], key=lambda entry: entry['path']), omitted
        # Synthetic trace inventory tests wire identity without claiming Windows
        # can create/resolve the Linux symlinks required by real assembly.
        with patch.object(self.m, 'inspect_source', return_value=inventory('index.js')):
            first = self.pack()['layers']['runtime']['identity']
        with patch.object(self.m, 'inspect_source', return_value=inventory('alias.js')):
            second = self.pack('2' * 40)['layers']['runtime']['identity']
        self.assertNotEqual(first, second)

    def test_resource_version_and_config_key_order_do_not_change_runtime_identity(self):
        first = self.pack()['layers']['runtime']['identity']
        value = self.m.parse((self.assets / 'asset-manifest.json').read_bytes())
        value['provenanceRevision'] = 'new metadata, same payload'
        body = self.m.canonical(value)
        changed = self.assets.with_name(self.m.digest(body))
        shutil.copytree(self.assets, changed)
        self.put(changed / 'asset-manifest.json', body)
        self.assets = changed
        self.config = dict(reversed(list(self.config.items())))
        self.set_config()
        self.assertEqual(first, self.pack('2' * 40)['layers']['runtime']['identity'])

    def test_explicit_legacy_pack_still_works(self):
        with patch.object(self.m, 'runtime_identity', return_value=self.runtime):
            packed = self.m.pack(self.source, self.store, self.project, self.assets, '1' * 40,
                                 schema=1, assembly_cache_root=self.root / 'legacy-cache')
        manifest = self.m.parse(Path(packed['manifest']).read_bytes())
        self.assertEqual(manifest['schema'], 1)
        self.assertNotIn('runtimeBinding', manifest)
        self.assertEqual(self.m.parse((self.store / manifest['layers']['runtime']['index']).read_bytes())['schema'], 1)

    def test_immutable_layers_and_release_id_survive_concurrent_publication(self):
        def publish(_):
            try:
                return self.m.pack(self.source, self.store, self.project, self.assets, '1' * 40, target=self.target)
            except ValueError:
                return None
        with patch.object(self.m, 'runtime_identity', return_value=self.runtime):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(publish, range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        packed = next(result for result in results if result is not None)
        originals = {path: path.read_bytes() for path in (self.store / 'layers').iterdir()}
        self.pack('2' * 40)
        self.assertEqual({path: path.read_bytes() for path in originals}, originals)
        self.assertEqual(self.m.file_digest(Path(packed['manifest'])), packed['manifestSha256'])

    def test_new_default_requires_target_before_output(self):
        with self.assertRaisesRegex(ValueError, 'target'):
            self.m.pack(self.source, self.store, self.project, self.assets, 'missing')
        self.assertFalse(self.store.exists())

    def test_exact_target_platform_cache_and_toolchain_fail_before_output(self):
        for field, value in (('platform', 'win32'), ('arch', 'arm64'), ('abi', 'other'), ('node', '24.18.0'), ('libc', 'glibc-2.35')):
            target = {**self.target, 'runtime': {**self.runtime, field: value}}
            with patch.object(self.m, 'runtime_identity', return_value=self.runtime):
                with self.assertRaises(ValueError):
                    self.m.pack(self.source, self.store, self.project, self.assets, 'bad', target=target)
            self.assertFalse(self.store.exists())
        for target in ({**self.target, 'assemblyCacheRoot': '/tmp/cache'},
                       {**self.target, 'toolchain': {'packageManager': 'pnpm@10.0.0'}}):
            with patch.object(self.m, 'runtime_identity', return_value=self.runtime), self.assertRaises(ValueError):
                self.m.pack(self.source, self.store, self.project, self.assets, 'bad', target=target)
            self.assertFalse(self.store.exists())

    def test_windows_build_host_cannot_claim_linux_target(self):
        windows = {**self.runtime, 'platform': 'win32', 'libc': 'non-glibc'}
        with patch.object(self.m, 'runtime_identity', return_value=windows), self.assertRaisesRegex(ValueError, 'Build host Runtime'):
            self.m.pack(self.source, self.store, self.project, self.assets, 'bad', target=self.target)
        self.assertFalse(self.store.exists())

    def test_schema2_same_origin_preserves_asset_bytes_and_binds_index(self):
        original = (self.assets / 'asset-manifest.json').read_bytes()
        packed = self.pack()
        manifest = self.m.parse(Path(packed['manifest']).read_bytes())
        self.assertEqual(manifest['schema'], 2)
        self.assertEqual(manifest['target'], self.target)
        self.assertEqual(manifest['assetDeliveryMode'], 'same-origin-public')
        self.assertIsNone(manifest.get('compiledAssetBaseUrl'))
        self.assertEqual(manifest['generatedPublicLink']['target'], '/opt/zimage/layer-cache/assets/' + self.assets.name)
        self.assertEqual((self.assets / 'asset-manifest.json').read_bytes(), original)
        runtime = self.m.parse((self.store / packed['layers']['runtime']['index']).read_bytes())
        self.assertEqual(runtime['schema'], 2)
        self.assertEqual(runtime['binding']['schema'], 2)
        legacy = {'schema': 1, 'kind': 'runtime', 'binding': {'lockSha256': manifest['lockSha256'], 'runtime': self.runtime}, 'entries': runtime['entries']}
        self.assertNotEqual(packed['layers']['runtime']['identity'], self.m.digest(self.m.canonical(legacy)))

    def test_runtime_reuse_excludes_commit_build_id_env_and_input_roots(self):
        first = self.pack()
        self.put(self.source / (self.dist + 'BUILD_ID'), 'build-two')
        self.config['env']['ZIMAGE_BUILD_SHA'] = 'two'
        self.config['outputFileTracingRoot'] = '/a/different/input/root'
        self.set_config()
        second = self.pack('2' * 40, source_commit='a' * 40)
        self.assertEqual(first['layers']['runtime']['identity'], second['layers']['runtime']['identity'])
        self.assertEqual(first['layers']['assets'], second['layers']['assets'])
        self.assertNotEqual(first['layers']['code']['identity'], second['layers']['code']['identity'])

    def test_same_lock_trace_content_config_and_resolution_changes_change_runtime(self):
        first = self.pack()['layers']['runtime']['identity']
        self.put(self.source / 'node_modules/pkg/extra.js', 'new trace')
        self.assertNotEqual(first, self.pack('2' * 40)['layers']['runtime']['identity'])
        (self.source / 'node_modules/pkg/extra.js').unlink()
        self.put(self.source / 'node_modules/pkg/index.js', 'changed')
        self.assertNotEqual(first, self.pack('3' * 40)['layers']['runtime']['identity'])
        self.put(self.source / 'node_modules/pkg/index.js', 'runtime library')
        self.put(self.project / 'apps/web/next.config.ts', 'changed build source')
        changed = self.pack('4' * 40)['layers']['runtime']['identity']
        self.assertNotEqual(first, changed)
        self.config['transpilePackages'].append('another-package')
        self.set_config()
        self.assertNotEqual(changed, self.pack('5' * 40)['layers']['runtime']['identity'])

    def test_same_origin_rejects_compiled_remote_and_explicit_remote_is_exact(self):
        self.config['images'] = {'remotePatterns': [{'protocol': 'https', 'hostname': 'assets.example.com', 'port': '',
            'pathname': '/static-assets/' + self.assets.name + '/commerce/**', 'search': ''}]}
        self.set_config()
        with self.assertRaisesRegex(ValueError, 'same-origin'):
            self.pack()
        self.assertFalse(self.store.exists())
        packed = self.pack(asset_delivery_mode='remote')
        self.assertEqual(self.m.parse(Path(packed['manifest']).read_bytes())['compiledAssetBaseUrl'], 'https://assets.example.com/static-assets/' + self.assets.name)
        self.config['images']['remotePatterns'][0]['pathname'] = '/static-assets/' + '0' * 64 + '/commerce/**'
        self.set_config()
        with self.assertRaisesRegex(ValueError, 'compiled asset'):
            self.pack('2' * 40, asset_delivery_mode='remote')

    def test_cli_missing_target_fails_before_outputs(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(SCRIPT), 'pack', str(self.source), str(self.store),
            '--project', str(self.project), '--assets', str(self.assets), '--release-id', '1' * 40], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('target', result.stderr)
        self.assertFalse(self.store.exists())


if __name__ == '__main__':
    unittest.main()
