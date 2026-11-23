import copy
import unittest
from github_protected_merge_observe import BASE, RULESET, WF, observe

class API(unittest.TestCase):
 def setUp(self):
  self.sha='a'*40;self.tested='b'*40;self.tree='c'*40;rid=1329578390;name='zimage-release-pr-required'
  self.policy=dict(repository='zhYAO/Image-web',repository_id=rid,required_check=name,check_app_id=5,
                   allowed_human_merger_ids={4},check_workflow_id=6)
  rules=[dict(type=k) for k in ('pull_request','deletion','non_fast_forward')]
  rules.append(dict(type='required_status_checks',parameters=dict(strict_required_status_checks_policy=True,
     required_status_checks=[dict(context=name,integration_id=5)])))
  self.api={'/branches/main':dict(name='main',protected=True,commit=dict(sha=self.sha)),
    f'/rulesets/{RULESET}':dict(id=RULESET,target='branch',enforcement='active',bypass_actors=[],
       conditions=dict(ref_name=dict(include=['refs/heads/main'],exclude=[])),rules=rules),
    '/rules/branches/main':[dict(r,ruleset_id=RULESET) for r in rules],
    f'/commits/{self.sha}/pulls?per_page=100':[dict(number=22)],
    '/pulls/22':dict(number=22,merged=True,merge_commit_sha=self.sha,base=dict(ref='main',repo=dict(id=rid)),merged_by=dict(type='User',id=4)),
    '/actions/runs/60':dict(id=60,path=WF,workflow_id=6,event='pull_request',repository=dict(id=rid),
          status='completed',conclusion='success',pull_requests=[dict(number=22,base=dict(ref='main'))],run_attempt=2,check_suite_id=31),
    '/actions/runs/60/attempts/2/jobs?per_page=100':dict(total_count=1,jobs=[dict(name=name,run_id=60,
        run_attempt=2,status='completed',conclusion='success',head_sha=self.tested,
        check_run_url='https://api.github.com'+BASE+'/check-runs/70')]),
    '/check-runs/70':dict(id=70,name=name,app=dict(id=5),status='completed',conclusion='success',head_sha=self.tested,check_suite=dict(id=31))}
  for sha in (self.sha,self.tested):self.api['/commits/'+sha]=dict(sha=sha,commit=dict(tree=dict(sha=self.tree)))
 def query(self,api=None):
  x=api or self.api
  return observe(lambda p:x[p.removeprefix(BASE)],policy=self.policy,candidate_sha=self.sha,pr_number=22,check_id=70,pr_run_id=60)
 def test_positive(self):self.assertIs(self.query()['productionReady'],False)
 def test_negative(self):
  for path,k,v in (('/branches/main','protected',False),(f'/rulesets/{RULESET}','bypass_actors',[1]),
      ('/actions/runs/60','workflow_id',9),('/check-runs/70','conclusion','skipped'),('/commits/'+self.tested,'commit',dict(tree=dict(sha='d'*40)))):
   api=copy.deepcopy(self.api);api[path][k]=v
   with self.subTest(path=path,k=k),self.assertRaises(ValueError):self.query(api)
