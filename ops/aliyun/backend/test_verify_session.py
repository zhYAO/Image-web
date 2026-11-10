import importlib.util,json,os,tempfile,unittest,warnings
from pathlib import Path
from unittest.mock import patch

REPO=Path(__file__).resolve().parents[3]
SCRIPT=REPO/'ops/aliyun/backend/verify-session.py'
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
session=load('verify_session_test_subject',SCRIPT)if SCRIPT.exists()else None
fixtures=load('existing_verifier_fixture',REPO/'ops/aliyun/backend/test_verify.py')

class LocalVerifierSessionTests(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(session,'safe local session helper is missing')
  self.tmp=tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve());self.addCleanup(self.tmp.cleanup)
  self.path=Path(self.tmp.name)/'session'
  self.helper=session.PrivateSession.create(self.path,'operation-1',{'a'*40},now=lambda:1001)
  self.fixture=fixtures.VerifierTests();self.fixture.setUp();self.req=self.fixture.request
 def put(self,body=None):
  p=self.path/'request.json'
  if p.exists()or p.is_symlink():p.unlink()
  p.write_text(json.dumps(self.req if body is None else body));p.chmod(0o600);return p
 def test_private_session_is_exclusive_and_redacted(self):
  self.assertEqual(self.path.stat().st_mode&0o777,0o700)
  with self.assertRaises(FileExistsError):session.PrivateSession.create(self.path,'operation-1',{'a'*40},now=lambda:1001)
  self.assertEqual(set(json.loads((self.path/'ready.json').read_text())),{'schemaVersion','operationId','allowedBackendReleases','pid','expiresAt','ready'})
 def test_success_uses_existing_fixed_get_verifier_and_writes_no_private_response(self):
  self.put();result=self.helper.consume(self.fixture.fetch)
  self.assertEqual(result,'verified');self.assertEqual(self.fixture.seen,[*session.verifier.PATHS,'/api/meta'])
  p=self.path/('receipt-'+'b'*64+'.json');data=p.read_text();receipt=json.loads(data)
  self.assertTrue(receipt['authenticatedReadOnly']);self.assertEqual(p.stat().st_mode&0o777,0o600)
  self.assertNotIn('private@example.test',data);self.assertNotIn('00000000-0000-4000-8000-000000000001',data)
 def test_duplicate_nonce_never_repeats_authenticated_requests(self):
  self.put();self.assertEqual(self.helper.consume(self.fixture.fetch),'verified');seen=list(self.fixture.seen)
  self.assertEqual(self.helper.consume(self.fixture.fetch),'ignored');self.assertEqual(self.fixture.seen,seen)
  self.req['pid']=102;self.put();self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');self.assertEqual(self.fixture.seen,seen)
 def test_expired_wrong_operation_or_release_never_fetches(self):
  for change in [{'expiresAt':1000},{'operationId':'different-1'},{'backendRelease':'c'*40}]:
   self.put(dict(self.req,**change));self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected')
  self.assertEqual(self.fixture.seen,[])
 def test_link_hardlink_oversize_or_weak_request_is_not_read(self):
  outside=Path(self.tmp.name)/'outside';outside.write_text('private-cookie-value');outside.chmod(0o600)
  p=self.path/'request.json';p.symlink_to(outside)
  self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');p.unlink();os.link(outside,p)
  self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');p.unlink();p.write_text('x'*4097);p.chmod(0o600)
  self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');self.put().chmod(0o644)
  self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');self.assertEqual(self.fixture.seen,[])
 def test_duplicate_json_fields_and_nonfinite_timestamps_never_fetch(self):
  p=self.put();p.write_text('{"schemaVersion":1,"schemaVersion":1}')
  self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected')
  self.put(dict(self.req,createdAt=float('nan')));self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');self.assertEqual(self.fixture.seen,[])
 def test_transport_failure_writes_only_bounded_failure_once(self):
  self.put()
  def broken(_):raise RuntimeError('Cookie=private-cookie-value private@example.test')
  self.assertEqual(self.helper.consume(broken),'failed')
  p=self.path/('failure-'+'b'*64+'.json');data=p.read_text();self.assertEqual(json.loads(data),{'schemaVersion':1,'nonce':'b'*64,'verificationFailed':True})
  self.assertNotIn('private',data);self.assertEqual(self.helper.consume(self.fixture.fetch),'ignored');self.assertEqual(self.fixture.seen,[])
 def test_existing_receipt_cannot_be_overwritten(self):
  p=self.path/('receipt-'+'b'*64+'.json');p.write_text('existing');p.chmod(0o600)
  self.put();self.assertEqual(self.helper.consume(self.fixture.fetch),'failed');self.assertEqual(p.read_text(),'existing')
 def test_weakened_session_permissions_fail_closed(self):
  self.path.chmod(0o755);self.put();self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');self.assertEqual(self.fixture.seen,[])
 def test_session_expiry_prevents_any_further_fetch(self):
  self.put();self.helper.now=lambda:2202;self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected');self.assertEqual(self.fixture.seen,[])
 def test_expiry_during_first_middle_or_final_get_never_publishes_success(self):
  for expire_at in (1,4,7):
   with self.subTest(expire_at=expire_at):
    self.helper=session.PrivateSession.create(Path(self.tmp.name)/('expiry-'+str(expire_at)),'operation-1',{'a'*40},duration=60,now=lambda:1001)
    self.path=self.helper.root;self.put();clock=[1001];self.helper.now=lambda:clock[0];calls=[]
    def slow(route):
     calls.append(route);result=self.fixture.fetch(route)
     if len(calls)==expire_at:clock[0]=1062
     return result
    self.assertEqual(self.helper.consume(slow),'failed');self.assertEqual(len(calls),expire_at)
    self.assertFalse(list(self.path.glob('receipt-*.json')))
 def test_monotonic_deadline_survives_wall_clock_rollback(self):
  with patch.object(session.time,'monotonic',return_value=10):
   self.helper=session.PrivateSession.create(Path(self.tmp.name)/'monotonic','operation-1',{'a'*40},duration=60,now=lambda:1001)
  self.path=self.helper.root;self.req.update(createdAt=900,expiresAt=1020);self.put();self.helper.now=lambda:901
  with patch.object(session.time,'monotonic',return_value=71):
   self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected')
  self.assertEqual(self.fixture.seen,[])
 def test_expiry_between_verification_and_publish_prevents_receipt(self):
  self.helper=session.PrivateSession.create(Path(self.tmp.name)/'publish-expiry','operation-1',{'a'*40},duration=60,now=lambda:1001)
  self.path=self.helper.root;self.put()
  def completed(*args,**kwargs):
   self.helper.now=lambda:1062
   return {'schemaVersion':1,'authenticatedReadOnly':True}
  with patch.object(session.verifier,'verify',side_effect=completed):
   self.assertEqual(self.helper.consume(self.fixture.fetch),'failed')
  self.assertFalse(list(self.path.glob('receipt-*.json')))
 def test_expiry_during_receipt_fsync_prevents_atomic_publication(self):
  self.helper=session.PrivateSession.create(Path(self.tmp.name)/'fsync-expiry','operation-1',{'a'*40},duration=60,now=lambda:1001)
  self.path=self.helper.root;self.put();clock=[1001];self.helper.now=lambda:clock[0];real_fsync=session.os.fsync
  def expire(fd):real_fsync(fd);clock[0]=1062
  with patch.object(session.os,'fsync',side_effect=expire):
   self.assertEqual(self.helper.consume(self.fixture.fetch),'failed')
  self.assertFalse(list(self.path.glob('receipt-*.json')));self.assertFalse(list(self.path.glob('.receipt-*')))
 def test_directory_trust_drift_during_fsync_prevents_publication(self):
  self.put();real_fsync=session.os.fsync
  def weaken(fd):real_fsync(fd);self.path.chmod(0o755)
  with patch.object(session.os,'fsync',side_effect=weaken):
   self.assertEqual(self.helper.consume(self.fixture.fetch),'failed')
  self.assertFalse(list(self.path.glob('receipt-*.json')));self.assertFalse(list(self.path.glob('.receipt-*')))
 def test_invalid_operation_is_rejected_before_any_secret_prompt(self):
  argv=['verify-session.py','--session-dir',str(Path(self.tmp.name)/'invalid-cli'),'--operation','bad','--release','a'*40]
  with patch.object(session.sys,'argv',argv),patch.object(session.sys.stdin,'isatty',return_value=True),patch.object(session.getpass,'getpass',return_value='session=fixture-only')as prompt:
   with self.assertRaises(ValueError):session.main()
   prompt.assert_not_called()
 def test_existing_session_directory_is_rejected_before_any_secret_prompt(self):
  argv=['verify-session.py','--session-dir',str(self.path),'--operation','operation-1','--release','a'*40]
  with patch.object(session.sys,'argv',argv),patch.object(session.sys.stdin,'isatty',return_value=True),patch.object(session.getpass,'getpass',return_value='session=fixture-only')as prompt:
   with self.assertRaises(FileExistsError):session.main()
   prompt.assert_not_called()
 def test_eight_challenge_limit_blocks_the_ninth_without_another_get(self):
  for i in range(8):
   self.req['nonce']=format(i,'064x');self.put();self.assertEqual(self.helper.consume(self.fixture.fetch),'verified')
  calls=len(self.fixture.seen);self.assertEqual(calls,56)
  self.req['nonce']=format(8,'064x');self.put();self.assertEqual(self.helper.consume(self.fixture.fetch),'rejected')
  self.assertEqual(len(self.fixture.seen),calls)
 def test_secret_prompt_refuses_non_tty_and_echo_fallback(self):
  with patch.object(session.sys.stdin,'isatty',return_value=False),patch.object(session.getpass,'getpass')as prompt:
   with self.assertRaises(ValueError):session.read_cookie()
   prompt.assert_not_called()
  def echo_warning(*_):warnings.warn('cannot hide input',session.getpass.GetPassWarning)
  with patch.object(session.sys.stdin,'isatty',return_value=True),patch.object(session.getpass,'getpass',side_effect=echo_warning):
   with self.assertRaises(session.getpass.GetPassWarning):session.read_cookie()

if __name__=='__main__':unittest.main()
