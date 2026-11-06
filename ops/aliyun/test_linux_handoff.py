"""Offline handoff guards; no Git mutation, credential contents, install or build.

Git state fixtures are mocked. The one real Git query reads candidate path names
only, so it also catches a newly added source extension needing explicit review.
"""
import argparse
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('linux-handoff.py')
SPEC = importlib.util.spec_from_file_location('linux_handoff_under_test', SCRIPT)
HANDOFF = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HANDOFF)
FIXTURE_COMMIT = '1' * 40
FIXTURE_TREE = '2' * 40
REVIEWED_ADAPTER_SHA256 = '3633c92e6785ab6ae4a98133fe7ddbec3174a3a236471f51daebe49a3f2ebb7f'


def credential_name(name):
    leaf = Path(name).name
    return leaf.startswith('.env') or leaf in {'.npmrc', '.netrc'}


class HandoffFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='linux-handoff-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.source = self.base / 'source'
        self.source.mkdir()
        self.names = ['README.md', 'ops/aliyun/fixture.py']
        for name in self.names:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('non-sensitive fixture: ' + name + '\n')
        self.status = b''
        self.changed = []
        self.untracked = []
        self.deletions = []
        self.head = FIXTURE_COMMIT

    def git(self, root, *args):
        self.assertEqual(root, self.source)
        if args == ('ls-files', '-z', '--cached', '--others', '--exclude-standard'):
            names = self.names
        elif args == ('ls-files', '--others', '--exclude-standard', '-z'):
            names = self.untracked
        elif args == ('diff', '--no-renames', '--diff-filter=D', '--name-only', '-z', 'HEAD'):
            names = self.deletions
        elif args == ('diff', '--no-renames', '--name-only', '-z', 'HEAD'):
            names = self.changed
        elif args == ('status', '--porcelain=v1', '--untracked-files=all'):
            return self.status
        elif args == ('rev-parse', 'HEAD'):
            return (self.head + '\n').encode()
        elif args == ('rev-parse', 'HEAD^{tree}'):
            return (FIXTURE_TREE + '\n').encode()
        elif args == ('branch', '--show-current'):
            return b'fixture-branch\n'
        else:
            self.fail('Unexpected Git read: ' + repr(args))
        return b''.join(name.encode() + b'\0' for name in names)

    def snapshot(self, name='snapshot'):
        output = self.base / name
        with patch.object(HANDOFF, 'git', side_effect=self.git), contextlib.redirect_stdout(io.StringIO()):
            HANDOFF.snapshot(argparse.Namespace(source=self.source, output=output))
        manifest = json.loads((output / 'source-manifest.json').read_text())
        return output, manifest

    def verify(self, archive, manifest):
        with contextlib.redirect_stdout(io.StringIO()):
            HANDOFF.verify_archive(argparse.Namespace(archive=archive, manifest=manifest))

    def build_args(self, manifest):
        return argparse.Namespace(source=self.source, manifest=manifest,
            commit=FIXTURE_COMMIT, output=self.base / 'never-created-build',
            public_config=self.base / 'never-read-public.json', public_sha256='0' * 64,
            font_source=self.base / 'never-read-fonts', pnpm_store=self.base / 'never-read-store',
            pnpm_executable=None, corepack_home=None)

    def assert_build_stops_before_inputs(self, manifest, message, git_impl=None):
        args = self.build_args(manifest)
        with patch.object(HANDOFF, 'git', side_effect=git_impl or self.git) as git_read, \
                patch.object(HANDOFF, 'public_config', side_effect=AssertionError('config read')) as config, \
                patch.object(HANDOFF, 'measure', side_effect=AssertionError('tool execution')) as measure, \
                patch.object(HANDOFF.subprocess, 'run', side_effect=AssertionError('install/build')) as execute:
            with self.assertRaisesRegex(ValueError, message):
                HANDOFF.build(args)
        config.assert_not_called()
        measure.assert_not_called()
        execute.assert_not_called()
        self.assertFalse(args.output.exists())
        return git_read


