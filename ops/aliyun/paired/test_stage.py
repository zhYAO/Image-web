import importlib.util
import os
import sys
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('paired_stage',Path(__file__).with_name('stage.py'))
stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)

REPO=Path(__file__).resolve().parents[3] if (Path(__file__).parent.parent/'backend').exists() else Path('/Users/zhaoyao/Desktop/work_space/Image-web')
spec=importlib.util.spec_from_file_location('original_adapter_fixture',REPO/'ops/aliyun/test_release_three_layer.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)


@unittest.skipUnless(sys.platform=='linux','Real layer adapter requires Linux/glibc; exercised in bounded Linux isolation')
class StageTests(unittest.TestCase):
    def setUp(self):
        self.f=fixture.RootThreeLayerAdapter('test_local_bundle_and_deploy_publish_without_rewriting_manifest')
        self.f.setUp();self.addCleanup(self.f.doCleanups)

    def test_stage_validates_real_archive_without_activation_or_sequence_write(self):
        before=os.readlink(self.f.host/'current')
        result=stage.prepare(self.f.adapter,self.f.operation,fixture.SHA,self.f.transport['outerSha256'],self.f.packed['manifestSha256'])
        self.assertFalse(result['activated'])
        self.assertEqual(os.readlink(self.f.host/'current'),before)
        self.assertFalse((self.f.host/'last-deployment-run').exists())
        self.assertFalse((self.f.host/'previous').exists())
        self.assertTrue((self.f.host/'releases'/fixture.SHA/'.three-layer-release.json').exists())
        self.f.native.assert_called_once()
        self.f.activate.assert_not_called()

    def test_bad_archive_digest_cannot_create_retained_release(self):
        with self.assertRaises(ValueError):stage.prepare(self.f.adapter,self.f.operation,fixture.SHA,'0'*64,self.f.packed['manifestSha256'])
        self.assertFalse((self.f.host/'releases'/fixture.SHA).exists())
        self.f.activate.assert_not_called()

    def test_native_failure_leaves_current_and_sequence_unchanged(self):
        self.f.native.side_effect=ValueError('native failure')
        before=os.readlink(self.f.host/'current')
        with self.assertRaises(ValueError):stage.prepare(self.f.adapter,self.f.operation,fixture.SHA,self.f.transport['outerSha256'],self.f.packed['manifestSha256'])
        self.assertEqual(os.readlink(self.f.host/'current'),before)
        self.assertFalse((self.f.host/'releases'/fixture.SHA).exists())
        self.assertFalse((self.f.host/'last-deployment-run').exists())


if __name__=='__main__':unittest.main()
