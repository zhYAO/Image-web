import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import space


class HeadroomTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.etc = self.root/'etc'
        self.etc.mkdir()
        (self.root/'frontend/assets').mkdir(parents=True)
        (self.root/'layer-store/layers').mkdir(parents=True)
        self.candidate, self.old = 'a'*40, 'b'*40
        for sha in (self.candidate, self.old):
            (self.root/'releases'/sha).mkdir(parents=True)
        self.free = {}
        self.fs = patch.object(space.os, 'statvfs', create=True, side_effect=lambda p:
            SimpleNamespace(f_bavail=self.free.get(p, (2**20, 2**20))[0], f_favail=self.free.get(p, (2**20, 2**20))[1],
                            f_bsize=4096, f_frsize=4096, f_bfree=2**20, f_ffree=2**20))
        self.fs.start()
        self.addCleanup(self.fs.stop)

    @staticmethod
    def owned(path, directory=False):
        if path.is_symlink() or not (path.is_dir() if directory else path.is_file()):
            raise ValueError('Not a managed path')

    def bounded_json(self, path, limit):
        self.owned(path)
        if path.stat().st_size > limit:
            raise ValueError('Oversized JSON')
        return json.loads(path.read_bytes())

    def layer_release(self, sha, entries):
        layers = {}
        for kind in ('code', 'runtime', 'assets'):
            body = json.dumps({'kind': kind, 'entries': entries if kind == 'runtime' else []}).encode()
            identity = hashlib.sha256(body).hexdigest() if kind != 'assets' else sha[0]*64
            layers[kind] = {'identity': identity}
            if kind != 'code':
                (self.root/'layer-cache'/kind/identity).mkdir(parents=True, exist_ok=True)
            if kind != 'assets':
                index = f'layers/{kind}-{identity}.json'
                layers[kind]['index'] = index
                (self.root/'layer-store'/index).write_bytes(body)
        target = self.root/'releases'/sha
        body = json.dumps({'releaseId': sha, 'layers': layers}).encode()
        (target/'.three-layer-release.json').write_bytes(body)
        (target/'.manifest-sha256').write_bytes(hashlib.sha256(body).hexdigest().encode()+b'\n')

    def check(self):
        space.check_headroom(self.root, self.etc, self.candidate, self.old, self)

    def test_peak_bytes_and_inodes_are_independent_and_reused(self):
        large = [{'path': 'next/server.js', 'type': 'file', 'bytes': 200*1024**2}]
        # Only metadata is present in these release trees: sizing must use what
        # the verifier will reconstruct, even if files are missing on disk.
        many = [{'path': f'd{i}/sub/link', 'type': 'symlink', 'target': 'foo'} for i in range(2000)]
        self.layer_release(self.candidate, large)
        self.layer_release(self.old, many)
        for reverse in (False, True):
            with self.subTest(larger_retained=reverse):
                if reverse:
                    self.candidate, self.old = self.old, self.candidate
                for blocks, inodes in ((199*256, 20000), (400*256, 5900)):
                    self.free[self.root] = blocks, inodes
                    with self.assertRaisesRegex(ValueError, 'headroom'):
                        self.check()
                self.free[self.root] = 270*256, 6400
                self.check()  # Fits either verification, but not both at once.

    def test_each_journal_and_pointer_mount_needs_usable_space(self):
        self.layer_release(self.candidate, [])
        self.layer_release(self.old, [])
        for path in (self.root, self.etc, self.root/'frontend', self.root/'frontend/assets'):
            for free in ((0, 100000), (100000, 0)):
                with self.subTest(path=path, free=free):
                    self.free = {path: free}
                    with self.assertRaisesRegex(ValueError, 'headroom'):
                        self.check()

    def test_cold_retained_cache_cannot_add_unbudgeted_reconstruction(self):
        self.layer_release(self.candidate, [])
        self.layer_release(self.old, [])
        cache = self.root/'layer-cache/assets'/('b'*64)
        cache.rmdir()
        with self.assertRaises((ValueError, OSError)):
            self.check()
        self.assertFalse(cache.exists())

    def test_legacy_retained_backend_has_no_layer_reconstruction(self):
        self.layer_release(self.candidate, [])
        self.check()
        (self.root/'releases'/self.old/'.manifest-sha256').touch()
        with self.assertRaises(ValueError):
            self.check()

    def test_retained_inventory_must_still_match_pinned_bytes(self):
        self.layer_release(self.candidate, [])
        self.layer_release(self.old, [{'path': 'server.js', 'type': 'file', 'bytes': 250000}])
        marker = self.root/'releases'/self.old/'.three-layer-release.json'
        index = self.root/'layer-store'/json.loads(marker.read_bytes())['layers']['runtime']['index']
        index.write_bytes(b'{"entries":[]}')
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.check()

    def test_small_files_need_blocks_and_implicit_directories_are_bounded(self):
        self.layer_release(self.candidate, [{'path': f'app/leaf{i}', 'type': 'file', 'bytes': 1} for i in range(1000)])
        self.layer_release(self.old, [{'path': 'one/two/three/four/link', 'type': 'symlink', 'target': 'foo'}])
        self.free[self.root] = (64*256 + 128, 100000)
        with self.assertRaisesRegex(ValueError, 'headroom'):
            self.check()
        with patch.object(space, 'MAX_ENTRIES', 3), self.assertRaisesRegex(ValueError, 'directory inventory'):
            space.check_headroom(self.root, self.etc, self.old, self.candidate, self)
