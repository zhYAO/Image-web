import copy
import unittest
from github_protected_merge_shadow import verify

class TestGate(unittest.TestCase):
    def setUp(self):
        self.p=dict(repository='zhYAO/Image-web',repository_id=1329578390,
                    required_check='required-release-pr',check_app_id=11,allowed_human_merger_ids={22})
        self.a=dict(repository=self.p['repository'],repository_id=self.p['repository_id'],
                    candidate_sha='a'*40,main_sha='a'*40,source_ref='refs/heads/main',event='push',
                    effective_rule=dict(branch='main',enforcing=True,require_pull_request=True,
                        restrict_direct_push=True,require_up_to_date=True,bypass_actors=[],
                        enforce_admins=True,allow_force_push=False,allow_deletion=False,
                        required_check='required-release-pr',check_app_id=11),
                    pull_request=dict(merged=True,merge_commit_sha='a'*40,base_ref='main',
                        base_repository_id=1329578390,number=4,merger_type='User',merger_id=22,
                        required_check_sha='b'*40),
                    check=dict(name='required-release-pr',app_id=11,status='completed',
                        conclusion='success',tested_sha='b'*40))
    def test_shadow(self):
        self.assertIs(verify(self.p,self.a)['productionReady'],False)
    def test_refuses_bypass_or_forged_or_skip(self):
        for scope,key,value in (('effective_rule','bypass_actors',[22]),
                                ('effective_rule','enforce_admins',False),
                                ('pull_request','merger_type','Bot'),
                                ('pull_request','merge_commit_sha','c'*40),
                                ('check','app_id',99),('check','conclusion','skipped'),
                                ('check','tested_sha','c'*40)):
            altered=copy.deepcopy(self.a)
            altered[scope][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):
                verify(self.p,altered)
