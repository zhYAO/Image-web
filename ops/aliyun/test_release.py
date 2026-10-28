import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch, call

spec = importlib.util.spec_from_file_location('release', pathlib.Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSafety(unittest.TestCase):
    def archive(self, root, name, link=None):
        archive = root / 'release.tgz'
        with tarfile.open(archive, 'w:gz') as tar:
            item = tarfile.TarInfo(name)
            if link is not None:
                item.type = tarfile.SYMTYPE
                item.linkname = link
                tar.addfile(item)
            else:
                item.size = 4
                tar.addfile(item, io.BytesIO(b'test'))
        return archive

    def test_rejects_traversal_credentials_and_external_links(self):
        for name, link in [('../escaped', None), ('/etc/file', None), ('apps/web/.env.local', None),
                           ('.runtime-assets.env', None), ('node_modules/link', '../../../etc'), ('link', '/etc')]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = pathlib.Path(temp).resolve()
                with self.assertRaises(ValueError):
                    release.extract_release(self.archive(root, name, link), root / 'out')
                self.assertFalse((root / 'escaped').exists())

    def test_accepts_standalone_files_and_internal_pnpm_links(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            release.extract_release(self.archive(root, 'apps/web/server.js'), root / 'out')
            self.assertEqual((root / 'out/apps/web/server.js').read_text(), 'test')
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            release.extract_release(self.archive(root, 'apps/web/node_modules/next', '../../../node_modules/next'), root / 'out')
            self.assertTrue((root / 'out/apps/web/node_modules/next').is_symlink())

    def test_release_names_cannot_escape_directory(self):
        for value in ['', '..', '../current', '/tmp/a', 'abc;id']:
            with self.assertRaises(ValueError):
                release.release_name(value)
        self.assertEqual(release.release_name('83cb890-20260917'), '83cb890-20260917')

    def test_rejects_chained_symlinks_that_escape_after_resolution(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            archive = root / 'release.tgz'
            with tarfile.open(archive, 'w:gz') as tar:
                for name, target in [('link', '.'), ('nested', 'link/../victim')]:
                    item = tarfile.TarInfo(name)
                    item.type = tarfile.SYMTYPE
                    item.linkname = target
                    tar.addfile(item)
            with self.assertRaises(ValueError):
                release.extract_release(archive, root / 'out')

    def test_failed_activation_restores_and_verifies_previous_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            old, new = root / 'old', root / 'new'
            old.mkdir()
            current = root / 'current'
            current.symlink_to(old)
            with patch.object(release, 'CURRENT', current), patch.object(release, 'font_preflight'), patch.object(release, 'switch') as switch, patch.object(release, 'wait_healthy', side_effect=[RuntimeError('unhealthy'), None]) as health:
                with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                    release.activate(new)
                self.assertEqual(switch.call_args_list, [call(new), call(old)])
                self.assertEqual(health.call_args_list, [call(new), call(old)])

    def test_successful_activation_retains_previous_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            old, new = root / 'old', root / 'new'
            old.mkdir()
            current, previous = root / 'current', root / 'previous'
            current.symlink_to(old)
            with patch.object(release, 'ROOT', root), patch.object(release, 'CURRENT', current), patch.object(release, 'PREVIOUS', previous), patch.object(release, 'font_preflight'), patch.object(release, 'switch'), patch.object(release, 'wait_healthy'):
                release.activate(new)
                self.assertEqual(previous.resolve(), old)

    def test_failed_explicit_restoration_never_reactivates_the_rejected_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            releases = root / 'releases'
            original = releases / ('a' * 40)
            rejected = releases / ('b' * 40)
            original.mkdir(parents=True)
            rejected.mkdir()
            current = root / 'current'
            current.symlink_to(rejected)
            with patch.multiple(release, ROOT=root, RELEASES=releases, CURRENT=current), \
                 patch.object(release.os, 'geteuid', return_value=0), \
                 patch.object(release.sys, 'argv', ['zimage-release', 'rollback', original.name]), \
                 patch.object(release.subprocess, 'run') as systemctl, \
                 patch.object(release, 'font_preflight'), \
                 patch.object(release, 'wait_healthy', side_effect=[RuntimeError('restoration TLS failed'), None]):
                with self.assertRaisesRegex(RuntimeError, 'restoration TLS failed'):
                    release.main()
                self.assertEqual(current.resolve(), original)
                self.assertEqual(systemctl.call_count, 1)


if __name__ == '__main__':
    unittest.main()
