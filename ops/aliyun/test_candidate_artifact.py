import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
import zipfile

spec = importlib.util.spec_from_file_location('candidate', Path(__file__).with_name('candidate-artifact.py'))
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)

class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.repo = dict(id=42, full_name='zhYAO/Image-web')
        self.workflow = dict(id=7, path=candidate.WORKFLOW)
        self.run = dict(id=100, run_attempt=2, workflow_id=7, path=candidate.WORKFLOW,
                        repository=dict(id=42), head_repository=dict(id=42), event='workflow_dispatch',
                        head_branch='main', head_sha=self.sha, status='completed', conclusion='success')
        self.jobs = [dict(name='candidate-build', conclusion='success', run_id=100), dict(name='deploy', conclusion='skipped')]
        self.artifact = dict(id=9, name=f'candidate-{self.sha}-100-2', expired=False,
                             workflow_run=dict(id=100, head_sha=self.sha, head_branch='main', repository_id=42, head_repository_id=42),
                             created_at='2026-11-18T00:00:00Z', expires_at='2026-11-19T00:00:00Z', digest='sha256:'+'b'*64)
        self.now = datetime(2026, 11, 18, 1, tzinfo=timezone.utc)

    def validate(self):
        candidate.validate(self.repo, self.run, self.jobs, self.artifact, self.workflow, self.sha, 100, 2, self.now)

    def test_successful_current_main_candidate(self):
        self.validate()

    def test_rejects_other_repository_and_workflow(self):
        self.repo['full_name']='other/Image-web'
        with self.assertRaises(ValueError): self.validate()
        self.repo['full_name']='zhYAO/Image-web'
        self.workflow['path']='.github/workflows/other.yml'
        with self.assertRaises(ValueError): self.validate()

    def test_rejects_untrusted_runs(self):
        for key, value in [('id', 101), ('run_attempt', 1), ('workflow_id', 8), ('path', 'other.yml'),
                           ('event', 'push'), ('head_branch', 'feature'), ('head_sha', 'c'*40),
                           ('status', 'in_progress'), ('conclusion', 'failure'),
                           ('repository', dict(id=99)), ('head_repository', dict(id=99))]:
            with self.subTest(key=key):
                original = copy.deepcopy(self.run)
                self.run[key] = value
                with self.assertRaises(ValueError): self.validate()
                self.run = original

    def test_rejects_wrong_job_and_release_run(self):
        for jobs in [[], [dict(name='quality', conclusion='success', run_id=100)],
                     [dict(name='candidate-build', conclusion='failure', run_id=100)],
                     self.jobs + [dict(name='rollback', conclusion='success')], self.jobs * 2]:
            with self.subTest(jobs=jobs):
                original = self.jobs
                self.jobs = jobs
                with self.assertRaises(ValueError): self.validate()
                self.jobs = original

    def test_rejects_artifact_identity_age_and_digest(self):
        for key, value in [('name','other'), ('expired', True), ('created_at','2026-11-16T00:00:00Z'),
                           ('created_at','2026-11-18T02:00:00Z'), ('expires_at','2026-11-18T00:30:00Z'),
                           ('digest',None), ('digest','sha256:wrong'),
                           ('workflow_run',dict(id=101, head_sha=self.sha, head_branch='main', repository_id=42, head_repository_id=42))]:
            with self.subTest(key=key, value=value):
                original=copy.deepcopy(self.artifact)
                self.artifact[key]=value
                with self.assertRaises(ValueError): self.validate()
                self.artifact=original

    def archive(self, change=None):
        transport=b'fake immutable transport'
        provenance=dict(schema=1, repository='zhYAO/Image-web', workflow=candidate.WORKFLOW,
                        action='candidate', sha=self.sha, run_id=100, attempt=2,
                        transport_sha256=hashlib.sha256(transport).hexdigest())
        report=dict(schema=1, releaseSha=self.sha, format='layers', productionReady=False)
        files={'transport.tgz':transport,'candidate.json':json.dumps(provenance).encode(),
               'release-result.json':json.dumps(report).encode(),'dist-size-report.json':b'{}'}
        if change: change(files)
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as archive:
            for name,data in files.items(): archive.writestr(name,data)
        data=output.getvalue()
        self.artifact['digest']='sha256:'+hashlib.sha256(data).hexdigest()
        return data

    def test_extracts_only_verified_bytes(self):
        data=self.archive()
        with tempfile.TemporaryDirectory() as root:
            dest=Path(root)/'new'
            candidate.unpack(data,self.artifact,self.sha,100,2,dest)
            self.assertEqual(set(p.name for p in dest.iterdir()),candidate.FILES)
            self.assertEqual((dest/'transport.tgz').read_bytes(),b'fake immutable transport')

    def test_rejects_tampering_and_unsafe_entries_before_write(self):
        mutations=[lambda files: files.update({'../escape':b'x'}),
                   lambda files: files.update({'transport.tgz':b'tampered'}),
                   lambda files: files.update({'candidate.json':b'{}'}),
                   lambda files: files.update({'release-result.json':b'{}'})]
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as root:
                data=self.archive(mutation)
                dest=Path(root)/'new'
                with self.assertRaises((ValueError, KeyError)):
                    candidate.unpack(data,self.artifact,self.sha,100,2,dest)
                self.assertFalse(dest.exists())
        data=self.archive()+b'changed'
        with tempfile.TemporaryDirectory() as root, self.assertRaises(ValueError):
            candidate.unpack(data,self.artifact,self.sha,100,2,Path(root)/'new')

    def test_api_selection_and_main_drift(self):
        data=self.archive()
        # Use real current time only for age checks in the mocked API flow.
        from datetime import timedelta
        now=datetime.now(timezone.utc)
        self.artifact['created_at']=(now-timedelta(minutes=1)).isoformat()
        self.artifact['expires_at']=(now+timedelta(hours=23)).isoformat()
        for drift in (False, True):
            with self.subTest(drift=drift), tempfile.TemporaryDirectory() as root:
                main_reads=[]
                calls=[]
                def api(path, binary=False):
                    calls.append(path)
                    if path=='/commits/main':
                        main_reads.append(path)
                        return dict(sha='c'*40 if drift and len(main_reads)>1 else self.sha)
                    return {'':self.repo, '/actions/workflows/ci.yml':self.workflow,
                            '/actions/runs/100':self.run,
                            '/actions/runs/100/attempts/2/jobs?per_page=100':dict(total_count=2,jobs=self.jobs),
                            '/actions/runs/100/artifacts?per_page=100':dict(total_count=1,artifacts=[self.artifact]),
                            '/actions/artifacts/9/zip':data,'/actions/artifacts/9':self.artifact}[path]
                dest=Path(root)/'new'
                with patch.object(candidate,'api',api), patch.object(candidate.sys,'argv',['guard','100','2',self.sha,str(dest)]):
                    if drift:
                        with self.assertRaisesRegex(ValueError,'Main moved'): candidate.main()
                        self.assertFalse(dest.exists())
                    else:
                        candidate.main()
                        self.assertTrue((dest/'transport.tgz').exists())
                self.assertTrue(all('zip' not in c or c=='/actions/artifacts/9/zip' for c in calls))

    def test_rejects_symlink_and_duplicate_members(self):
        good=self.archive()
        for special in ('symlink','duplicate'):
            output=io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(good)) as source, zipfile.ZipFile(output,'w') as target:
                for name in source.namelist():
                    if special=='symlink' and name=='transport.tgz':
                        info=zipfile.ZipInfo(name)
                        info.create_system=3
                        info.external_attr=0o120777 << 16
                        target.writestr(info,b'/outside')
                    else: target.writestr(name,source.read(name))
                if special=='duplicate':
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore',UserWarning)
                        target.writestr('transport.tgz',b'duplicate')
            data=output.getvalue()
            self.artifact['digest']='sha256:'+hashlib.sha256(data).hexdigest()
            with self.subTest(special=special), tempfile.TemporaryDirectory() as root:
                dest=Path(root)/'new'
                with self.assertRaises(ValueError): candidate.unpack(data,self.artifact,self.sha,100,2,dest)
                self.assertFalse(dest.exists())

if __name__ == '__main__': unittest.main()
