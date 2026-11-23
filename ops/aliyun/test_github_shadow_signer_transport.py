import hashlib,json,unittest
from github_shadow_signer_transport import Transport,API,ROOT

class TestTransport(unittest.TestCase):
 def run_case(self,mode=None):
  blob='testartifact.blob.core.windows.net'; raw=b'ZIP'
  zip_path=ROOT+'/actions/artifacts/1/zip'
  meta=dict(digest='sha256:'+hashlib.sha256(raw).hexdigest(),size_in_bytes=len(raw))
  calls=[]
  class HTTP:
   def __init__(self,host,*,timeout,context):self.host=host
   def request(self,method,path,*,headers):
    self.path=path;self.headers=headers;calls.append((self.host,method,headers))
   def getresponse(self):
    self.status=302 if self.path==zip_path or mode=='json-redirect' else 200
    return self
   def getheaders(self):
    return [('Location','https://'+('evil.invalid' if mode=='foreign' else blob)+'/r?sig=hidden')]
   def getheader(self,k,d):return d
   def read(self,n):return (b'BAD' if mode=='digest' else raw) if self.host==blob else json.dumps(meta).encode()
   def close(self):pass
  t=Transport(token='local-fixture-token',run=2,attempt=3,ids=dict(report=1,backend=9,frontend=8),
              object_hosts={blob},connect=HTTP)
  if mode:
   with self.assertRaises(ValueError):t.download_report(zip_path,65536)
   if mode in ('foreign','json-redirect'):self.assertTrue(all(h==API for h,_,_ in calls))
  else:
   self.assertEqual(t.download_report(zip_path,65536),raw)
   headers=calls[-1][2]
   self.assertFalse({'Authorization','Cookie'} & headers.keys())
   with self.assertRaises(ValueError):t.download_report(ROOT+'/actions/artifacts/9/zip',65536)
 def test_ok(self):self.run_case()
 def test_reject(self):
  for mode in ('foreign','json-redirect','digest'):
   with self.subTest(mode=mode):self.run_case(mode)