class SourceGuards(HandoffFixture):
    def test_reviewed_adapter_is_preserved_byte_for_byte(self):
        self.assertEqual(HANDOFF.digest(SCRIPT.read_bytes()), REVIEWED_ADAPTER_SHA256)

    def test_explicit_allowlist_and_credential_names(self):
        for name in ('README.md', 'package.json', '.github/workflows/ci.yaml',
                     'apps/frontend/src/App.tsx', 'ops/aliyun/linux-handoff.py',
                     'doc/separation/linux-source-transfer.md'):
            with self.subTest(name=name):
                self.assertTrue(HANDOFF.allowed(name))
        for name in ('/apps/source.ts', '../apps/source.ts', 'apps/../source.ts',
                     '.git/config', '.aws/credentials', '.codex/config.toml',
                     '.design-qa/report.json', 'apps/node_modules/module.js',
                     'apps/web/.next/server.js', 'apps/web/.next-qa/server.js',
                     'apps/web/.env', 'apps/web/.env.example',
                     'supabase/functions/generation-worker/.npmrc', 'apps/.netrc',
                     'ops/credentials.json', 'ops/secrets.yaml', 'ops/id_ed25519',
                     'ops/key.pem', 'unexpected-root-file.py'):
            with self.subTest(name=name):
                self.assertFalse(HANDOFF.allowed(name))

    def test_actual_repository_candidate_names_require_no_credential_content(self):
        root = SCRIPT.resolve().parents[2]
        result = subprocess.run(['git', '-C', str(root), 'ls-files', '-z',
            '--cached', '--others', '--exclude-standard'], check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'GIT_OPTIONAL_LOCKS': '0'})
        names = [name.decode() for name in result.stdout.split(b'\0') if name]
        self.assertIn('ops/aliyun/linux-handoff.py', names)
        self.assertIn('apps/web/.env.example', names)
        self.assertIn('supabase/functions/generation-worker/.npmrc', names)
        self.assertEqual([name for name in names if not credential_name(name)
                          and not HANDOFF.allowed(name)], [])

    def test_credential_names_are_skipped_before_filesystem_probe_or_content_read(self):
        credentials = ['apps/web/.env', 'apps/web/.env.example',
            'supabase/functions/.env.example', 'supabase/functions/generation-worker/.npmrc',
            'ops/.netrc']
        self.names += credentials
        original_exists, original_read = Path.exists, Path.read_bytes
        def exists(path):
            if credential_name(path.name):
                self.fail('Credential path was probed: ' + path.name)
            return original_exists(path)
        def read(path):
            if credential_name(path.name):
                self.fail('Credential contents were read: ' + path.name)
            return original_read(path)
        with patch.object(HANDOFF, 'git', side_effect=self.git), \
                patch.object(Path, 'exists', exists), patch.object(Path, 'read_bytes', read):
            files, deleted = HANDOFF.source_files(self.source)
        self.assertEqual([item['path'] for item in files], sorted(self.names[:2]))
        self.assertEqual(deleted, [])

    def test_forbidden_candidate_is_rejected_before_open(self):
        self.names = ['ops/not-reviewed.pem']
        with patch.object(HANDOFF, 'git', side_effect=self.git), \
                patch.object(Path, 'read_bytes', side_effect=AssertionError('forbidden read')):
            with self.assertRaisesRegex(ValueError, 'outside source allowlist'):
                HANDOFF.source_files(self.source)

    def test_staged_delete_and_rename_source_paths_are_recorded(self):
        self.deletions = ['apps/web/old.ts', 'ops/old-script.py']
        with patch.object(HANDOFF, 'git', side_effect=self.git):
            _, deleted = HANDOFF.source_files(self.source)
        self.assertEqual(deleted, sorted(self.deletions))

    def test_deleted_forbidden_path_rejects_without_opening_deleted_content(self):
        self.deletions = ['apps/web/.env.production']
        with patch.object(HANDOFF, 'git', side_effect=self.git), \
                patch.object(Path, 'read_bytes', side_effect=AssertionError('deleted content read')):
            with self.assertRaisesRegex(ValueError, 'Deleted path outside source allowlist'):
                HANDOFF.source_files(self.source)

    def test_symlink_source_is_rejected(self):
        target = self.source / 'README.md'
        target.unlink()
        target.symlink_to(self.source / 'ops/aliyun/fixture.py')
        with patch.object(HANDOFF, 'git', side_effect=self.git):
            with self.assertRaisesRegex(ValueError, 'regular files without symlink'):
                HANDOFF.source_files(self.source)

    def test_versioned_superpowers_plan_and_review_markdown_are_source(self):
        for name in [
            'docs/superpowers/plans/2026-11-05-commerce-analysis.md',
            'docs/superpowers/reviews/2026-11-02-v18-continuation.md',
        ]:
            self.assertTrue(HANDOFF.allowed(name), name)

    def test_superpowers_source_allowlist_remains_markdown_and_date_bounded(self):
        for name in [
            'docs/credentials.json', 'docs/superpowers/plans/.env.local',
            'docs/superpowers/plans/subdir/2026-11-05-plan.md',
            'docs/superpowers/plans/notes.md',
            'docs/superpowers/other/2026-11-05-plan.md',
            'docs/superpowers/reviews/2026-11-05-review.json',
        ]:
            self.assertFalse(HANDOFF.allowed(name), name)

    def test_reviewed_sdk_auth_fixture_can_be_exported(self):
        name = 'supabase/tests/edge/relay-auth.deno.ts'
        body = (SCRIPT.parents[2] / name).read_bytes()
        HANDOFF.scan(name, body)

    def test_reviewed_sdk_auth_marker_cannot_be_copied_to_another_path(self):
        name = 'supabase/tests/edge/relay-auth.deno.ts'
        body = (SCRIPT.parents[2] / name).read_bytes()
        with self.assertRaisesRegex(ValueError, 'high confidence scan'):
            HANDOFF.scan('ops/copied-sdk-fixture.ts', body)

    def test_sdk_fixture_byte_change_requires_another_review(self):
        name = 'supabase/tests/edge/relay-auth.deno.ts'
        body = (SCRIPT.parents[2] / name).read_bytes() + b'\n// changed\n'
        with self.assertRaisesRegex(ValueError, 'high confidence scan'):
            HANDOFF.scan(name, body)

    def test_high_confidence_scan_rejects_synthetic_server_markers(self):
        # Construct fake marker bytes so this test source is safe to snapshot.
        marker = b'sb_' + b'secret_' + b'x' * 32
        with self.assertRaisesRegex(ValueError, 'high confidence scan'):
            HANDOFF.scan('ops/fixture.txt', marker)
        payload = base64.urlsafe_b64encode(json.dumps({'role': 'service_role'}).encode()).rstrip(b'=')
        token = b'eyJhbGciOiJIUzI1NiJ9.' + payload + b'.fixtureSignature'
        with self.assertRaisesRegex(ValueError, 'server JWT scan'):
            HANDOFF.scan('ops/fixture.txt', token)


