"""Pure process-evidence checks; no sockets, filesystem mutation or service calls."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('transaction',Path(__file__).with_name('transaction.py'))
tx=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tx)

class EvidenceTests(unittest.TestCase):
    def observe(self, release, version):
        framework={'installed':True,'protocolVersion':1,'nextVersion':version,'hook':'response-cache-revalidate-v1','controlValid':True}
        status={'schemaVersion':1,'backendRelease':release,'pid':101,'controlValid':True,
                'activeHttpRequests':0,'activeFrameworkWork':0,'counters':dict.fromkeys(tx.COUNTERS,0),
                'httpAdmission':{'protocolVersion':1,'installed':True,'barrierId':'node-http-create-server-v1',
                                 'activeHttpRequests':0,'activeFrameworkWork':0,'frameworkWork':framework}}
        class Ops:
            def status(self): return copy.deepcopy(status)
        return tx.BackendTransaction(Ops(),'unused-gate','unused-journal').observed(release)

    def test_current_candidate_exact_version(self):
        self.assertEqual(self.observe('a'*40,'16.4.5')['pid'],101)
        for value in ['16.4.1','16.4.2','16.4.6','16.4.5-canary.1','v16.4.5','',None,True,16.45,{}]:
            with self.subTest(value=value), self.assertRaises(tx.TransactionFailure): self.observe('a'*40,value)

    def test_only_two_retained_source_shas_accept_old_observation(self):
        self.assertEqual(tx.LEGACY_FRAMEWORK_RELEASES,frozenset({'7a811b326aa4b344cee08bc5a33c04e44a780fd4','fb4fb09f909c0ae5dce98ebd0d9540386685ddb7'}))
        for sha in tx.LEGACY_FRAMEWORK_RELEASES:
            self.assertEqual(self.observe(sha,'16.4.1')['pid'],101)
            for value in ['16.4.5','16.4.2',None,{}]:
                with self.subTest(sha=sha,value=value), self.assertRaises(tx.TransactionFailure): self.observe(sha,value)

if __name__=='__main__': unittest.main()
