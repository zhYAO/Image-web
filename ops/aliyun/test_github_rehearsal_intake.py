"""Offline ZIP policy tests. The real pair is validated separately by local rehearsal."""
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

FILE = Path(__file__).with_name('github-rehearsal-intake.py')
SPEC = importlib.util.spec_from_file_location('test_intake_module', FILE)
intake = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(intake)


class GithubRehearsalIntake(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def payload(self, names, symlink=False):
        output = self.root / 'archive.zip'
        with zipfile.ZipFile(output, 'w') as archive:
            for name in names:
                item = zipfile.ZipInfo(name)
                if symlink:
                    item.create_system = 3
                    item.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(item, 'sample')
        return output

    def test_exact_whitelist_and_archive_digest(self):
        p = self.payload(['transport.tgz'])
        with self.assertRaisesRegex(ValueError, 'differs from trusted pin'):
            intake.extract_github_zip(p, self.root / 'out', '0' * 64, ['transport.tgz'])
        self.assertFalse((self.root / 'out').exists())
        intake.extract_github_zip(p, self.root / 'out', intake.digest(p), ['transport.tgz'])
        self.assertEqual((self.root / 'out' / 'transport.tgz').read_text(), 'sample')

    def test_extra_and_traversal_members_rejected(self):
        p = self.payload(['transport.tgz', '../unexpected'])
        with self.assertRaisesRegex(ValueError, 'Unexpected ZIP member set'):
            intake.extract_github_zip(p, self.root / 'out', intake.digest(p), ['transport.tgz'])
        self.assertFalse((self.root / 'unexpected').exists())

    def test_symlink_rejected_even_with_exact_archive_pin(self):
        p = self.payload(['transport.tgz'], symlink=True)
        with self.assertRaisesRegex(ValueError, 'Unsafe GitHub ZIP member'):
            intake.extract_github_zip(p, self.root / 'out', intake.digest(p), ['transport.tgz'])
        self.assertFalse((self.root / 'out' / 'transport.tgz').exists())
