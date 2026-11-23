"""Offline defensive file identity checks; no production inputs or services."""
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('identity_manifest', Path(__file__).with_name('manifest.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Identity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zimage-identity-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.file = self.root / 'sample.txt'
        self.file.write_bytes(b'offline fixture')

    def test_actual_read_and_stream_hash_without_stat_adapters(self):
        self.assertEqual(m.read_regular(self.file), b'offline fixture')
        self.assertEqual(m.hash_regular(self.file), (15, hashlib.sha256(b'offline fixture').hexdigest()))

    def test_windows_cross_api_uses_birth_but_same_api_keeps_ctime(self):
        a = SimpleNamespace(st_dev=1, st_ino=2, st_size=3, st_mtime_ns=4, st_birthtime_ns=5, st_ctime_ns=5)
        b = SimpleNamespace(**{**vars(a), 'st_ctime_ns': 9})
        self.assertEqual(m.path_handle_signature(a, True), m.path_handle_signature(b, True))
        self.assertNotEqual(m.signature(a), m.signature(b))
        self.assertNotEqual(m.path_handle_signature(a, False), m.path_handle_signature(b, False))
        for key in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_birthtime_ns']:
            changed = SimpleNamespace(**{**vars(a), key: 99})
            self.assertNotEqual(m.path_handle_signature(a, True), m.path_handle_signature(changed, True))
        del a.st_birthtime_ns
        self.assertEqual(m.path_handle_signature(a, True), m.signature(a))
        a.st_ino = 0
        with self.assertRaises(ValueError): m.path_handle_signature(a, True)

    def test_descriptor_ctime_change_still_rejects(self):
        original = os.fstat
        calls = 0
        def changed(fd):
            nonlocal calls
            value = original(fd)
            calls += 1
            if calls == 1: return value
            names = ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink', 'st_mode']
            names += [k for k in ['st_birthtime_ns', 'st_file_attributes'] if hasattr(value, k)]
            result = SimpleNamespace(**{k: getattr(value, k) for k in names})
            result.st_ctime_ns += 1
            return result
        with patch.object(m.os, 'fstat', changed):
            with self.assertRaises(ValueError): m.read_regular(self.file)

    def test_replacement_between_path_sample_and_open_rejects(self):
        other = self.root / 'other.txt'
        other.write_bytes(b'offline fixture')
        original = m.open_readonly_no_follow
        def replaced(path):
            os.replace(other, path)
            return original(path)
        with patch.object(m, 'open_readonly_no_follow', replaced):
            with self.assertRaises(ValueError): m.read_regular(self.file)

    def test_hardlink_and_size_bound_reject(self):
        with self.assertRaises(ValueError): m.read_regular(self.file, 2)
        linked = self.root / 'linked.txt'
        os.link(self.file, linked)
        for path in [self.file, linked]:
            with self.assertRaises(ValueError): m.read_regular(path)
            with self.assertRaises(ValueError): m.hash_regular(path)

    def test_all_reparse_tags_rejected_even_regular_mode(self):
        original = Path.lstat
        def reparse(path, *args, **kwargs):
            if path == self.file:
                return SimpleNamespace(st_mode=stat.S_IFREG, st_nlink=1, st_file_attributes=0x400)
            return original(path, *args, **kwargs)
        with patch.object(Path, 'lstat', reparse):
            with self.assertRaises(ValueError): m.read_regular(self.file)
        def directory_reparse(path, *args, **kwargs):
            if path == self.root:
                return SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400)
            return original(path, *args, **kwargs)
        with patch.object(Path, 'lstat', directory_reparse):
            with self.assertRaises(ValueError): m.safe_directory(self.root)

    def test_real_symlink_rejects_when_platform_permits_creation(self):
        link = self.root / 'link.txt'
        try: link.symlink_to(self.file)
        except OSError: self.skipTest('Existing OS policy does not permit creating test symlinks')
        with self.assertRaises(ValueError): m.read_regular(link)

    @unittest.skipUnless(os.name == 'nt', 'Windows native handle sharing')
    def test_windows_read_handle_denies_concurrent_write_and_replace(self):
        fd = m.open_readonly_no_follow(self.file)
        try:
            with self.assertRaises(OSError):
                with self.file.open('wb'): pass
            other = self.root / 'replacement.txt'
            other.write_bytes(b'offline fixture')
            with self.assertRaises(OSError): os.replace(other, self.file)
        finally: os.close(fd)


if __name__ == '__main__': unittest.main()
