import hashlib,json,unittest
from ordinary_rolling_incumbent import BOOTSTRAP,compare


def incumbent(sha):
    return dict(backend=sha,frontend='release-'+sha[:12],backendManifestSha256='1'*64,
                frontendArtifactSha256='2'*64,frontendConfigFingerprint='3'*64,databaseSha256='4'*64)


def receipt(live):
    op='release-exact'
    data=dict(schemaVersion=1,kind='zimage-ordinary-pair-v1',status='opened',operationId=op,
        commit=live['backend'],runId=2,attempt=1,backendRelease=live['backend'],
        frontendRelease=live['frontend'],backendManifestSha256=live['backendManifestSha256'],
        frontendSubjectSha256='5'*64,stageSha256='6'*64,rootApprovalSha256='7'*64,
        rollbackAcceptanceSha256='8'*64,rollbackPair=dict(backend=BOOTSTRAP,frontend='release-'+BOOTSTRAP[:12]))
    def inputs(data):
        raw=json.dumps(data).encode()
        return dict(receipt=raw,journal=dict(operationId=op,rootApprovalSha256='7'*64,phase='opened'),
                    evidence=dict(operationId=op,pair=live,receiptSha256=hashlib.sha256(raw).hexdigest()))
    return data, inputs


def check(live,candidate,**kw):
    ancestry=kw.pop('ancestry',dict(ancestor=live['backend'],descendant=candidate,verified=True))
    return compare(live,candidate,ancestry=ancestry,**kw)


class RollingTest(unittest.TestCase):
    def test_bootstrap_a_b(self):
        old,a=incumbent(BOOTSTRAP),incumbent('a'*40)
        self.assertEqual(check(old,'a'*40,receipt=None,journal=None,evidence=None,bootstrap=old)['rollbackPair'],old)
        raw,args=receipt(a)
        result=check(a,'b'*40,**args(raw))
        self.assertEqual(result['rollbackPair'],a)
        self.assertIs(result['productionReady'],False)

    def test_drift_fails(self):
        a,b=incumbent('a'*40),'b'*40
        raw,args=receipt(a)
        for k in ('frontendArtifactSha256','frontendConfigFingerprint','databaseSha256','backendManifestSha256'):
            with self.subTest(k=k),self.assertRaises(ValueError):
                check(dict(a,**{k:'f'*64}),b,**args(raw))
        for extra in (dict(args(raw),journal=None),args(dict(raw,status='writes-may-open')),
            dict(args(raw),ancestry=dict(ancestor=BOOTSTRAP,descendant=b,verified=True)),
            dict(receipt=None,journal=None,evidence=None,bootstrap=a)):
            with self.assertRaises(ValueError):
                check(a,b,**extra)
