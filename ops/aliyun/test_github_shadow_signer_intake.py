import hashlib,io,json,zipfile,unittest
from github_shadow_signer_intake import read_report,REPO,REPO_ID,WORKFLOW
from github_shadow_stage_build import ARTIFACTS,CHECKS,IDS,REPORT_KIND
from github_hosted_stage_shadow import FIELDS

class Intake(unittest.TestCase):
 def setUp(self):
  sha='a'*40; repo=dict(id=REPO_ID,full_name=REPO)
  self.expected=dict.fromkeys(FIELDS-ARTIFACTS,sha)
  self.expected.update(repository=REPO,repositoryId=REPO_ID,workflow=WORKFLOW,sourceRef='refs/heads/main',event='push',runId=42,attempt=3,migrationLedgerSha256='d'*64)
  self.measured=dict.fromkeys(ARTIFACTS,'b'*64)
  self.report=dict({k:self.expected[k] for k in IDS},**self.measured,schemaVersion=1,kind=REPORT_KIND,productionReady=False,checks=dict.fromkeys(CHECKS,True))
  self.run=dict(id=42,run_attempt=3,head_sha=sha,event='push',head_branch='main',path=WORKFLOW,workflow_id=99,status='in_progress',repository=repo,head_repository=repo)
  self.job=dict(name='shadow-stage',run_id=42,run_attempt=3,head_sha=sha,status='completed',conclusion='success')
  self.binding=dict(id=42,head_sha=sha,head_branch='main',repository_id=REPO_ID,head_repository_id=REPO_ID)
 def check(self,*,report=None,job=None,extra=False,wrong_digest=False):
  buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w') as z:
   z.writestr('stage-report.json',json.dumps(report or self.report))
   if extra:z.writestr('other','data')
  raw=buf.getvalue(); digest=hashlib.sha256(raw).hexdigest()
  artifact=dict(workflow_run=self.binding,id=6,expired=False,name=f"shadow-stage-report-{'a'*40}-42-3",digest='sha256:'+digest)
  return read_report(archive=raw,artifact=artifact,run=self.run,jobs=dict(total_count=1,jobs=[job or self.job]),ids=dict(report=6,backend=7,frontend=8),expected=self.expected,artifact_sha256='0'*64 if wrong_digest else digest,workflow_id=99,stage_job_name='shadow-stage',measured_artifacts=self.measured)
 def test_pass(self):
  self.assertIs(json.loads(self.check())['productionReady'],False)
 def test_reject(self):
  for kw in (dict(extra=True),dict(wrong_digest=True),dict(job=dict(self.job,run_attempt=2)),dict(report=dict(self.report,kind='nonpromotable-browser-shadow'))):
   with self.subTest(kw=kw),self.assertRaises(ValueError):self.check(**kw)
