import importlib.util, hashlib, json, os, sys, tempfile, unittest
from pathlib import Path, PurePosixPath
def load(p,n):
    spec=importlib.util.spec_from_file_location(n,p)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj
scratch=Path(__file__).resolve().parent
tool=load(scratch/'versioned-install-preflight.py','tool')
commit='c12a59405905ce05ba3a3ca39070f1e8c7382cc0'
isolated=sys.argv[1]=='--isolated-fixture'
if isolated:
    sys.argv.pop(1)
    if not sys.platform.startswith('linux') or not Path('/.dockerenv').is_file():
        raise RuntimeError('Container required')
    m=json.loads((scratch/'manifest.json').read_text())
    if m['commit']!=commit or len(m['files'])!=50:
        raise RuntimeError('Exact integrated-candidate manifest required')
    tmp_root='/tmp'
    def source_blob(name,e):
        return (scratch/'files'/name.lstrip('/')).read_bytes()
else:
    repo=Path(sys.argv.pop(1))
    g=load(repo/'ops/aliyun/paired/ordinary_install_inventory.py','inventory')
    tree=g.CommittedTree(repo,commit)
    m=g.build(tree)
    tmp_root=scratch
    def source_blob(name,e):
        return tree.blob(PurePosixPath(e['source']),executable=e['gitExecutable'])
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=tmp_root)
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        self.i=root/'stage'/'ordinary-versions'/commit
        self.h=root/'incumbent'
        self.h.mkdir()
        self.i.mkdir(parents=True)
        self.before={}
        for name,e in m['files'].items():
            stage=name in m['receiver'] and name not in m['paired']
            if stage and not name.startswith(tool.PREFIX):
                raise ValueError('bad staging fixture')
            p=(self.i/name[len(tool.PREFIX):]) if stage else (self.h/name.lstrip('/'))
            p.parent.mkdir(exist_ok=True,parents=True)
            p.write_bytes(source_blob(name,e))
            if stage:
                p.chmod(0o755 if e['gitExecutable'] else 0o644)
                self.before[name]=None
            else:
                self.before[name]=e['sha256']
    def runcheck(self):
        return tool.preflight(m,self.i,self.h,self.before)
    def test_exact(self):
        status=self.runcheck()
        self.assertTrue(status['stageLayoutVerified'])
        self.assertFalse(status['activated'])
        self.assertFalse(status['productionReady'])
        self.assertEqual(sum((status['staged'],status['sharedUnchanged'])),len(m['files']))
        print('exact commit:',status)
    def test_missing(self):
        (self.i/'receive-ordinary-pair').unlink()
        with self.assertRaisesRegex(ValueError,'missing or extraneous'):
            self.runcheck()
    def test_extra(self):
        (self.i/'cli.py').write_bytes(b'unexpected')
        with self.assertRaisesRegex(ValueError,'missing or extraneous'):
            self.runcheck()
    def test_tamper(self):
        (self.i/'receive-ordinary-pair').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'candidate digest mismatch'):
            self.runcheck()
    def test_shared_changed(self):
        name=next(iter(self.before))
        (self.h/name.lstrip('/')).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'incumbent changed'):
            self.runcheck()
    def test_shared_mismatch_is_not_activation(self):
        name=next(iter(self.before))
        (self.h/name.lstrip('/')).write_bytes(b'old')
        self.before[name]=hashlib.sha256(b'old').hexdigest()
        self.assertEqual(self.runcheck()['sharedIncompatible'],[name])
    def test_hardlink(self):
        p=self.i/'receive-ordinary-pair'
        (self.i.parent/'alias').hardlink_to(p)
        with self.assertRaisesRegex(ValueError,'single-link'):
            self.runcheck()
    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux file mode semantics required')
    def test_posix_candidate_mode(self):
        p=self.i/'receive-ordinary-pair'
        p.chmod(0o777)
        with self.assertRaisesRegex(ValueError,'candidate file mode mismatch'):
            self.runcheck()
    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux UID semantics required')
    def test_posix_version_root_owner(self):
        import os
        if os.geteuid() != 0:
            with self.assertRaisesRegex(ValueError,'untrusted POSIX root'):
                self.runcheck()
            return
        try:
            os.chown(self.i,65534,65534)
        except PermissionError:
            self.skipTest('Run this test alone in the unprivileged Linux guest')
        try:
            with self.assertRaisesRegex(ValueError,'untrusted POSIX root'):
                self.runcheck()
        finally:
            os.chown(self.i,0,0)
    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux symlink semantics required')
    def test_reject_activate_via_canonical_receiver_symlink(self):
        p=self.h/tool.PREFIX.lstrip('/')/'receive-ordinary-pair'
        p.parent.mkdir(exist_ok=True,parents=True)
        p.symlink_to(self.i/'receive-ordinary-pair')
        with self.assertRaisesRegex(ValueError,'link or reparse point'):
            self.runcheck()
    def test_reject_version_under_incumbent(self):
        version_root=self.h/'ordinary-versions'/commit
        version_root.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError,'isolated roots'):
            tool.preflight(m,version_root,self.h,self.before)
    def test_reject_fixed_path_receiver_creation(self):
        p=self.h/tool.PREFIX.lstrip('/')/'receive-ordinary-pair'
        p.parent.mkdir(exist_ok=True,parents=True)
        data=(self.i/'receive-ordinary-pair').read_bytes()
        p.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'incumbent changed'):
            self.runcheck()

if __name__=='__main__':
    result=unittest.main(exit=False).result
    if not result.wasSuccessful():
        raise SystemExit(1)
    if isolated:
        print('VERSIONED_ROOT_TESTS_PASSED' if os.geteuid()==0 else 'VERSIONED_UID_REJECTION_PASSED')
