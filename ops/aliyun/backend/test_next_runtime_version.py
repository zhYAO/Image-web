"""Independent artifact expectation vs live status; offline only."""
import copy
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('transaction',Path(__file__).with_name('transaction.py'))
tx=importlib.util.module_from_spec(spec);spec.loader.exec_module(tx)
PROFILE=tx.SOURCE_PROFILES['candidateProfile']

class EvidenceTests(unittest.TestCase):
    def observe(self, release, version, expected=None, extra=None, status_change=None, operation=None):
        contract=expected if expected is not None else {'protocolVersion':2,'nextVersion':'16.4.5','sourceProfile':PROFILE}
        framework={'installed':True,**contract,'nextVersion':version,'hook':'response-cache-revalidate-v1','controlValid':True}
        if extra: framework.update(extra)
        status={'schemaVersion':1,'backendRelease':release,'pid':101,'controlValid':True,
                'activeHttpRequests':0,'activeFrameworkWork':0,'counters':dict.fromkeys(tx.COUNTERS,0),
                'httpAdmission':{'protocolVersion':1,'installed':True,'barrierId':'node-http-create-server-v1',
                                'activeHttpRequests':0,'activeFrameworkWork':0,'frameworkWork':framework}}
        if status_change: status_change(status)
        class Ops:
            def framework_contract(self, release): return copy.deepcopy(contract)
            def status(self): return copy.deepcopy(status)
        return tx.BackendTransaction(Ops(),'unused','unused').observed(release, operation)
    def test_control_pid_counters_and_epoch_still_fail_closed(self):
        for change in [lambda s:s.update(controlValid=False), lambda s:s.update(pid=True),
                       lambda s:s['counters'].update(pendingFinalizers=-1),
                       lambda s:s.update(activeFrameworkWork=True)]:
            with self.assertRaises(tx.TransactionFailure):
                self.observe('a'*40,'16.4.5',status_change=change)
        with self.assertRaises(tx.TransactionFailure):
            self.observe('a'*40,'16.4.5',operation='expected-window')
    def test_stable_range_with_independent_artifact_pin(self):
        for version in ['16.4.5','16.4.6','16.4.123']:
            contract={'protocolVersion':2,'nextVersion':version,'sourceProfile':PROFILE}
            self.assertEqual(self.observe('a'*40,version,contract)['pid'],101)
        for version in ['16.4.6','16.4.1','16.5.0','16.4.05','16.4.5-canary.1','',None,True,{},'16.4.9007199254740992']:
            with self.subTest(version=version),self.assertRaises(tx.TransactionFailure): self.observe('a'*40,version)
    def test_fake_live_profile_protocol_or_unreviewed_expected_profile_rejected(self):
        for extra in [{'sourceProfile':'sha256:'+'0'*64},{'protocolVersion':1},{'controlValid':False},{'installed':1}]:
            with self.assertRaises(tx.TransactionFailure): self.observe('a'*40,'16.4.5',extra=extra)
        bad={'protocolVersion':2,'nextVersion':'16.4.5','sourceProfile':'sha256:'+'0'*64}
        with self.assertRaises(tx.TransactionFailure): self.observe('a'*40,'16.4.5',bad)
        class LiveOnly:
            def status(self): raise AssertionError('must not consult first live status')
        with self.assertRaises(AttributeError): tx.BackendTransaction(LiveOnly(),'unused','unused').observed('a'*40)
    def test_strict_old_payload_only_for_two_historical_bindings(self):
        old={'protocolVersion':1,'nextVersion':'16.4.1'}
        for release in tx.LEGACY_FRAMEWORK_RELEASES:
            self.assertEqual(self.observe(release,'16.4.1',old)['pid'],101)
            for extra in [{'sourceProfile':PROFILE},{'protocolVersion':2}]:
                with self.assertRaises(tx.TransactionFailure): self.observe(release,'16.4.1',old,extra)
        with self.assertRaises(tx.TransactionFailure): self.observe('a'*40,'16.4.1',old)

if __name__=='__main__': unittest.main()