class SnapshotAndArchiveGuards(HandoffFixture):
    def test_clean_snapshot_full_index_archive_and_empty_delta_roundtrip(self):
        output, manifest = self.snapshot()
        self.assertEqual(manifest['baseCommit'], FIXTURE_COMMIT)
        self.assertEqual(manifest['gitTree'], FIXTURE_TREE)
        self.assertEqual(manifest['sourceState'], 'clean')
        self.assertTrue(manifest['formalBuildEligible'])
        self.assertFalse(manifest['productionReady'])
        self.assertEqual(manifest['fileCount'], len(self.names))
        self.verify(output / 'source.tar.gz', output / 'source-manifest.json')
        delta = json.loads((output / 'source-delta-manifest.json').read_text())
        self.assertEqual(delta['files'], [])
        self.assertEqual(delta['expectedFullSourceFingerprintSha256'], manifest['fingerprintSha256'])
        self.verify(output / 'source-delta.tar.gz', output / 'source-delta-manifest.json')
        receipt = json.loads((output / 'source-receipt.json').read_text())
        for name, record in receipt['artifacts'].items():
            body = (output / name).read_bytes()
            self.assertEqual(record, {'bytes': len(body), 'sha256': HANDOFF.digest(body)})

    def test_dirty_snapshot_cannot_claim_formal_eligibility_and_delta_binds_deletions(self):
        self.status = b' M README.md\nD  apps/web/old.ts\n'
        self.changed = ['README.md', 'apps/web/old.ts']
        self.deletions = ['apps/web/old.ts']
        output, manifest = self.snapshot()
        self.assertEqual(manifest['sourceState'], 'dirty')
        self.assertFalse(manifest['formalBuildEligible'])
        delta = json.loads((output / 'source-delta-manifest.json').read_text())
        self.assertEqual([item['path'] for item in delta['files']], ['README.md'])
        self.assertEqual(delta['deletedTrackedPaths'], self.deletions)
        self.assertEqual(delta['requiresBaseCommit'], FIXTURE_COMMIT)
        self.verify(output / 'source.tar.gz', output / 'source-manifest.json')

    def test_dirty_credential_path_is_not_silently_omitted(self):
        for mode in ('staged', 'untracked'):
            with self.subTest(mode=mode):
                credential = 'apps/web/.env.production'
                self.names = ['README.md', credential]
                self.status = b' M apps/web/.env.production\n'
                self.changed = [credential] if mode == 'staged' else []
                self.untracked = [credential] if mode == 'untracked' else []
                output = self.base / mode
                with patch.object(HANDOFF, 'git', side_effect=self.git), \
                        self.assertRaisesRegex(ValueError, 'Dirty credential paths'):
                    HANDOFF.snapshot(argparse.Namespace(source=self.source, output=output))
                self.assertFalse((output / 'source.tar.gz').exists())
                self.assertFalse((output / 'source-receipt.json').exists())

    def test_snapshot_refuses_output_inside_source_and_existing_output(self):
        with self.assertRaisesRegex(ValueError, 'outside source'):
            HANDOFF.snapshot(argparse.Namespace(source=self.source, output=self.source / 'handoff'))
        self.assertFalse((self.source / 'handoff').exists())
        output, _ = self.snapshot()
        before = (output / 'source-receipt.json').read_bytes()
        with patch.object(HANDOFF, 'git', side_effect=self.git), self.assertRaises(FileExistsError):
            HANDOFF.snapshot(argparse.Namespace(source=self.source, output=output))
        self.assertEqual((output / 'source-receipt.json').read_bytes(), before)

    def test_snapshot_detects_source_drift_before_receipt(self):
        with patch.object(HANDOFF, 'git', side_effect=self.git):
            files, deleted = HANDOFF.source_files(self.source)
        drifted = [dict(item) for item in files]
        drifted[0]['sha256'] = '0' * 64
        output = self.base / 'drift'
        with patch.object(HANDOFF, 'git', side_effect=self.git), \
                patch.object(HANDOFF, 'source_files', side_effect=[(files, deleted), (drifted, deleted)]):
            with self.assertRaisesRegex(ValueError, 'Source drift'):
                HANDOFF.snapshot(argparse.Namespace(source=self.source, output=output))
        self.assertFalse((output / 'source-receipt.json').exists())

    def test_archive_tampering_metadata_duplicates_and_closure_are_rejected(self):
        output, manifest = self.snapshot()
        original = []
        with tarfile.open(output / 'source.tar.gz', 'r:gz') as archive:
            for member in archive:
                original.append((member, archive.extractfile(member).read()))
        for attack in ('bytes', 'mode', 'duplicate', 'missing', 'extra', 'escape', 'symlink'):
            with self.subTest(attack=attack):
                attacked = self.base / (attack + '.tar.gz')
                with tarfile.open(attacked, 'w:gz') as archive:
                    for index, (member, body) in enumerate(original):
                        item = tarfile.TarInfo(member.name)
                        item.mode, item.size = member.mode, len(body)
                        if index == 0:
                            if attack == 'missing':
                                continue
                            if attack == 'bytes':
                                body = b'x' * len(body)
                            if attack == 'mode':
                                item.mode = 0o777
                            if attack == 'symlink':
                                item.type, item.linkname, item.size = tarfile.SYMTYPE, '/outside', 0
                        archive.addfile(item, io.BytesIO(body) if item.isfile() else None)
                        if index == 0 and attack == 'duplicate':
                            archive.addfile(item, io.BytesIO(body))
                    if attack in ('extra', 'escape'):
                        item = tarfile.TarInfo('ops/extra.txt' if attack == 'extra' else '../escape.txt')
                        item.size = 1
                        archive.addfile(item, io.BytesIO(b'x'))
                with self.assertRaises(ValueError):
                    self.verify(attacked, output / 'source-manifest.json')
        manifest['fingerprintSha256'] = '0' * 64
        forged = self.base / 'forged-manifest.json'
        forged.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'Invalid manifest or fingerprint'):
            self.verify(output / 'source.tar.gz', forged)


