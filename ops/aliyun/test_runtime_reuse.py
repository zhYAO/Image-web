"""Offline tests for reusing immutable runtime bytes in a new business candidate."""
from pathlib import Path
import copy,hashlib,importlib.util,os,shutil,tempfile,unittest

SCRIPT=Path(__file__).with_name('runtime-reuse.py')
if SCRIPT.exists():
    SPEC=importlib.util.spec_from_file_location('runtime_reuse_under_test',SCRIPT)
    REUSE=importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(REUSE)
else:
    REUSE=None

class BindingGuards(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(REUSE,'runtime reuse adapter missing')
        self.resolution={'output':'standalone','feature':False}
        self.config={'apps/web/next.config.ts':'a'*64,'apps/web/build/static-assets-config.mjs':'b'*64}
        self.business={'source':{'lockSha256':'c'*64,'configSources':self.config},'build':{'assetsVersion':'d'*64,'dependencyResolution':self.resolution}}
        self.retained={'lockSha256':'c'*64,'assetsVersion':'d'*64,'configFingerprint':{'sources':copy.deepcopy(self.config),'dependencyResolution':copy.deepcopy(self.resolution)}}
    def test_matching_source_and_compiled_bindings_allow_further_validation(self):
        self.assertIsNone(REUSE.validate_reuse_bindings(self.business,self.retained))
    def test_each_changed_lock_config_resolution_or_asset_binding_stops_reuse(self):
        changes=[('lock',lambda b:b['source'].update(lockSha256='e'*64)),('config',lambda b:b['source']['configSources'].update({'apps/web/next.config.ts':'e'*64})),('resolution',lambda b:b['build']['dependencyResolution'].update(output='different')),('assets',lambda b:b['build'].update(assetsVersion='e'*64))]
        for label,change in changes:
            with self.subTest(label=label):
                b=copy.deepcopy(self.business);change(b)
                with self.assertRaises(ValueError):REUSE.validate_reuse_bindings(b,self.retained)
    def test_boolean_and_numeric_resolution_values_are_distinct(self):
        self.retained['configFingerprint']['dependencyResolution']['feature']=0
        with self.assertRaises(ValueError):REUSE.validate_reuse_bindings(self.business,self.retained)
    def test_absent_metadata_cannot_match_by_accident(self):
        with self.assertRaises(ValueError):REUSE.validate_reuse_bindings({},{})

class RuntimeCopyGuards(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(REUSE,'runtime reuse adapter missing')
        self.tmp=tempfile.TemporaryDirectory(prefix='runtime-reuse-',dir='/private/tmp')
        self.base=Path(self.tmp.name).resolve()
        def cleanup():
            for root,dirs,files in os.walk(self.base):
                Path(root).chmod(0o700)
            self.tmp.cleanup()
        self.addCleanup(cleanup)
        self.cache=self.base/'cache';leaf=self.cache/'node_modules/pkg/index.js';leaf.parent.mkdir(parents=True);self.body=b'module.exports=1;';leaf.write_bytes(self.body);leaf.chmod(0o444)
        (self.cache/'node_modules/alias').symlink_to('pkg',target_is_directory=True)
        for d in [leaf.parent,self.cache/'node_modules',self.cache]:d.chmod(0o555)
        self.entries=[{'path':'node_modules/alias','type':'symlink','target':'pkg','mode':0o777},{'path':'node_modules/pkg/index.js','type':'file','mode':0o644,'bytes':len(self.body),'sha256':hashlib.sha256(self.body).hexdigest()}]
        self.dest=self.base/'candidate';self.dest.mkdir()
    def test_business_file_mode_must_match_declared_mode(self):
        name='apps/web/server.js';p=self.dest/name;p.parent.mkdir(parents=True);p.write_bytes(self.body);p.chmod(0o777)
        business=[{'path':name,'type':'file','mode':0o644,'bytes':len(self.body),'sha256':hashlib.sha256(self.body).hexdigest()}]
        with self.assertRaises(ValueError):REUSE.populate_runtime(self.cache,self.entries,self.dest,business)
    def test_dangling_runtime_link_is_not_a_closed_graph(self):
        d=self.cache/'node_modules';d.chmod(0o755);p=d/'alias';p.unlink();p.symlink_to('absent',target_is_directory=True);d.chmod(0o555)
        self.entries[0]['target']='absent'
        with self.assertRaises(ValueError):REUSE.populate_runtime(self.cache,self.entries,self.dest)

    def test_runtime_link_may_close_through_a_declared_business_file(self):
        d=self.cache/'node_modules';d.chmod(0o755);p=d/'alias';p.unlink();p.symlink_to('../packages/domain',target_is_directory=True);d.chmod(0o555)
        self.entries[0]['target']='../packages/domain'
        name='packages/domain/package.json';p=self.dest/name;p.parent.mkdir(parents=True);body=b'{}';p.write_bytes(body);p.chmod(0o644)
        business=[{'path':name,'type':'file','mode':0o644,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}]
        REUSE.populate_runtime(self.cache,self.entries,self.dest,business)
        self.assertEqual((self.dest/'node_modules/alias/package.json').read_bytes(),body)

    def test_verified_runtime_is_copied_without_changing_source_bytes_or_permissions(self):
        REUSE.populate_runtime(self.cache,self.entries,self.dest)
        self.assertEqual((self.dest/'node_modules/alias/index.js').read_bytes(),self.body)
        self.assertEqual((self.cache/'node_modules/pkg/index.js').read_bytes(),self.body)
        self.assertEqual((self.cache/'node_modules/pkg/index.js').stat().st_mode&0o777,0o444)
        self.assertNotEqual((self.dest/'node_modules/pkg/index.js').stat().st_ino,(self.cache/'node_modules/pkg/index.js').stat().st_ino)
    def test_corrupt_runtime_stops_before_destination_is_populated(self):
        p=self.cache/'node_modules/pkg/index.js';p.chmod(0o644);p.write_bytes(b'corrupt');p.chmod(0o444)
        with self.assertRaises(ValueError):REUSE.populate_runtime(self.cache,self.entries,self.dest)
        self.assertEqual(list(self.dest.iterdir()),[])
    def test_existing_destination_content_cannot_be_overwritten(self):
        p=self.dest/'node_modules/pkg/index.js';p.parent.mkdir(parents=True);p.write_bytes(b'keep')
        with self.assertRaises(ValueError):REUSE.populate_runtime(self.cache,self.entries,self.dest)
        self.assertEqual(p.read_bytes(),b'keep')
    def test_output_cannot_be_inside_the_immutable_cache(self):
        with self.assertRaises(ValueError):REUSE.populate_runtime(self.cache,self.entries,self.cache/'candidate')
    def test_traversal_or_business_members_cannot_enter_runtime(self):
        for name in ['../outside','apps/web/server.js']:
            with self.subTest(name=name):
                entries=copy.deepcopy(self.entries);entries[1]['path']=name
                with self.assertRaises(ValueError):REUSE.populate_runtime(self.cache,entries,self.dest)

if __name__=='__main__':unittest.main()
