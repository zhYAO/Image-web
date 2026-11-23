import errno, hashlib, importlib.util, json, os
from pathlib import Path
import sys, tempfile, unittest
spec=importlib.util.spec_from_file_location('admission',Path(__file__).parent/'ordinary-version-admission.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Admission(unittest.TestCase):
    def setUp(self):
        self.v='f'*40
        self.actual={'receive-ordinary-pair':b'not executed','ordinary-runtime/core.py':b'data'}
        self.expected=set(self.actual)
        self.sel=dict(schemaVersion=1,version=self.v)
        self.policy=dict(schemaVersion=1,approved={self.v:{p:hashlib.sha256(b).hexdigest()
                                                         for p,b in self.actual.items()}})
        self.count=0
    def read(self,p,limit,*,private=False):
        if p==m.SELECTOR:
            self.assertTrue(private)
            self.count+=1
            return json.dumps(self.sel).encode()
        if p==m.PINS:
            self.assertTrue(private)
            return json.dumps(self.policy).encode()
        self.assertFalse(private)
        return self.actual[p.removeprefix(m.ROOT+'/'+self.v+'/')]
    def test_exact_and_immutable(self):
        v,s=m.admit(self.read,self.expected)
        self.assertEqual((v,dict(s)),(self.v,self.actual))
        with self.assertRaises(TypeError):
            s['new']=b'x'
    def test_wrong_version_no_fallback(self):
        self.sel['version']='a'*40
        with self.assertRaisesRegex(ValueError,'not exactly approved'):
            m.admit(self.read,self.expected)
    def test_duplicate_key_rejected(self):
        r=lambda p,*a,**kw: b'{"schemaVersion":1,"schemaVersion":1}' if p==m.SELECTOR else self.read(p,*a,**kw)
        with self.assertRaisesRegex(ValueError,'duplicate JSON'):
            m.admit(r,self.expected)
    def test_extra_pin_rejected(self):
        self.policy['approved'][self.v]['unreviewed.py']='a'*64
        with self.assertRaisesRegex(ValueError,'does not match'):
            m.admit(self.read,self.expected)
    def test_tamper_rejected(self):
        self.actual['ordinary-runtime/core.py']=b'different'
        with self.assertRaisesRegex(ValueError,'bytes rejected'):
            m.admit(self.read,self.expected)
    def test_traversal_rejected(self):
        with self.assertRaisesRegex(ValueError,'noncanonical path'):
            m.admit(self.read,self.expected|{'../unexpected'})
    def test_selector_change_mid_admission(self):
        def read(p,*a,**kw):
            if self.count>0 and p==m.SELECTOR:
                return b'{}'
            return self.read(p,*a,**kw)
        with self.assertRaisesRegex(ValueError,'policy changed'):
            m.admit(read,self.expected)

    def test_policy_change_mid_admission(self):
        reads=0
        def read(p,*a,**kw):
            nonlocal reads
            if p==m.PINS:
                reads+=1
                if reads>1:
                    return b'{}'
            return self.read(p,*a,**kw)
        with self.assertRaisesRegex(ValueError,'policy changed'):
            m.admit(read,self.expected)
    def test_absent_selector_never_reads_fallback(self):
        calls=[]
        def read(p,*a,**kw):
            calls.append(p)
            raise FileNotFoundError(errno.ENOENT,'absent',p)
        with self.assertRaises(FileNotFoundError) as err:
            m.admit(read,self.expected)
        self.assertEqual(err.exception.errno,errno.ENOENT)
        self.assertEqual(calls,[m.SELECTOR])
    def test_selector_cannot_override_inventory(self):
        self.sel['approved']=self.policy['approved']
        with self.assertRaisesRegex(ValueError,'invalid receiver selector'):
            m.admit(self.read,self.expected)

@unittest.skipUnless(sys.platform.startswith('linux') and '--disposable-root' in sys.argv,
                     'explicit disposable Linux root required')
class LinuxFiles(unittest.TestCase):
    def setUp(self):
        self.assertEqual(os.geteuid(),0)
        self.assertTrue(Path('/.dockerenv').exists())
        self.tmp=tempfile.TemporaryDirectory(dir='/opt')
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.path=self.root/'source'
        self.path.write_bytes(b'data')
    def test_root_owner_and_mode(self):
        self.path.chmod(0o600)
        with m.open_tree() as rd:
            self.assertEqual(rd(str(self.path),1024,private=True),b'data')
            self.path.chmod(0o644)
            with self.assertRaisesRegex(ValueError,'owner-only'):
                rd(str(self.path),1024,private=True)
            self.path.chmod(0o666)
            with self.assertRaisesRegex(ValueError,'untrusted receiver file'):
                rd(str(self.path),1024)
    def test_links_and_writable_ancestor(self):
        (self.root/'soft').symlink_to(self.path)
        with m.open_tree() as rd:
            with self.assertRaises(OSError) as err:
                rd(str(self.root/'soft'),1024)
            self.assertEqual(err.exception.errno,errno.ELOOP)
            with self.assertRaises(FileNotFoundError) as absent:
                rd(str(self.root/'absent'),1024)
            self.assertEqual(absent.exception.errno,errno.ENOENT)
            (self.root/'hard').hardlink_to(self.path)
            with self.assertRaisesRegex(ValueError,'untrusted receiver file'):
                rd(str(self.path),1024)
            self.root.chmod(0o777)
            with self.assertRaisesRegex(ValueError,'untrusted receiver directory'):
                rd(str(self.path),1024)

if __name__=='__main__':
    modes={'--disposable-root','--untrusted-uid','--untrusted-gid'}
    mode=next(iter(modes.intersection(sys.argv)),None)
    if mode is not None:
        sys.argv.remove(mode)
        assert sys.platform.startswith('linux') and Path('/.dockerenv').is_file()
    if mode=='--untrusted-uid':
        assert (os.geteuid(),os.getegid())==(65534,0)
        try:
            with m.open_tree():
                raise AssertionError('untrusted UID reached reader')
        except ValueError as e:
            assert str(e)=='receiver needs isolated POSIX root'
    elif mode=='--untrusted-gid':
        assert (os.geteuid(),os.getegid())==(0,65534)
        with tempfile.TemporaryDirectory(dir='/opt') as tmp:
            p=Path(tmp)/'payload'
            p.write_bytes(b'data')
            assert (p.parent.stat().st_uid,p.parent.stat().st_gid)==(0,65534)
            try:
                with m.open_tree() as rd:
                    rd(str(p),1024)
            except ValueError as e:
                assert str(e)=='untrusted receiver directory'
            else:
                raise AssertionError('non-root gid directory accepted')
    else:
        result=unittest.main(exit=False).result
        if not result.wasSuccessful() or (mode=='--disposable-root' and result.skipped):
            raise SystemExit(1)
    if mode is not None:
        print('SELECTOR_GUEST_PASSED '+mode)
