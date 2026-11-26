import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

from retention import plan, run


@unittest.skipUnless(sys.platform.startswith('linux'), 'Needs Linux flock and symlink semantics')
class RetentionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.uid = os.geteuid()
        self.back = self.root/'releases'
        self.front = self.root/'frontend/releases'
        self.assets = self.root/'frontend/assets'
        self.manifests = self.root/'layer-store/releases'
        self.layers = self.root/'layer-store/layers'
        for path in (self.back, self.front, self.assets, self.manifests, self.layers):
            path.mkdir(parents=True)
        self.lock = self.root/'deploy.lock'
        self.lock.touch()
        self.journal = self.root/'production-release.json'
        self.shas = [str(index)*40 for index in range(1, 6)]
        for index, sha in enumerate(self.shas):
            self.add_release(sha, index+1)
        self.previous, self.current = self.shas[-2:]
        (self.root/'current').symlink_to(self.back/self.current)
        (self.root/'frontend/current').symlink_to('releases/release-'+self.current)
        self.write_state('committed')

    def live(self):
        return self.back/self.current/'apps/web'

    def write_state(self, phase):
        self.journal.write_text(json.dumps(dict(phase=phase, new=[self.current, 'release-'+self.current],
                                               old=[self.previous, 'release-'+self.previous])))

    def add_manifest(self, sha, identity):
        blob = 'code-'+identity
        body = json.dumps(dict(releaseId=sha, layers=dict(code=dict(identity=identity,
                           index='layers/'+blob+'.json', archive='layers/'+blob+'.tgz')))).encode()
        (self.manifests/f'{sha}.json').write_bytes(body)
        for ext in ('.json', '.tgz'):
            (self.layers/(blob+ext)).touch()
        return hashlib.sha256(body).hexdigest()

    def add_release(self, sha, timestamp):
        backend = self.back/sha
        namespace = 'release-'+sha
        frontend = self.front/namespace
        backend.mkdir()
        frontend.mkdir()
        (backend/'.release-sha').write_text(sha)
        (frontend/'version.json').write_text(json.dumps(dict(frontendRelease=namespace)))
        link = self.assets/namespace
        link.symlink_to('../releases/'+namespace)
        os.utime(link, (timestamp, timestamp), follow_symlinks=False)
        pin = self.add_manifest(sha, sha[0]*64)
        (backend/'.manifest-sha256').write_text(pin)

    def test_keeps_current_rollback_and_newest_other_pair_and_prunes_only_code(self):
        # 4 and 5 are protected by the journal. 3 is newest among the rest.
        # A non-production manual manifest also consumes the code from 2.
        self.add_manifest('manual', '2'*64)
        shared = self.layers/('runtime-'+'0'*64+'.tgz')
        shared.touch()
        target = self.root/'shared-cache'
        target.mkdir()
        (target/'shared.txt').write_text('unchanged')
        (self.back/self.shas[0]/'shared').symlink_to(target)
        dangling = self.assets/('release-'+'a'*40)
        dangling.symlink_to('../releases/'+dangling.name)

        keep, removals = plan(self.root, self.live, self.uid)
        self.assertEqual(keep, self.shas[2:])
        self.assertIn(dangling, removals)
        self.assertIn(self.manifests/f'{self.shas[1]}.json', removals)
        self.assertIn(self.layers/('code-'+'1'*64+'.tgz'), removals)
        self.assertNotIn(self.layers/('code-'+'2'*64+'.tgz'), removals)
        self.assertNotIn(shared, removals)
        run(self.root, self.live, self.uid, apply=True)
        self.assertEqual(sorted(p.name for p in self.back.iterdir()), self.shas[2:])
        self.assertEqual(sorted(p.name for p in self.front.iterdir()), ['release-'+sha for sha in self.shas[2:]])
        self.assertEqual(plan(self.root, self.live, self.uid), (self.shas[2:], []))
        self.assertTrue((target/'shared.txt').is_file())

    def test_holds_on_live_mismatch_or_nonterminal_journal(self):
        with self.assertRaisesRegex(ValueError, 'Live release differs'):
            plan(self.root, lambda: self.back/self.shas[0]/'apps/web', self.uid)
        for phase in ('switching', 'restoring', 'restored', 'needs_attention'):
            self.write_state(phase)
            with self.subTest(phase=phase):
                self.assertIsNone(plan(self.root, self.live, self.uid))
        self.assertEqual(len(list(self.back.iterdir())), 5)

    def test_lock_busy_defers_without_invoking_live_probe(self):
        import fcntl

        with self.lock.open('rb') as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            run(self.root, lambda: self.fail('Live probe while deployment holds lock'), self.uid, apply=True)
        self.assertEqual(len(list(self.back.iterdir())), 5)

    def test_preserves_still_resolvable_legacy_relative_pointer(self):
        sha = self.shas[0]
        (self.root/'previous').symlink_to('releases/'+sha)
        (self.root/'frontend/previous').symlink_to('releases/release-'+sha)
        keep, removals = plan(self.root, self.live, self.uid)
        self.assertIn(sha, keep)
        self.assertNotIn(self.front/('release-'+sha), removals)
        self.assertNotIn(self.back/sha, removals)

    def test_invalid_retained_manifest_or_mapping_blocks_all_writes(self):
        pin = self.back/self.current/'.manifest-sha256'
        pin.write_text('0'*64)
        with self.assertRaisesRegex(ValueError, 'checksum differs'):
            run(self.root, self.live, self.uid, apply=True)
        link = self.assets/('release-'+self.shas[0])
        link.unlink()
        link.symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, 'Unexpected asset mapping'):
            run(self.root, self.live, self.uid, apply=True)
        self.assertEqual(len(list(self.back.iterdir())), 5)


if __name__ == '__main__':
    unittest.main()
