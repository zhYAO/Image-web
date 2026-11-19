"""Synthetic offline closure fixtures. No GitHub, SSH, service or Linux acceptance."""
import copy
import importlib.util
import json
from pathlib import Path
import random
import shutil
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

prototype = load('derived_candidate', 'derive-candidate-transport.py')
fixtures = load('derived_fixture', 'test_three_layer_release.py')


class DerivedCandidate(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.PortableFixture()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        f = self.fixture
        rng = random.Random(817)
        f.put(f.source/'node_modules/pkg/index.js', rng.randbytes(65536))
        f.put(f.source/(f.dist+'server/chunks/main.js'), rng.randbytes(2048))
        files = []
        values = {'commerce/example.jpg':rng.randbytes(32768),
                  **{'fonts/'+name:name.encode() for name in
                     ('NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','LICENSE.txt','README.md')}}
        for name,data in sorted(values.items()):
            files.append(dict(path=name,kind='font' if name.startswith('fonts/') else 'public',
                              bytes=len(data),sha256=f.m.digest(data),mime='text/plain'))
        body=f.m.canonical(dict(schema=1,productionReady=False,files=files))
        f.assets=f.root/'resources'/f.m.digest(body)
        for name,data in values.items():f.put(f.assets/name,data)
        f.put(f.assets/'asset-manifest.json',body)
        self.packed=f.pack()
        self.manifest=Path(self.packed['manifest'])
        self.manifest_sha=self.packed['manifestSha256']
        self.request=prototype.transport.request(f.store,self.manifest,self.manifest_sha)
        full=prototype.transport.bundle(f.store,self.manifest,f.root/'frozen.tgz',self.manifest_sha)
        self.archive=f.root/'frozen.tgz'
        self.pin=dict(schema=1,releaseSha='1'*40,manifestSha256=self.manifest_sha,
                      transportSha256=full['outerSha256'],transportBytes=full['bytes'],
                      candidateArtifactSha256='a'*64,runId=17,attempt=1,artifactId=19)
        self.destination='d'*64

    def cached(self,kinds,name):
        root=self.fixture.root/name
        for path in self.request['files']:
            if any(path.startswith('layers/'+kind+'-') for kind in kinds):
                self.fixture.put(root/path,(self.fixture.store/path).read_bytes())
        return root

    def prepare(self,kinds=(),name='cache'):
        cache=self.cached(kinds,name)
        snapshot=prototype.snapshot(cache,self.request,self.pin,self.destination,1000)
        digest=prototype.pin_digest(snapshot)
        return cache,snapshot,digest

    def derive(self,cache,snapshot,digest,name='derived.tgz',now=1000):
        output=self.fixture.root/name
        result=prototype.derive(self.archive,output,self.pin,snapshot,digest,self.destination,cache,now)
        return output,result

    def test_cold_images_and_images_runtime_hit_sizes_are_synthetic(self):
        rows=[]
        source=self.archive.read_bytes()
        for kinds,name in [((),'cold'),(('assets',),'images'),(('assets','runtime'),'images-runtime')]:
            cache,snapshot,digest=self.prepare(kinds,name+'-cache')
            before=sorted(p.relative_to(cache).as_posix() for p in cache.rglob('*')) if cache.exists() else []
            output,result=self.derive(cache,snapshot,digest,name+'.tgz')
            self.assertEqual(result['originalCandidate'],self.pin)
            self.assertFalse(result['productionReady'])
            self.assertFalse(result['rebuild'])
            self.assertEqual(result['derivedTransportSha256'],prototype.layers.file_digest(output))
            self.assertEqual(result['derivedTransportBytes'],output.stat().st_size)
            self.assertIn('releases/'+'1'*40+'.json',[x['path'] for x in result['upload']])
            self.assertEqual(self.archive.read_bytes(),source)
            after=sorted(p.relative_to(cache).as_posix() for p in cache.rglob('*')) if cache.exists() else []
            self.assertEqual(before,after)
            rows.append(dict(scenario=name,synthetic=True,bytes=result['derivedTransportBytes'],
                             uploadedObjects=len(result['upload']),reusedObjects=len(result['reuse'])))
        self.assertGreater(rows[0]['bytes'],rows[1]['bytes'])
        self.assertGreater(rows[1]['bytes'],rows[2]['bytes'])
        print(json.dumps(dict(syntheticTransferComparison=rows)))

    def test_missing_stale_future_wrong_digest_and_destination_reject(self):
        cache,snapshot,digest=self.prepare()
        for value,checksum,now in [(None,digest,1000),(snapshot,digest,1301),
                                   (snapshot,digest,999),(snapshot,'0'*64,1000)]:
            with self.assertRaises(ValueError):
                self.derive(cache,value,checksum,now=now)
        bad=copy.deepcopy(snapshot);bad['destinationId']='f'*64
        with self.assertRaises(ValueError):
            self.derive(cache,bad,prototype.pin_digest(bad))
        self.assertFalse((self.fixture.root/'derived.tgz').exists())

    def test_cache_hit_disappearing_or_corrupting_fails_closed(self):
        for index,operation in enumerate(('missing','corrupt')):
            cache,snapshot,digest=self.prepare(('assets',),'cache-'+operation)
            target=next(cache.rglob('*.tgz'))
            if operation=='missing':target.unlink()
            else:target.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'cache changed'):
                self.derive(cache,snapshot,digest,name=str(index)+'.tgz')
            self.assertFalse((self.fixture.root/(str(index)+'.tgz')).exists())

    def test_wrong_hit_size_does_not_silently_fall_back(self):
        cache,snapshot,digest=self.prepare(('assets',))
        bad=copy.deepcopy(snapshot)
        next(iter(bad['inventory']['files'].values()))['bytes']+=1
        with self.assertRaisesRegex(ValueError,'hit metadata'):
            self.derive(cache,bad,prototype.pin_digest(bad))

    def test_cache_race_after_bundle_keeps_final_output_absent(self):
        cache,snapshot,digest=self.prepare(('assets',))
        original=prototype.transport.bundle
        def change(*args,**kwargs):
            result=original(*args,**kwargs)
            next(cache.rglob('*.tgz')).unlink()
            return result
        with patch.object(prototype.transport,'bundle',side_effect=change):
            with self.assertRaises((ValueError,FileNotFoundError)):
                self.derive(cache,snapshot,digest)
        self.assertFalse((self.fixture.root/'derived.tgz').exists())

    def test_frozen_candidate_tamper_partial_closure_and_output_overwrite_reject(self):
        cache,snapshot,digest=self.prepare()
        sentinel=self.fixture.root/'keep.tgz';sentinel.write_bytes(b'keep')
        with self.assertRaises(ValueError):self.derive(cache,snapshot,digest,'keep.tgz')
        self.assertEqual(sentinel.read_bytes(),b'keep')
        self.archive.write_bytes(self.archive.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'digest/size'):self.derive(cache,snapshot,digest)
        # A valid subset, even with a matching new pin, cannot replace the original full candidate.
        cache2,snap2,dig2=self.prepare(('assets','runtime'),'warm')
        partial=prototype.transport.bundle(self.fixture.store,self.manifest,self.fixture.root/'partial.tgz',
                                          self.manifest_sha,inventory=snap2['inventory'])
        self.archive=self.fixture.root/'partial.tgz'
        self.pin=dict(self.pin,transportSha256=partial['outerSha256'],transportBytes=partial['bytes'])
        snap2=prototype.snapshot(cache2,self.request,self.pin,self.destination,1000)
        with self.assertRaisesRegex(ValueError,'every object'):
            self.derive(cache2,snap2,prototype.pin_digest(snap2))

    def test_metadata_reader_rejects_directory_and_oversized_file(self):
        path=self.fixture.root/'metadata.json'
        path.write_bytes(b'{\r\n}\r\n')
        self.assertEqual(prototype.metadata_bytes(path),b'{\r\n}\r\n')
        path.write_bytes(b'x'*1000001)
        with self.assertRaises(ValueError):prototype.metadata_bytes(path)
        with self.assertRaises(ValueError):prototype.metadata_bytes(self.fixture.root)

    def test_artifact_pin_boolean_identity_is_rejected(self):
        for key in ('runId','attempt','artifactId','transportBytes','schema'):
            bad=dict(self.pin);bad[key]=True
            with self.assertRaises(ValueError):prototype.validate_pin(bad)


if __name__=='__main__':
    unittest.main()
