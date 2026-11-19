import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tarfile
import unittest
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('public_images', HERE / 'public-images.py')
images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images)


class PublicImages(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads(images.POLICY.read_bytes())

    def test_reviewed_closure_contains_only_pinned_images(self):
        result = images.checked_images(images.ROOT / 'apps/web/public', self.policy)
        self.assertEqual(len(result), 62)
        self.assertEqual(sum(len(data) for _, data in result), 8067881)
        self.assertTrue(all(name.endswith(('.jpg', '.webp')) for name, _ in result))

    def test_rejects_unknown_paths_digest_changes_types_and_duplicates(self):
        for update in [dict(path='../private.webp'), dict(path='commerce/source.png'),
                       dict(sha256='0'*64), dict(bytes=True), dict(contentType='text/plain')]:
            policy = copy.deepcopy(self.policy)
            policy['files'][0].update(update)
            with self.assertRaises(ValueError):
                images.checked_images(images.ROOT / 'apps/web/public', policy)
        policy = copy.deepcopy(self.policy)
        policy['files'].append(policy['files'][0])
        with self.assertRaises(ValueError):
            images.checked_images(images.ROOT / 'apps/web/public', policy)

    def test_archive_is_image_only_deterministic_and_never_overwrites(self):
        outputs = [images.ROOT.parent / ('tmp-public-images-'+uuid.uuid4().hex) for _ in range(2)]
        try:
            reports = [images.prepare(output) for output in outputs]
            self.assertEqual(reports[0]['archiveSha256'], reports[1]['archiveSha256'])
            self.assertFalse(reports[0]['deployed'])
            prefix = 'static-assets/'+reports[0]['manifestSha256']+'/'
            with tarfile.open(outputs[0]/'public-images.tgz') as archive:
                entries = archive.getmembers()
                self.assertEqual(len(entries), 62)
                self.assertTrue(all(entry.isfile() and entry.name.startswith(prefix)
                                    and entry.name.endswith(('.jpg','.webp')) for entry in entries))
            with self.assertRaises(FileExistsError): images.prepare(outputs[0])
        finally:
            for output in outputs:
                # Cleanup only this test's verified workspace destinations.
                assert output.parent == images.ROOT.parent and output.name.startswith('tmp-public-images-')
                if output.exists(): shutil.rmtree(output)


if __name__ == '__main__':
    unittest.main()
