"""Portable adapter/CLI logic with mocked privilege, flock, service and native gates.

Metadata presence also uses supported local directory links; not POSIX acceptance.
"""
import copy
from contextlib import ExitStack, nullcontext, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import Mock, patch, call

HERE = Path(__file__).parent
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    # This shim permits imports for pure logic; it cannot exercise locking.
    with patch.dict(sys.modules, {'fcntl': types.SimpleNamespace()}):
        spec.loader.exec_module(module)
    return module

fixture = load('test_three_layer_release')


class AdapterClosure(fixture.PortableFixture):
    def setUp(self):
        super().setUp()
        self.adapter = load('release-three-layer')
        self.transport = load('release-transport')
        self.packed = self.pack()
        self.manifest_path = Path(self.packed['manifest'])
        self.body = self.manifest_path.read_bytes()
        self.manifest = self.m.parse(self.body)
        self.sha = self.manifest['releaseId']
        self.digest = self.packed['manifestSha256']
        self.op = self.adapter.Adapter.__new__(self.adapter.Adapter)
        self.op.root, self.op.uid = self.root / 'host', 0
        self.op.layers, self.op.transport = self.m, self.transport
        self.op.target_check = Mock()
        self.op.install_file = Mock(side_effect=self.install)
        self.trust = patch.object(self.adapter, 'owned')
        self.trust.start()
        self.addCleanup(self.trust.stop)

    def install(self, source, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

    def incoming(self, hint=None):
        result = self.transport.bundle(self.store, self.manifest_path, self.root / 'delta.tgz', self.digest, hint)
        return self.transport.unpack_bundle(Path(result['bundle']), self.root / 'unpacked', self.sha, self.digest)

    def merge(self, provided):
        return self.op.merge_transport(self.root / 'unpacked', self.manifest, self.body, provided, self.sha, self.digest)

    def test_cold_merge_verifies_all_seven_without_rewriting(self):
        _, _, provided = self.incoming()
        self.merge(provided)
        required = self.transport.required_files(self.manifest, self.sha, self.body)
        self.assertEqual(self.op.install_file.call_count, 7)
        for name in required:
            self.assertEqual((self.op.root / 'layer-store' / name).read_bytes(), (self.store / name).read_bytes())

    def test_reuse_delta_and_stale_hint_cannot_omit_missing_objects(self):
        request = self.transport.request(self.store, self.manifest_path, self.digest)
        _, _, provided = self.incoming(request)
        self.assertEqual(len(provided), 1)
        with self.assertRaises((ValueError, OSError)):
            self.merge(provided)
        shutil.copytree(self.store, self.op.root / 'layer-store', dirs_exist_ok=True)
        self.merge(provided)
        self.assertEqual((self.op.root / 'layer-store/releases' / (self.sha + '.json')).read_bytes(), self.body)

    def test_corrupt_existing_store_is_rejected_before_any_publication(self):
        _, _, provided = self.incoming()
        name = self.manifest['layers']['runtime']['archive']
        self.put(self.op.root / 'layer-store' / name, b'corrupt')
        with self.assertRaisesRegex(ValueError, 'size|checksum|digest|mismatch'):
            self.merge(provided)
        self.op.install_file.assert_not_called()

    def test_inventory_missing_is_absent_but_existing_corruption_is_fatal(self):
        request = self.transport.request(self.store, self.manifest_path, self.digest)
        self.assertEqual(self.op.inventory(request)['files'], {})
        shutil.copytree(self.store, self.op.root / 'layer-store')
        self.assertEqual(self.op.inventory(request), request)
        name = self.manifest['layers']['assets']['archive']
        (self.op.root / 'layer-store' / name).write_bytes(b'tamper')
        with self.assertRaises(ValueError):
            self.op.inventory(request)

    def test_inventory_escape_eighth_slot_and_oversized_stdin_rejected(self):
        request = self.transport.request(self.store, self.manifest_path, self.digest)
        for key in ('../escape', 'layers/runtime-' + '0' * 64 + '.tgz'):
            bad = copy.deepcopy(request)
            bad['files'][key] = {'sha256': '0' * 64, 'bytes': 1}
            with self.assertRaises(ValueError):
                self.op.inventory(bad)
        with self.assertRaises(ValueError):
            self.adapter.read_inventory_request(io.BytesIO(b'x' * 16385))

    def test_complete_store_rechecked_after_publication(self):
        _, _, provided = self.incoming()
        def tamper(source, target):
            self.install(source, target)
            if target.suffix == '.tgz':
                target.write_bytes(b'corrupt after publish')
        self.op.install_file.side_effect = tamper
        with self.assertRaises(ValueError):
            self.merge(provided)

    def test_target_gate_rejects_disabled_and_actual_platform_drift(self):
        config_path = self.root / 'target.json'
        target = copy.deepcopy(self.target)
        with patch.object(self.adapter, 'TARGET_CONFIG', config_path), patch.object(self.adapter, 'load_tools', return_value=(self.m, Mock())), \
             patch.object(self.m, 'runtime_identity', return_value=self.runtime):
            self.put(config_path, json.dumps({'enabled': False, 'target': target}))
            with self.assertRaises(ValueError):
                self.adapter.enabled_target_check()
            self.put(config_path, json.dumps({'enabled': True, 'target': target}))
            self.assertEqual(self.adapter.enabled_target_check(), target)
            for key, value in [('node', '24.18.0'), ('abi', '136'), ('platform', 'win32'), ('libc', 'glibc-2.35'), ('arch', 'arm64')]:
                with self.subTest(key=key), patch.object(self.m, 'runtime_identity', return_value={**self.runtime, key: value}), self.assertRaises(ValueError):
                    self.adapter.enabled_target_check()

    def test_initial_empty_checks_all_links_sequence_and_retained_releases(self):
        self.op.root.mkdir()
        self.op.initial_empty()
        for name in ('current', 'previous', 'current.next', 'previous.next', 'last-deployment-run'):
            self.put(self.op.root / name, 'occupied')
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.op.initial_empty()
            (self.op.root / name).unlink()
        self.put(self.op.root / 'releases/retained/.release-sha', 'retained')
        with self.assertRaises(ValueError):
            self.op.initial_empty()

    def test_rollback_validates_layered_target_before_exact_activation(self):
        sha = 'b' * 40
        target = self.op.root / 'releases' / sha
        self.put(target / '.release-sha', sha)
        self.put(target / '.three-layer-release.json', self.body)
        self.op.locked = nullcontext
        self.op.current_target = Mock()
        self.op.service_check = Mock()
        self.op.legacy = Mock()
        self.op.verify_retained_layered = Mock(side_effect=ValueError('cache tampered'))
        with self.assertRaisesRegex(ValueError, 'cache tampered'):
            self.op.rollback(sha)
        self.op.legacy.activate.assert_not_called()
        self.op.verify_retained_layered.side_effect = None
        self.op.rollback(sha)
        self.op.verify_retained_layered.assert_called_with(target, sha)
        self.op.legacy.activate.assert_called_once_with(target, restore_previous_on_failure=False)
        self.assertTrue((target / '.three-layer-release.json').is_file())

    def test_cache_recheck_hashes_actual_runtime_and_original_resource_manifest(self):
        shutil.copytree(self.store, self.op.root / 'layer-store')
        self.op.cache_ownership = Mock()
        with patch.object(self.m, 'verify_tree', side_effect=ValueError('actual cache corrupt')) as verify:
            with self.assertRaisesRegex(ValueError, 'actual cache corrupt'):
                self.op.recheck_caches(self.manifest)
        self.assertTrue(verify.call_args.kwargs['readonly'])
        with patch.object(self.m, 'verify_tree') as verify:
            self.op.recheck_caches(self.manifest)
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(verify.call_args.args[1][-1]['sha256'], self.manifest['assetsVersion'])

    def test_same_sha_retains_first_outer_digest_but_rechecks_every_other_byte(self):
        left, right = self.root / 'retained', self.root / 'candidate'
        for root, outer in ((left, 'a'), (right, 'b')):
            self.put(root / '.archive-sha256', outer * 64)
            self.put(root / '.manifest-sha256', 'c' * 64)
            self.put(root / 'code.js', b'original')
        self.op.uid = left.stat().st_uid
        self.op.compare_retained(left, right)
        (left / 'code.js').write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            self.op.compare_retained(left, right)

    def test_same_sha_requires_archive_digest_on_both_roots(self):
        left, right = self.root / 'retained', self.root / 'candidate'
        for root, outer in ((left, 'a'), (right, 'b')):
            self.put(root / '.archive-sha256', outer * 64)
            self.put(root / 'code.js', b'original')
        self.op.uid = left.stat().st_uid
        for root in (left, right):
            marker = root / '.archive-sha256'
            body = marker.read_bytes()
            marker.unlink()
            with self.subTest(root=root.name), self.assertRaises((ValueError, OSError)):
                self.op.compare_retained(left, right)
            marker.write_bytes(body)
        self.op.compare_retained(left, right)
        self.assertEqual((left / '.archive-sha256').read_text(), 'a' * 64)

    def test_same_sha_rejects_malformed_or_nonregular_archive_digest(self):
        left, right = self.root / 'retained', self.root / 'candidate'
        for root in (left, right):
            self.put(root / '.archive-sha256', 'a' * 64)
            self.put(root / 'code.js', b'original')
        self.op.uid = left.stat().st_uid
        for body in ('', 'A' * 64, 'a' * 63, 'a' * 65, 'not-a-digest'):
            (left / '.archive-sha256').write_text(body)
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.op.compare_retained(left, right)
        (left / '.archive-sha256').write_text('a' * 64)
        read_regular = self.m.read_regular
        def refuse_symlink(path):
            if Path(path) == left / '.archive-sha256':
                raise ValueError('symlink digest fixture')
            return read_regular(path)
        with patch.object(self.m, 'read_regular', side_effect=refuse_symlink), self.assertRaisesRegex(ValueError, 'symlink'):
            self.op.compare_retained(left, right)

    def test_actual_compiled_same_origin_config_is_required_for_schema2(self):
        manifest = copy.deepcopy(self.manifest)
        config = {**self.config, 'distDir': '.next', 'env': {'ZIMAGE_BUILD_SHA': self.sha}}
        candidate = self.root / 'candidate'
        self.put(candidate / 'apps/web/.next/required-server-files.json', json.dumps({'config': config}))
        self.put(candidate / 'apps/web/.next/BUILD_ID', self.sha)
        self.op.validate_candidate(candidate, manifest, self.sha, [])
        config['images'] = {'remotePatterns': [{'protocol': 'https', 'hostname': 'www.zimage.store', 'port': '', 'search': '',
                                               'pathname': '/static-assets/' + manifest['assetsVersion'] + '/commerce/**'}]}
        self.put(candidate / 'apps/web/.next/required-server-files.json', json.dumps({'config': config}))
        with self.assertRaisesRegex(ValueError, 'same-origin'):
            self.op.validate_candidate(candidate, manifest, self.sha, [])


class LegacyFullFormat(unittest.TestCase):
    """Real full CLI dispatch and local files; no privilege, flock or service calls."""
    def setUp(self):
        self.legacy = load('release')
        self.tmp = tempfile.TemporaryDirectory(prefix='zimage-full-format-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.releases, self.incoming = self.root / 'releases', self.root / 'incoming'
        self.releases.mkdir()
        self.incoming.mkdir()
        self.sha = 'b' * 40
        self.target = self.releases / self.sha
        self.target.mkdir()
        (self.target / '.release-sha').write_text(self.sha + '\n')
        (self.target / '.archive-sha256').write_text('a' * 64 + '\n')
        archive = self.incoming / (self.sha + '.tgz')
        with tarfile.open(archive, 'w:gz') as stream:
            body = b'full server'
            member = tarfile.TarInfo('apps/web/server.js')
            member.size = len(body)
            stream.addfile(member, io.BytesIO(body))
        self.digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in {'ROOT': self.root, 'RELEASES': self.releases, 'INCOMING': self.incoming,
                            'CURRENT': self.root / 'current', 'PREVIOUS': self.root / 'previous'}.items():
            self.stack.enter_context(patch.object(self.legacy, name, value))
        self.stack.enter_context(patch.object(self.legacy.os, 'geteuid', return_value=0, create=True))
        self.locked = False
        def lock(stream, mode):
            self.assertEqual(Path(stream.name), self.root / 'deploy.lock')
            self.assertEqual(mode, 1)
            self.locked = True
        self.stack.enter_context(patch.object(self.legacy, 'fcntl', types.SimpleNamespace(flock=lock, LOCK_EX=1)))
        self.activation_original = self.legacy.activate
        self.activation = self.stack.enter_context(patch.object(self.legacy, 'activate'))

    def invoke(self, *args):
        self.locked = False
        with patch.object(self.legacy.sys, 'argv', ['release.py', *args]), redirect_stdout(io.StringIO()):
            self.legacy.main()

    def refuse(self, *args):
        before = {p.relative_to(self.target): p.read_bytes() for p in self.target.iterdir() if p.is_file()}
        with self.assertRaisesRegex(ValueError, 'layered|format conflict'):
            self.invoke(*args)
        self.assertTrue(self.locked)
        self.activation.assert_not_called()
        self.assertFalse((self.root / 'last-deployment-run').exists())
        self.assertEqual({p.relative_to(self.target): p.read_bytes() for p in self.target.iterdir() if p.is_file()}, before)

    def test_full_deploy_refuses_layered_sha_retained_after_failed_activation(self):
        (self.target / '.three-layer-release.json').write_text('{"schema":2}')
        (self.target / '.manifest-sha256').write_text('c' * 64)
        # The shared primitive restores old current and deliberately leaves the
        # published layered candidate. The following full CLI must not reuse it.
        current = Mock()
        old = self.releases / ('a' * 40)
        current.resolve.return_value = old
        with patch.object(self.legacy, 'CURRENT', current), patch.object(self.legacy, 'font_preflight'), redirect_stdout(io.StringIO()), \
             patch.object(self.legacy, 'switch') as switch, \
             patch.object(self.legacy, 'wait_healthy', side_effect=[RuntimeError('failed health'), None]):
            with self.assertRaisesRegex(RuntimeError, 'failed health'):
                self.activation_original(self.target)
            self.assertEqual(switch.call_args_list, [call(self.target), call(old)])
        self.refuse('deploy', self.sha, self.digest, '2')

    def test_full_deploy_refuses_layered_sha_with_disabled_target_or_damaged_store(self):
        (self.target / '.three-layer-release.json').write_text('{"schema":2}')
        (self.target / '.manifest-sha256').write_text('c' * 64)
        for state in ('disabled', 'missing-store', 'corrupt-store'):
            with self.subTest(state=state):
                (self.root / 'target.json').write_text(json.dumps({'enabled': state != 'disabled'}))
                store = self.root / 'layer-store'
                if state == 'corrupt-store':
                    store.mkdir()
                    (store / 'runtime.tgz').write_bytes(b'corrupt closure')
                self.refuse('deploy', self.sha, self.digest, '2')

    def test_full_deploy_and_rollback_refuse_orphan_or_nonregular_layer_metadata(self):
        for name in ('.three-layer-release.json', '.manifest-sha256'):
            marker = self.target / name
            for kind in ('file', 'directory'):
                marker.write_text('damaged') if kind == 'file' else marker.mkdir()
                try:
                    for args in (('deploy', self.sha, self.digest, '2'), ('rollback', self.sha)):
                        with self.subTest(name=name, kind=kind, mode=args[0]):
                            self.refuse(*args)
                finally:
                    marker.unlink() if kind == 'file' else marker.rmdir()

    def test_full_cli_refuses_dangling_metadata_by_presence_without_dereference(self):
        real_presence = self.legacy.os.path.lexists
        for name in ('.three-layer-release.json', '.manifest-sha256'):
            marker = self.target / name
            # Pure presence regression, including hosts without file-link privilege.
            with patch.object(self.legacy.os.path, 'lexists',
                    side_effect=lambda path: Path(path) == marker or real_presence(path)):
                self.assertFalse(marker.exists())
                for args in (('deploy', self.sha, self.digest, '2'), ('rollback', self.sha)):
                    with self.subTest(name=name, mode=args[0]):
                        self.refuse(*args)

    def test_full_rollback_previous_refuses_layered_target(self):
        (self.target / '.three-layer-release.json').write_text('{"schema":2}')
        previous = Mock()
        previous.resolve.return_value = self.target
        with patch.object(self.legacy, 'PREVIOUS', previous):
            self.refuse('rollback', 'previous')

    def test_full_cli_refuses_actual_dangling_layer_metadata(self):
        for name in ('.three-layer-release.json', '.manifest-sha256'):
            marker, destination = self.target / name, self.root / 'link-target'
            destination.mkdir()
            junction = False
            try:
                marker.symlink_to(destination, target_is_directory=True)
            except OSError:
                if os.name != 'nt':
                    raise
                import _winapi
                _winapi.CreateJunction(str(destination), str(marker))
                junction = True
            try:
                destination.rmdir()
                self.assertFalse(marker.exists())
                self.assertTrue(os.path.lexists(marker))
                for args in (('deploy', self.sha, self.digest, '2'), ('rollback', self.sha)):
                    with self.subTest(name=name, mode=args[0], junction=junction):
                        self.refuse(*args)
            finally:
                marker.rmdir() if junction else marker.unlink()

    def test_full_archive_cannot_introduce_layered_format_metadata(self):
        for name in ('.three-layer-release.json', '.manifest-sha256'):
            archive = self.root / 'reserved.tgz'
            with tarfile.open(archive, 'w:gz') as stream:
                member = tarfile.TarInfo(name)
                member.size = 1
                stream.addfile(member, io.BytesIO(b'x'))
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Reserved release metadata'):
                self.legacy.extract_release(archive, self.root / name)

    def test_full_deploy_refuses_nested_layer_marker_before_retained_publication(self):
        for path in self.target.iterdir():
            path.unlink()
        self.target.rmdir()
        archive = self.incoming / (self.sha + '.tgz')
        for name in ('.three-layer-release.json', '.manifest-sha256'):
            # No explicit parent directory member: extraction creates it.
            with tarfile.open(archive, 'w:gz') as stream:
                for member_name in ('apps/web/server.js', name + '/nested'):
                    member = tarfile.TarInfo(member_name)
                    member.size = 1
                    stream.addfile(member, io.BytesIO(b'x'))
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            try:
                # Cache-link creation is an external POSIX boundary, not the
                # metadata/publication behavior under test on this host.
                with self.subTest(name=name), patch.object(Path, 'symlink_to'), \
                     self.assertRaisesRegex(ValueError, 'layered|format conflict'):
                    self.invoke('deploy', self.sha, digest, '2')
                self.activation.assert_not_called()
                self.assertFalse(self.target.exists())
                self.assertFalse((self.root / 'last-deployment-run').exists())
            finally:
                if self.target.exists():
                    shutil.rmtree(self.target)

    def test_valid_full_reuse_and_rollback_keep_intended_behavior(self):
        retained = (self.target / '.archive-sha256').read_bytes()
        self.invoke('deploy', self.sha, self.digest, '2')
        self.assertTrue(self.locked)
        self.activation.assert_called_once_with(self.target)
        self.assertEqual((self.root / 'last-deployment-run').read_text(), '2\n')
        self.assertEqual((self.target / '.archive-sha256').read_bytes(), retained)
        self.activation.reset_mock()
        self.invoke('rollback', self.sha)
        self.activation.assert_called_once_with(self.target, restore_previous_on_failure=False)


class ActivationLogic(unittest.TestCase):
    def setUp(self):
        self.adapter = load('release-three-layer')
        self.legacy = load('release')

    def test_same_origin_requires_schema2_and_actual_compiled_contract(self):
        op = self.adapter.Adapter.__new__(self.adapter.Adapter)
        op.root = PurePosixPath('/opt/zimage')
        op.layers = Mock()
        manifest = {'schema': 2, 'releaseId': 'a' * 40, 'productionReady': False, 'distDir': '.next',
                    'build': dict.fromkeys(('sourceCommit', 'marker', 'buildId'), 'a' * 40),
                    'assetsVersion': 'b' * 64, 'assemblyCacheRoot': '/opt/zimage/layer-cache',
                    'compiledAssetBaseUrl': None, 'assetDeliveryMode': 'same-origin-public'}
        op.validate_manifest(manifest, 'a' * 40)
        for key, value in [('schema', 1), ('compiledAssetBaseUrl', 'https://other.invalid'), ('assetDeliveryMode', 'unknown')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                op.validate_manifest({**manifest, key: value}, 'a' * 40)

    def test_initial_health_failure_stops_only_owned_current_and_reraises(self):
        target = Path('candidate')
        current = Mock()
        current.is_symlink.return_value = True
        current.resolve.return_value = target
        runner = Mock()
        with patch.object(self.legacy, 'CURRENT', current), patch.object(self.legacy, 'font_preflight') as native, \
             patch.object(self.legacy, 'switch') as switch, patch.object(self.legacy, 'wait_healthy', side_effect=RuntimeError('health failed')), \
             patch.object(self.legacy.os.path, 'lexists', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'health failed'):
                self.legacy.activate_initial(target, runner=runner)
        native.assert_called_once_with(target)
        switch.assert_called_once_with(target)
        runner.assert_called_once_with(['/usr/bin/systemctl', 'stop', 'zimage'], check=True)
        current.unlink.assert_called_once_with()

    def test_initial_failure_never_unlinks_another_current(self):
        current = Mock()
        current.is_symlink.return_value = True
        current.resolve.return_value = Path('someone-else')
        with patch.object(self.legacy, 'CURRENT', current), patch.object(self.legacy, 'font_preflight'), \
             patch.object(self.legacy, 'switch', side_effect=RuntimeError('restart failed')), \
             patch.object(self.legacy.os.path, 'lexists', return_value=False):
            with self.assertRaises(RuntimeError):
                self.legacy.activate_initial(Path('candidate'), runner=Mock())
        current.unlink.assert_not_called()

    def test_initial_guard_rejects_any_existing_link_sequence_or_release(self):
        op = self.adapter.Adapter.__new__(self.adapter.Adapter)
        op.root = Path('unused-fixture')
        with patch.object(self.adapter.os.path, 'lexists', return_value=True):
            with self.assertRaises(ValueError):
                op.initial_empty()

    def test_normal_activate_preserves_exact_old_recovery(self):
        old, target = Path('old'), Path('new')
        current = Mock()
        current.resolve.return_value = old
        with patch.object(self.legacy, 'CURRENT', current), patch.object(self.legacy, 'font_preflight') as native, \
             patch.object(self.legacy, 'switch') as switch, patch.object(self.legacy, 'wait_healthy', side_effect=[RuntimeError('bad'), None]):
            with self.assertRaisesRegex(RuntimeError, 'bad'):
                self.legacy.activate(target)
        self.assertEqual(switch.call_args_list, [call(target), call(old)])
        self.assertEqual(native.call_args_list, [call(target), call(old)])

    def test_trust_closure_includes_transport_before_import(self):
        self.assertIn('release-transport.py', self.adapter.TOOLS)
        with patch.object(self.adapter, 'owned', side_effect=ValueError('untrusted')), \
             patch.object(self.adapter.importlib.util, 'spec_from_file_location') as imports:
            with self.assertRaises(ValueError):
                self.adapter.load_tools(strict=True)
        imports.assert_not_called()


if __name__ == '__main__':
    unittest.main()
