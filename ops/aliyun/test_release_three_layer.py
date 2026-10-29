"""Temporary local fixtures. No systemd, production, install, build or network calls."""
import copy
try:
    import fcntl
except ModuleNotFoundError:
    fcntl = None
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile
import tempfile
import types
import unittest
from unittest.mock import Mock, call, patch

SCRIPT = Path(__file__).with_name('release-three-layer.py')
SHA = 'a' * 40


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(os.name == 'posix' and fcntl is not None and hasattr(fcntl, 'flock'),
                     'Requires real Linux/glibc, POSIX ownership, flock and symlink assembly')
class RootThreeLayerAdapter(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'Production adapter is missing')
        self.adapter = load(SCRIPT, 'production_adapter_test')
        self.layers = load(SCRIPT.with_name('three-layer-release.py'), 'production_layer_test')
        self.legacy = load(SCRIPT.with_name('release.py'), 'production_legacy_test')
        self.temp = tempfile.TemporaryDirectory(prefix='three-layer-adapter-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.host = self.root / 'host'
        self.source, self.project = self.root / 'source', self.root / 'project'
        self.store, self.cache = self.host / 'layer-store', self.host / 'layer-cache'
        self.incoming = self.host / 'incoming'
        self.put(self.project / 'pnpm-lock.yaml', 'locked dependency bytes')
        resource_files = {'commerce/example.webp': b'public image bytes', 'fonts/NotoSansCJKsc-Regular.otf': b'regular',
                          'fonts/NotoSansCJKsc-Bold.otf': b'bold', 'fonts/LICENSE.txt': b'license', 'fonts/README.md': b'provenance'}
        files = [{'path': name, 'kind': 'font' if name.startswith('fonts/') else 'public', 'bytes': len(value),
                  'sha256': self.layers.digest(value), 'mime': 'font/otf' if name.endswith('.otf') else 'text/plain'} for name, value in sorted(resource_files.items())]
        body = self.layers.canonical({'schema': 1, 'productionReady': False, 'files': files})
        self.assets = self.root / 'resources' / self.layers.digest(body)
        for name, value in resource_files.items():
            self.put(self.assets / name, value)
        self.put(self.assets / 'asset-manifest.json', body)
        config = {'distDir': '.next', 'env': {'ZIMAGE_BUILD_SHA': SHA}, 'images': {'remotePatterns': [
            {'protocol': 'https', 'hostname': 'www.zimage.store', 'port': '', 'search': '', 'pathname': f'/static-assets/{self.assets.name}/commerce/**'}]}}
        self.put(self.source / 'apps/web/.next/required-server-files.json', json.dumps({'config': config}))
        self.put(self.source / 'apps/web/.next/BUILD_ID', SHA)
        self.put(self.source / 'apps/web/.next/server/chunks/server.js', 'server business')
        self.put(self.source / 'apps/web/.next/static/chunks/client.js', 'client business')
        self.put(self.source / 'apps/web/server.js', 'standalone executable fixture')
        self.put(self.source / 'packages/domain/index.js', 'workspace business')
        self.put(self.source / 'node_modules/pkg/index.js', 'dependency')
        link = self.source / 'apps/web/node_modules/domain'
        link.parent.mkdir(parents=True)
        link.symlink_to('../../../packages/domain')
        self.producer = self.root / 'producer-store'
        self.packed = self.layers.pack(self.source, self.producer, self.project, self.assets, SHA,
                                       source_commit=SHA, assembly_cache_root=self.cache, schema=1)
        self.incoming.mkdir(parents=True)
        self.bundle = self.incoming / (SHA + '.layers.tgz')
        self.transport = self.adapter.bundle(self.producer, Path(self.packed['manifest']), self.bundle, self.packed['manifestSha256'])
        old = self.host / 'releases' / ('b' * 40)
        self.put(old / '.release-sha', 'b' * 40)
        (self.host / 'current').symlink_to(old)
        (self.host / 'cache').mkdir()
        self.native, self.service = Mock(), Mock()
        self.operation = self.adapter.Adapter(self.host, self.layers, self.legacy, native_check=self.native, service_check=self.service,
                                             target_check=Mock())
        self.real_activate = self.legacy.activate
        self.activation = patch.object(self.legacy, 'activate')
        self.activate = self.activation.start()
        self.addCleanup(self.activation.stop)

    @staticmethod
    def put(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value.encode() if isinstance(value, str) else value)

    def deploy(self, run='1'):
        return self.operation.deploy(SHA, self.transport['outerSha256'], self.packed['manifestSha256'], run)

    def test_local_bundle_and_deploy_publish_without_rewriting_manifest(self):
        with tarfile.open(self.bundle, 'r:gz') as archive:
            self.assertEqual(len(archive.getmembers()), 7)
            self.assertTrue(all(item.isfile() for item in archive))
        report = self.deploy()
        target = self.host / 'releases' / SHA
        self.assertFalse(report['productionReady'])
        self.assertEqual((target / '.three-layer-release.json').read_bytes(), Path(self.packed['manifest']).read_bytes())
        self.assertEqual((target / 'apps/web/public/commerce/example.webp').read_bytes(), b'public image bytes')
        self.assertEqual(os.readlink(target / 'apps/web/.next/cache'), str(self.host / 'cache'))
        env = target / '.runtime-assets.env'
        self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)
        self.assertEqual(env.read_text().splitlines(), [f'ZIMAGE_SHARED_FONT_DIR={self.cache}/assets/{self.assets.name}/fonts', f'ZIMAGE_STATIC_ASSET_SHA256={self.assets.name}'])
        self.native.assert_called_once()
        self.activate.assert_called_once_with(target)
        self.assertEqual((self.host / 'last-deployment-run').read_text(), '1\n')
        self.assertTrue((self.host / 'releases' / ('b' * 40)).exists())

    def test_no_overwrite_bundle_and_existing_release_content_rechecked(self):
        with self.assertRaises((ValueError, FileExistsError)):
            self.adapter.bundle(self.producer, Path(self.packed['manifest']), self.bundle, self.packed['manifestSha256'])
        self.deploy()
        self.activate.reset_mock()
        target = self.host / 'releases' / SHA
        self.put(target / 'apps/web/.next/static/chunks/client.js', 'tampered retained business')
        with self.assertRaisesRegex(ValueError, 'retained|Existing'):
            self.deploy('2')
        self.activate.assert_not_called()
        self.assertEqual((self.host / 'last-deployment-run').read_text(), '1\n')

    def test_wrong_outer_or_manifest_digest_blocks_activation(self):
        for outer, manifest in [('0' * 64, self.packed['manifestSha256']), (self.transport['outerSha256'], '0' * 64)]:
            with self.assertRaisesRegex(ValueError, '[Cc]hecksum|[Dd]igest'):
                self.operation.deploy(SHA, outer, manifest, '1')
        self.activate.assert_not_called()
        self.assertFalse((self.host / 'releases' / SHA).exists())

    def test_incoming_symlink_and_extra_escape_outer_members_are_rejected(self):
        saved = self.root / 'saved-bundle'
        shutil.copyfile(self.bundle, saved)
        self.bundle.unlink()
        self.bundle.symlink_to(saved)
        with self.assertRaises((ValueError, OSError)):
            self.deploy()
        self.bundle.unlink()
        for name, link in [('extra.txt', None), ('../escaped', None), ('releases/link', '/etc/passwd')]:
            shutil.copyfile(saved, self.bundle)
            with tarfile.open(saved, 'r:gz') as reader:
                members = [(item, reader.extractfile(item).read()) for item in reader]
            with tarfile.open(self.bundle, 'w:gz') as writer:
                for item, value in members:
                    writer.addfile(item, io.BytesIO(value))
                extra = tarfile.TarInfo(name)
                if link:
                    extra.type, extra.linkname = tarfile.SYMTYPE, link
                    writer.addfile(extra)
                else:
                    extra.size = 1
                    writer.addfile(extra, io.BytesIO(b'x'))
            with self.assertRaisesRegex(ValueError, 'outer|Outer|payload|archive|Archive|member|members|Unsafe'):
                self.operation.deploy(SHA, self.layers.file_digest(self.bundle), self.packed['manifestSha256'], '1')
            self.bundle.unlink()
        self.activate.assert_not_called()
        self.assertFalse((self.root / 'escaped').exists())

    def test_qa_identity_or_domain_is_never_promoted(self):
        original = json.loads(Path(self.packed['manifest']).read_bytes())
        for mutation in [('marker', 'qa-marker'), ('sourceCommit', 'c' * 40), ('buildId', 'qa-build')]:
            manifest = copy.deepcopy(original)
            manifest['build'][mutation[0]] = mutation[1]
            with self.assertRaisesRegex(ValueError, 'production|Production'):
                self.operation.validate_manifest(manifest, SHA)
        for key, value in [('distDir', '.next-build-qa'), ('compiledAssetBaseUrl', 'https://assets.qa.invalid/static-assets/' + self.assets.name), ('productionReady', True)]:
            manifest = copy.deepcopy(original)
            manifest[key] = value
            with self.assertRaisesRegex(ValueError, 'production|Production'):
                self.operation.validate_manifest(manifest, SHA)

    def test_native_or_health_failure_never_records_success(self):
        self.native.side_effect = RuntimeError('native failed')
        with self.assertRaisesRegex(RuntimeError, 'native failed'):
            self.deploy()
        self.activate.assert_not_called()
        self.assertFalse((self.host / 'last-deployment-run').exists())
        self.native.side_effect = None
        self.activate.side_effect = RuntimeError('strict TLS unhealthy; old restored')
        with self.assertRaisesRegex(RuntimeError, 'strict TLS'):
            self.deploy('2')
        self.assertFalse((self.host / 'last-deployment-run').exists())

    def test_old_run_and_invalid_current_block_before_activation(self):
        self.put(self.host / 'last-deployment-run', '9\n')
        with self.assertRaisesRegex(ValueError, 'run|older'):
            self.deploy('8')
        self.activate.assert_not_called()
        (self.host / 'current').unlink()
        (self.host / 'current').symlink_to(self.host / 'cache')
        with self.assertRaisesRegex(ValueError, 'current|Current'):
            self.deploy('10')

    def test_explicit_rollback_uses_exact_retained_target_without_reverse_recovery(self):
        original = self.host / 'releases' / ('b' * 40)
        self.operation.rollback('b' * 40)
        self.activate.assert_called_once_with(original, restore_previous_on_failure=False)
        for value in ('previous', '../current', 'qa-name'):
            with self.assertRaises(ValueError):
                self.operation.rollback(value)

    def test_native_probe_drops_privileges_and_does_not_inherit_secrets(self):
        runner = Mock(return_value=types.SimpleNamespace(returncode=0, stdout='{"native":true,"fonts":2,"codecs":6}\n', stderr=''))
        self.adapter.native_probe(self.host / 'candidate', {'ZIMAGE_SHARED_FONT_DIR': str(self.cache / 'assets' / self.assets.name / 'fonts'), 'ZIMAGE_STATIC_ASSET_SHA256': self.assets.name}, runner=runner)
        args, kwargs = runner.call_args
        self.assertEqual(args[0][:4], ['/usr/sbin/runuser', '--user', 'zimage', '--'])
        self.assertIn('/usr/bin/env', args[0])
        self.assertIn('-i', args[0])
        self.assertEqual(kwargs['cwd'], self.host / 'candidate/apps/web')
        runner.return_value.stdout = '{"native":true,"fonts":2}\n'
        with self.assertRaisesRegex(RuntimeError, 'native/font'):
            self.adapter.native_probe(self.host / 'candidate', {'ZIMAGE_SHARED_FONT_DIR': str(self.cache / 'assets' / self.assets.name / 'fonts'), 'ZIMAGE_STATIC_ASSET_SHA256': self.assets.name}, runner=runner)

    def test_same_lock_as_legacy_is_exclusive_and_symlink_lock_is_rejected(self):
        with self.operation.locked():
            with (self.host / 'deploy.lock').open('a') as other:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (self.host / 'deploy.lock').unlink()
        (self.host / 'deploy.lock').symlink_to(self.project / 'pnpm-lock.yaml')
        with self.assertRaisesRegex(ValueError, 'root-managed'):
            self.deploy()
        self.assertEqual((self.project / 'pnpm-lock.yaml').read_text(), 'locked dependency bytes')

    def test_real_legacy_health_failure_restores_exact_old_target_and_stays_failed(self):
        old = (self.host / 'current').resolve()
        new = self.host / 'releases' / SHA
        def switch(target):
            (self.host / 'current').unlink()
            (self.host / 'current').symlink_to(target)
        with patch.object(self.legacy, 'font_preflight'), patch.object(self.legacy, 'activate', wraps=self.real_activate), \
             patch.object(self.legacy, 'switch', side_effect=switch) as switches, \
             patch.object(self.legacy, 'wait_healthy', side_effect=[RuntimeError('new TLS failed'), None]) as health:
            with self.assertRaisesRegex(RuntimeError, 'new TLS failed'):
                self.deploy()
            self.assertEqual(switches.call_args_list, [call(new), call(old)])
            self.assertEqual(health.call_args_list, [call(new), call(old)])
        self.assertEqual((self.host / 'current').resolve(), old)
        self.assertFalse((self.host / 'last-deployment-run').exists())
        with patch.object(self.legacy, 'font_preflight'), patch.object(self.legacy, 'activate', wraps=self.real_activate), \
             patch.object(self.legacy, 'switch', side_effect=switch), \
             patch.object(self.legacy, 'wait_healthy', side_effect=[RuntimeError('new failed'), RuntimeError('old recovery failed')]):
            with self.assertRaisesRegex(RuntimeError, 'old recovery failed'):
                self.deploy('2')
        self.assertEqual((self.host / 'current').resolve(), old)
        self.assertFalse((self.host / 'last-deployment-run').exists())

    def test_import_policy_guard_runs_before_any_reviewed_tool_import(self):
        checked = []
        def trust(path, *args, **kwargs):
            checked.append(Path(path).name)
            if Path(path).name == 'release-public-policy.json':
                raise ValueError('untrusted policy fixture')
        with patch.object(self.adapter, 'owned', side_effect=trust), \
             patch.object(self.adapter.importlib.util, 'spec_from_file_location') as imports:
            with self.assertRaisesRegex(ValueError, 'untrusted policy'):
                self.adapter.load_tools(strict=True)
            imports.assert_not_called()
        self.assertTrue(set(self.adapter.TOOLS).issubset(checked))

    def test_native_or_wrong_runtime_cannot_activate_with_missing_resource(self):
        runtime = self.layers.runtime_identity()
        with patch.object(self.layers, 'runtime_identity', return_value={**runtime, 'libc': 'glibc-other'}):
            with self.assertRaises(ValueError):
                self.deploy()
        self.activate.assert_not_called()
        self.assertFalse((self.host / 'releases' / SHA).exists())

    def test_managed_next_cache_link_cannot_turn_an_incoming_link_external(self):
        (self.source / 'cache-leak').symlink_to('apps/web/.next/cache/missing')
        producer = self.root / 'producer-two'
        packed = self.layers.pack(self.source, producer, self.project, self.assets, SHA, source_commit=SHA, assembly_cache_root=self.cache, schema=1)
        self.bundle.unlink()
        transport = self.adapter.bundle(producer, Path(packed['manifest']), self.bundle, packed['manifestSha256'])
        with self.assertRaisesRegex(ValueError, 'symlink.*escapes'):
            self.operation.deploy(SHA, transport['outerSha256'], packed['manifestSha256'], '1')
        self.activate.assert_not_called()
        self.assertFalse((self.host / 'releases' / SHA).exists())

    def test_non_root_cli_cannot_reach_privileged_tool_import(self):
        with patch.object(self.adapter.sys, 'argv', ['adapter', 'deploy', SHA, '0' * 64, '1' * 64, '1']), \
             patch.object(self.adapter.os, 'geteuid', return_value=1000), \
             patch.object(self.adapter, 'load_tools') as imports:
            with self.assertRaisesRegex(RuntimeError, 'root'):
                self.adapter.main()
            imports.assert_not_called()

    def test_current_must_name_a_real_release_not_a_second_symlink_alias(self):
        old = (self.host / 'current').resolve()
        alias = self.host / 'releases' / ('c' * 40)
        alias.symlink_to(old)
        (self.host / 'current').unlink()
        (self.host / 'current').symlink_to(alias)
        with self.assertRaisesRegex(ValueError, 'Current|current'):
            self.deploy()
        self.activate.assert_not_called()

    def test_manifest_only_delta_requires_actual_complete_store_and_rechecks_cache(self):
        self.deploy()
        self.activate.reset_mock()
        request = self.operation.transport.request(self.producer, Path(self.packed['manifest']), self.packed['manifestSha256'])
        self.bundle.unlink()
        self.transport = self.adapter.bundle(self.producer, Path(self.packed['manifest']), self.bundle,
                                             self.packed['manifestSha256'], inventory=request)
        with tarfile.open(self.bundle, 'r:gz') as tar:
            self.assertEqual(len(tar.getmembers()), 1)
        self.deploy('2')
        self.activate.assert_called_once()
        cache_file = next(path for path in (self.cache / 'runtime').rglob('index.js') if path.is_file())
        cache_file.chmod(0o644)
        cache_file.write_bytes(b'tampered cache')
        self.activate.reset_mock()
        with self.assertRaises(ValueError):
            self.deploy('3')
        self.activate.assert_not_called()

    def test_forged_hit_inventory_on_empty_target_blocks_before_candidate(self):
        request = self.operation.transport.request(self.producer, Path(self.packed['manifest']), self.packed['manifestSha256'])
        self.bundle.unlink()
        self.transport = self.adapter.bundle(self.producer, Path(self.packed['manifest']), self.bundle,
                                             self.packed['manifestSha256'], inventory=request)
        with self.assertRaises((ValueError, OSError)):
            self.deploy()
        self.activate.assert_not_called()
        self.assertFalse((self.host / 'releases' / SHA).exists())

    def test_retained_layered_rollback_verifies_store_and_keeps_all_references(self):
        self.deploy()
        target = self.host / 'releases' / SHA
        retained = (target / '.runtime-assets.env').read_bytes()
        self.activate.reset_mock()
        self.operation.rollback(SHA)
        self.activate.assert_called_once_with(target, restore_previous_on_failure=False)
        self.assertEqual((target / '.runtime-assets.env').read_bytes(), retained)
        self.assertTrue((self.host / 'releases' / ('b' * 40)).exists())
        runtime_blob = self.store / self.layers.parse(Path(self.packed['manifest']).read_bytes())['layers']['runtime']['archive']
        runtime_blob.chmod(0o644)
        runtime_blob.write_bytes(b'tampered immutable blob')
        self.activate.reset_mock()
        with self.assertRaises(ValueError):
            self.operation.rollback(SHA)
        self.activate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
