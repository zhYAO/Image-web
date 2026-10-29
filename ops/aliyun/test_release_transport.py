"""Offline portable transport fixtures; no service or network imports."""
import concurrent.futures
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import unittest
from unittest.mock import patch

_spec = importlib.util.spec_from_file_location('transport_fixture', Path(__file__).with_name('test_three_layer_release.py'))
_fixture = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixture)
SCRIPT = Path(__file__).with_name('release-transport.py')


class Transport(_fixture.PortableFixture):
    def setUp(self):
        super().setUp()
        self.assertTrue(SCRIPT.is_file(), 'pure transport module is missing')
        spec = importlib.util.spec_from_file_location('transport_under_test', SCRIPT)
        self.transport = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.transport)
        self.packed = self.pack()
        self.manifest_path = Path(self.packed['manifest'])
        self.sha = self.packed['manifestSha256']
        self.manifest = self.m.parse(self.manifest_path.read_bytes())

    def plan(self, hints=None):
        return self.transport.plan(self.store, self.manifest_path, self.sha, inventory=hints)

    def request(self):
        return self.transport.request(self.store, self.manifest_path, self.sha)

    def bundle(self, name='bundle.tgz', hints=None):
        return self.transport.bundle(self.store, self.manifest_path, self.root / name, self.sha, inventory=hints)

    def test_cold_plan_bundle_and_legacy_all_seven_roundtrip(self):
        plan = self.plan()
        self.assertEqual(len(plan['required']), 7)
        self.assertEqual(len(plan['upload']), 7)
        self.assertEqual(plan['reuse'], [])
        self.assertGreater(plan['rawTransferBytes'], 0)
        self.assertEqual(plan['compressedTransferBytes'], sum(item['bytes'] for item in plan['upload']))
        bundled = self.bundle()
        restored, body, provided = self.transport.unpack_bundle(Path(bundled['bundle']), self.root / 'incoming', '1' * 40, self.sha)
        self.assertEqual(restored, self.manifest)
        self.assertEqual(body, self.manifest_path.read_bytes())
        self.assertEqual(len(provided), 7)
        self.assertEqual(bundled['bytes'], (self.root / 'bundle.tgz').stat().st_size)

    def test_roundtrip_without_python311_hashlib_file_digest(self):
        bundled = self.bundle()
        with patch.dict(vars(self.transport.hashlib)):
            vars(self.transport.hashlib).pop('file_digest', None)
            restored, body, provided = self.transport.unpack_bundle(
                Path(bundled['bundle']), self.root / 'python310-incoming', '1' * 40, self.sha)
        self.assertEqual(restored, self.manifest)
        self.assertEqual(body, self.manifest_path.read_bytes())
        self.assertEqual(len(provided), 7)

    def test_old_schema1_all_seven_archive_remains_consumable(self):
        with patch.object(self.m, 'runtime_identity', return_value=self.runtime):
            packed = self.m.pack(self.source, self.store, self.project, self.assets, '2' * 40,
                                 schema=1, assembly_cache_root=self.root / 'legacy-cache')
        manifest_path = Path(packed['manifest'])
        manifest = self.m.parse(manifest_path.read_bytes())
        files = self.transport.required_files(manifest, '2' * 40, manifest_path.read_bytes())
        archive = self.root / 'legacy-all-seven.tgz'
        with tarfile.open(archive, 'w:gz') as tar:
            for name in sorted(files):
                tar.add(self.store / name, arcname=name, recursive=False)
        restored, _, provided = self.transport.unpack_bundle(archive, self.root / 'old-incoming', '2' * 40, packed['manifestSha256'])
        self.assertEqual(restored['schema'], 1)
        self.assertEqual(len(provided), 7)

    def test_missing_target_and_extra_request_slots_reject_without_store_mutation(self):
        request = self.request()
        found = self.transport.inventory(self.root / 'missing-store', request)
        self.assertEqual(found['files'], {})
        self.assertFalse((self.root / 'missing-store').exists())
        name = self.manifest['layers']['code']['index']
        request['files']['layers/code-' + '0' * 64 + '.json'] = request['files'][name]
        with self.assertRaises(ValueError):
            self.transport.inventory(self.store, request)

    def test_forged_all_hit_hint_remains_advisory_and_returns_omitted_set(self):
        # An untrusted peer can claim exact hashes. Transport may omit those
        # objects, but exposes every omission for trusted-store revalidation.
        hints = self.request()
        bundled = self.bundle(hints=hints)
        manifest, _, provided = self.transport.unpack_bundle(Path(bundled['bundle']), self.root / 'forged-hint', '1' * 40, self.sha)
        required = self.transport.required_files(manifest, '1' * 40)
        self.assertEqual(len(set(required) - set(provided)), 6)
        self.assertTrue(bundled['inventoryIsAdvisory'])

    def test_all_hit_always_sends_manifest_and_partial_inventory_sends_only_missing(self):
        hints = self.transport.inventory(self.store, self.request())
        self.assertEqual(len(hints['files']), 7)
        plan = self.plan(hints)
        self.assertEqual(len(plan['upload']), 1)
        self.assertEqual(len(plan['reuse']), 6)
        self.assertEqual(plan['upload'][0]['path'], 'releases/' + '1' * 40 + '.json')
        bundled = self.bundle(hints=hints)
        _, _, provided = self.transport.unpack_bundle(Path(bundled['bundle']), self.root / 'partial', '1' * 40, self.sha)
        self.assertEqual(set(provided), {'releases/' + '1' * 40 + '.json'})
        missing = self.manifest['layers']['runtime']['archive']
        del hints['files'][missing]
        plan = self.plan(hints)
        self.assertEqual({item['path'] for item in plan['upload']}, {'releases/' + '1' * 40 + '.json', missing})

    def test_stale_inventory_hash_size_and_forged_paths_do_not_match(self):
        hints = self.transport.inventory(self.store, self.request())
        names = [self.manifest['layers'][kind]['archive'] for kind in ('code', 'runtime')]
        hints['files'][names[0]]['sha256'] = '0' * 64
        hints['files'][names[1]]['bytes'] += 1
        plan = self.plan(hints)
        self.assertTrue(set(names).issubset({item['path'] for item in plan['upload']}))
        hints['files']['../../outside'] = {'sha256': '0' * 64, 'bytes': 0}
        with self.assertRaises(ValueError):
            self.plan(hints)

    def test_inventory_only_hashes_requested_bounded_regular_objects(self):
        request = self.request()
        name = self.manifest['layers']['runtime']['archive']
        (self.store / name).write_bytes(b'corrupt')
        found = self.transport.inventory(self.store, request)
        self.assertNotIn(name, found['files'])
        request['files']['arbitrary.txt'] = {'sha256': '0' * 64, 'bytes': 1}
        with self.assertRaises(ValueError):
            self.transport.inventory(self.store, request)

    def test_inventory_cannot_hide_missing_corrupt_or_wrong_trusted_source(self):
        hints = self.transport.inventory(self.store, self.request())
        for mismatch in ('size', 'hash', 'missing'):
            name = self.manifest['layers']['assets']['archive']
            original = (self.store / name).read_bytes()
            if mismatch == 'missing':
                (self.store / name).unlink()
            else:
                (self.store / name).write_bytes(b'x' * (len(original) if mismatch == 'hash' else 1))
            with self.assertRaises((ValueError, FileNotFoundError)):
                self.bundle('must-not-exist.tgz', hints)
            self.assertFalse((self.root / 'must-not-exist.tgz').exists())
            (self.store / name).write_bytes(original)

    def test_code_only_release_reuses_runtime_and_asset_objects(self):
        hints = self.transport.inventory(self.store, self.request())
        self.put(self.source / (self.dist + 'server/chunks/main.js'), 'business changed')
        packed = self.pack('2' * 40)
        hints['releaseSha'] = '2' * 40
        hints['files'].pop('releases/' + '1' * 40 + '.json')
        planned = self.transport.plan(self.store, Path(packed['manifest']), packed['manifestSha256'], hints)
        self.assertEqual(len(planned['reuse']), 4)
        self.assertEqual(len(planned['upload']), 3)

    def test_wrong_manifest_trust_and_size_fail_before_destination(self):
        with self.assertRaisesRegex(ValueError, 'manifest'):
            self.transport.plan(self.store, self.manifest_path, '0' * 64)
        bundled = self.bundle()
        with self.assertRaisesRegex(ValueError, 'manifest'):
            self.transport.unpack_bundle(Path(bundled['bundle']), self.root / 'bad', '1' * 40, '0' * 64)
        self.assertFalse((self.root / 'bad').exists())

    def attack_archive(self, attack):
        full = Path(self.bundle('original.tgz')['bundle'])
        with tarfile.open(full, 'r:gz') as archive:
            members = [(item, archive.extractfile(item).read()) for item in archive]
        out = self.root / 'attacked.tgz'
        with tarfile.open(out, 'w:gz') as archive:
            for index, (item, body) in enumerate(members):
                if attack == 'missing-manifest' and item.name.startswith('releases/'):
                    continue
                if index == 0:
                    if attack == 'link':
                        item.type, item.linkname, item.size = tarfile.SYMTYPE, '/etc/passwd', 0
                    elif attack == 'size':
                        body += b'additional byte'
                        item.size = len(body)
                    elif attack == 'hash':
                        body = b'x' * len(body)
                archive.addfile(item, io.BytesIO(body) if item.isfile() else None)
            if attack == 'duplicate':
                archive.addfile(members[0][0], io.BytesIO(members[0][1]))
            if attack in ('escape', 'extra', 'drive'):
                item = tarfile.TarInfo({'escape': '../escape', 'extra': 'extra.txt', 'drive': 'C:/escape'}[attack])
                item.size = 1
                archive.addfile(item, io.BytesIO(b'x'))
        full.unlink()
        return out

    def test_malicious_outer_members_rejected_without_partial_destination(self):
        for attack in ('escape', 'extra', 'duplicate', 'link', 'size', 'hash', 'missing-manifest', 'drive'):
            with self.subTest(attack=attack):
                archive = self.attack_archive(attack)
                with self.assertRaises(ValueError):
                    self.transport.unpack_bundle(archive, self.root / 'bad', '1' * 40, self.sha)
                self.assertFalse((self.root / 'bad').exists())
                archive.unlink()

    def test_immutable_output_and_concurrent_bundle_publication(self):
        def publish(_):
            try:
                return self.bundle()
            except (ValueError, FileExistsError):
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(publish, range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        original = (self.root / 'bundle.tgz').read_bytes()
        with self.assertRaises(ValueError):
            self.bundle()
        self.assertEqual((self.root / 'bundle.tgz').read_bytes(), original)

    def test_required_files_are_exact_and_manifest_requires_trusted_body(self):
        files = self.transport.required_files(self.manifest, '1' * 40, self.manifest_path.read_bytes())
        self.assertEqual(len(files), 7)
        self.assertEqual(files['releases/' + '1' * 40 + '.json'], (self.sha, len(self.manifest_path.read_bytes())))
        altered = json.loads(json.dumps(self.manifest))
        altered['layers']['runtime']['index'] = 'layers/code-' + altered['layers']['runtime']['identity'] + '.json'
        with self.assertRaises(ValueError):
            self.transport.required_files(altered, '1' * 40)

    def test_cli_plan_and_inventory_roundtrip(self):
        def run(*args):
            result = subprocess.run([sys.executable, '-I', '-B', str(SCRIPT), *map(str, args)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        request = self.root / 'request.json'
        self.put(request, json.dumps(run('request', self.store, self.manifest_path, '--manifest-sha256', self.sha)))
        hints = self.root / 'inventory.json'
        self.put(hints, json.dumps(run('inventory', self.store, request)))
        planned = run('plan', self.store, self.manifest_path, '--manifest-sha256', self.sha, '--inventory', hints)
        self.assertEqual(len(planned['upload']), 1)


if __name__ == '__main__':
    unittest.main()