class BuildAndReturnGuards(HandoffFixture):
    def test_dirty_manifest_stops_before_git_config_install_or_output(self):
        manifest = self.base / 'dirty-manifest.json'
        manifest.write_text(json.dumps({'sourceState': 'dirty', 'formalBuildEligible': False}))
        git_read = self.assert_build_stops_before_inputs(manifest, 'Dirty snapshot')
        git_read.assert_not_called()

    def test_dirty_manifest_cli_rejects_without_config_or_build_output(self):
        manifest = self.base / 'dirty-manifest.json'
        manifest.write_text(json.dumps({'sourceState': 'dirty', 'formalBuildEligible': False}))
        args = self.build_args(manifest)
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), 'build',
            '--source', str(self.source), '--manifest', str(manifest), '--commit', FIXTURE_COMMIT,
            '--output', str(args.output), '--public-config', str(args.public_config),
            '--public-sha256', args.public_sha256, '--font-source', str(args.font_source),
            '--pnpm-store', str(args.pnpm_store)], capture_output=True, text=True,
            env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')})
        self.assertEqual(result.returncode, 1)
        self.assertIn('Dirty snapshot cannot become a formal release', result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertFalse(args.output.exists())

    def test_old_commit_cannot_be_relabelled_as_new_manifest(self):
        output, manifest = self.snapshot()
        manifest['baseCommit'] = '3' * 40
        path = output / 'source-manifest.json'
        path.write_text(json.dumps(manifest))
        self.assert_build_stops_before_inputs(path, 'Exact real commit')

    def test_dirty_checkout_cannot_use_clean_manifest(self):
        output, _ = self.snapshot()
        self.status = b' M README.md\n'
        self.assert_build_stops_before_inputs(output / 'source-manifest.json', 'checkout must be clean')

    def test_source_byte_mismatch_stops_before_inputs(self):
        output, _ = self.snapshot()
        (self.source / 'README.md').write_text('changed non-sensitive fixture\n')
        self.assert_build_stops_before_inputs(output / 'source-manifest.json', 'differs from source manifest')

    def test_clean_environment_does_not_inherit_server_or_qa_variables(self):
        with patch.dict(os.environ, {'PATH': '/fixture/bin', 'HOME': '/never-inherit',
                'SYNTHETIC_SERVER_KEY': 'fixture', 'NEXT_DIST_DIR': '.next-qa',
                'NEXT_PUBLIC_SUPABASE_URL': 'https://fixture.invalid'}, clear=True):
            result = HANDOFF.clean_env()
        self.assertEqual(set(result), {'PATH', 'LANG', 'LC_ALL', 'COREPACK_ENABLE_NETWORK',
                                      'COREPACK_ENABLE_DOWNLOAD_PROMPT', 'COREPACK_ENABLE_AUTO_PIN'})
        self.assertEqual(result['COREPACK_ENABLE_NETWORK'], '0')
        with self.assertRaisesRegex(ValueError, 'Existing reviewed Corepack cache'):
            HANDOFF.clean_env(self.base / 'missing-cache')

    def test_platform_measurement_rejects_mac_windows_and_wrong_linux_without_running_tools(self):
        for platform_name, libc in (('darwin', None), ('win32', None), ('linux', 'glibc-2.41'),
                                    ('linux', 'glibc-2.35')):
            with self.subTest(platform=platform_name, libc=libc):
                actual = dict(HANDOFF.TARGET['runtime'], platform=platform_name, libc=libc,
                              napi='10', loadedLibstdcpp=[])
                with patch.object(HANDOFF.shutil, 'which', side_effect=lambda name: '/fixture/' + name), \
                        patch.object(HANDOFF, 'run', side_effect=[json.dumps(actual).encode(),
                            b'11.19.0\n', b'tar (GNU tar) fixture\n']), \
                        patch.object(Path, 'is_file', return_value=False), \
                        patch.object(Path, 'read_bytes', return_value=b'non-sensitive fixture executable'), \
                        patch.object(HANDOFF.shutil, 'disk_usage', return_value=argparse.Namespace(total=10, used=2, free=8)), \
                        patch.dict(os.environ, {'PATH': '/fixture'}, clear=True):
                    report = HANDOFF.measure(self.source)
                self.assertEqual(report['platformMatches'], platform_name == 'linux' and libc == 'glibc-2.35')
                self.assertFalse(report['productionReady'])

    def test_return_bundle_is_exact_allowlist_and_bound_to_one_clean_commit(self):
        root = self.base / 'build-result-fixture'
        (root / 'release').mkdir(parents=True)
        source = {'sourceState': 'clean', 'formalBuildEligible': True, 'baseCommit': FIXTURE_COMMIT}
        for name, content in {'source-manifest.json': source,
                'build-result.json': {'commit': FIXTURE_COMMIT},
                'platform-preflight.json': {'productionReady': False},
                'release/release-result.json': {'releaseSha': FIXTURE_COMMIT}}.items():
            (root / name).write_text(json.dumps(content))
        (root / 'release/transport.tgz').write_bytes(b'non-sensitive synthetic transport')
        # Deliberately absent files named by the exclusion contract are never read.
        output = self.base / 'return.tgz'
        with contextlib.redirect_stdout(io.StringIO()):
            HANDOFF.return_bundle(argparse.Namespace(build_root=root, output=output))
        with tarfile.open(output, 'r:gz') as archive:
            names = archive.getnames()
            self.assertEqual(set(names), {'transport.tgz', 'release-result.json', 'build-result.json',
                'platform-preflight.json', 'source-manifest.json', 'return-index.json'})
            index = json.load(archive.extractfile('return-index.json'))
            self.assertFalse(index['productionReady'])
            for name, record in index['files'].items():
                body = archive.extractfile(name).read()
                self.assertEqual(record, {'bytes': len(body), 'sha256': HANDOFF.digest(body)})
        source['baseCommit'] = '3' * 40
        (root / 'source-manifest.json').write_text(json.dumps(source))
        rejected = self.base / 'relabelled-return.tgz'
        with self.assertRaisesRegex(ValueError, 'one clean real source commit'):
            HANDOFF.return_bundle(argparse.Namespace(build_root=root, output=rejected))
        self.assertFalse(rejected.exists())


if __name__ == '__main__':
    unittest.main()
