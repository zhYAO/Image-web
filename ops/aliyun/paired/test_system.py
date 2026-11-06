import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest

import core as c
from test_core import policy

spec=importlib.util.spec_from_file_location('paired_system',Path(__file__).with_name('system.py'))
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)


class SystemTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.p=policy();self.paths=s.Paths(self.root/'opt',self.root/'etc')
        for directory in [self.paths.root,self.paths.etc,self.paths.root/'frontend',self.paths.root/'frontend/releases',self.paths.root/'frontend/journal']:
            directory.mkdir(parents=True,exist_ok=True);directory.chmod(0o700)
        self.identity={'pid':12,'startTicks':111,'bootId':'00000000-0000-0000-0000-000000000001'}
        self.current=self.p['oldBackend'];self.node_mode='open';self.stopped=False;self.front=self.p['oldFrontend'];self.seq=4
        self.counter=0;self.events=[]
        self.backend=types.SimpleNamespace(current=lambda:self.current,status=self.status,service_stopped=lambda:self.stopped,
            stop=self.stop,start=self.start,select=self.select,native=lambda _:None)
        self.first=types.SimpleNamespace(process=lambda:None if self.stopped else copy.deepcopy(self.identity),service_metadata=lambda:{'public':'metadata'})
        self.tx=types.SimpleNamespace(atomic_json=self.atomic)
        self.pub=types.SimpleNamespace(current=lambda:self.front,read_json=lambda path:{'sequence':self.seq},sealed=lambda namespace:{'artifactId':self.p['oldFrontendArtifact']})
        self.ops=s.SystemOps(self.p,c,types.SimpleNamespace(backend=self.backend,first=self.first,transaction=self.tx,publisher=self.pub),
                             paths=self.paths,owner_uid=os.getuid(),anchor=self.root)
        self.ops.configuration_digest=lambda:self.p['configurationSha256'];self.ops.ingress_digest=lambda:self.p['ingressSha256']
        self.ops.seal_probe=lambda:self.events.append('seal_probe')
        self.ops.lifecycle=types.SimpleNamespace(observed=lambda release,operation=None,pid=None:self.status(),drain=self.drain)
        self.old_token={'schemaVersion':1,'operationId':'manual-old-token'}
        self.atomic(self.paths.open,self.old_token,0o644)
        self.atomic(self.paths.control,{'schemaVersion':2,'operationId':'manual-old-token','mode':'open'},0o644)
        self.record={'operationId':self.p['operationId'],'policySha256':c.digest(self.p),'initial':self.ops.snapshot(),
                     'candidateProcess':copy.deepcopy(self.identity),'phase':'seal_intent','writesMayHaveOpened':False}

    def atomic(self,path,value,mode=0o600):
        path.write_bytes(c.canonical(value));path.chmod(mode)
        if path==self.paths.control:self.node_mode=value['mode']

    def status(self):
        return {'backendRelease':self.current,'pid':self.identity['pid'],'controlValid':True,'maintenance':self.node_mode!='open',
                'admissionEpoch':self.p['operationId'],'admissionMode':self.node_mode,'activeHttpRequests':self.counter,
                'activeFrameworkWork':0,'counters':{x:0 for x in ['activeMutations','activeStreams','activeRenders','activeExports','pendingFinalizers']},'drained':self.counter==0}

    def drain(self,release,operation,pid,timeout):
        self.atomic(self.paths.control,{'schemaVersion':2,'operationId':operation,'mode':'draining'},0o644)
        if self.counter:raise ValueError('drain busy')
        return self.status()

    def stop(self):self.stopped=True;self.events.append('stop')
    def start(self):self.stopped=False;self.identity=dict(self.identity,pid=13,startTicks=211)
    def select(self,release,expected):
        if self.current!=expected:raise ValueError('drift')
        self.current=release

    def test_managed_reader_rejects_symlink_hardlink_weak_parent_and_duplicate_json(self):
        valid=self.paths.etc/'valid.json';self.atomic(valid,{'x':1})
        self.assertEqual(self.ops.read(valid),{'x':1})
        link=self.paths.etc/'link.json';link.symlink_to(valid)
        with self.assertRaises(ValueError):self.ops.read(link)
        hard=self.paths.etc/'hard.json';os.link(valid,hard)
        with self.assertRaises(ValueError):self.ops.read(valid)
        hard.unlink();valid.write_bytes(b'{"x":1,"x":2}')
        with self.assertRaises(ValueError):self.ops.read(valid)
        self.paths.etc.chmod(0o777)
        with self.assertRaises(ValueError):self.ops.read(valid)

    def test_seal_preserves_old_open_token_only_until_maintenance_exists(self):
        observed=[]
        self.ops.checkpoint=lambda name:observed.append((name,self.ops.marker_mode(),self.paths.frontend_fence.exists()))
        self.ops.seal(self.record)
        self.assertEqual(self.ops.marker_mode(),'sealed')
        self.assertFalse(self.paths.open.exists())
        self.assertTrue(all(mode!='open' for name,mode,_ in observed if name!='frontend_fenced'))
        self.assertEqual(observed[0][0],'frontend_fenced')

    def test_foreign_marker_cannot_be_deleted_or_overwritten(self):
        self.atomic(self.paths.checking,{'other':'window'},0o644)
        with self.assertRaises(ValueError):self.ops.seal(self.record)
        self.assertEqual(self.ops.read(self.paths.checking),{'other':'window'})
        self.assertFalse(self.paths.maintenance.exists())

    def test_drain_closes_checking_before_waiting_and_stop_rechecks_all_counters(self):
        self.ops.seal(self.record);self.atomic(self.paths.checking,self.ops.token(),0o644)
        self.counter=1
        with self.assertRaises(ValueError):self.ops.drain(self.record,self.identity)
        self.assertFalse(self.paths.checking.exists());self.assertFalse(self.stopped)
        with self.assertRaises(ValueError):self.ops.stop(self.record,self.identity)
        self.assertFalse(self.stopped)

    def test_open_removes_maintenance_last_and_rejects_missing_open_intent(self):
        self.ops.seal(self.record);self.ops.drain(self.record,self.identity)
        with self.assertRaises(ValueError):self.ops.open(self.record,self.identity)
        self.record.update(phase='opening',writesMayHaveOpened=True)
        modes=[];self.ops.checkpoint=lambda name:modes.append((name,self.ops.marker_mode(),self.node_mode))
        self.ops.open(self.record,self.identity)
        self.assertEqual(self.ops.marker_mode(),'open')
        self.assertEqual(modes[-1][0],'ingress_open')
        self.assertTrue(all(mode!='open' for name,mode,node in modes[:-1]))

    def test_hold_after_partial_open_closes_ingress_and_node_without_old_pair_switch(self):
        self.ops.seal(self.record);self.ops.drain(self.record,self.identity)
        self.record.update(phase='opening',writesMayHaveOpened=True)
        def crash(name):
            if name=='node_open':raise RuntimeError('injected')
        self.ops.checkpoint=crash
        with self.assertRaises(RuntimeError):self.ops.open(self.record,self.identity)
        self.ops.checkpoint=lambda _:None;self.ops.hold(self.record)
        self.assertEqual(self.ops.marker_mode(),'sealed');self.assertEqual(self.node_mode,'draining')
        self.assertEqual(self.current,self.p['oldBackend'])

    def test_process_start_identity_drift_rejects_stop(self):
        self.ops.seal(self.record);self.ops.drain(self.record,self.identity)
        original=copy.deepcopy(self.identity);self.identity['startTicks']+=1
        with self.assertRaises(ValueError):self.ops.stop(self.record,original)
        self.assertFalse(self.stopped)


if __name__=='__main__':unittest.main()
