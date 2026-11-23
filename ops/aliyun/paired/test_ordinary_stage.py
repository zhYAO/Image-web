import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
import zipfile

import core
import ordinary_stage


def load(name, relative):
    path = Path(__file__).resolve().parents[1] / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


intake = load('intake', 'github-rehearsal-intake.py')
manifest = load('formal_manifest', 'frontend/manifest.py')


class StageTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.workspace = Path(temp.name).resolve()
        self.request = self.workspace / 'request'
        self.request.mkdir()
        self.sha = 'a' * 40
        self.namespace = 'release-' + self.sha[:12]
        self.source = dict(sourceSHA=self.sha, treeFingerprint='b' * 64, lockfileSha256='c' * 64, dirty=False)
        api = dict(major=1, minMinor=0, capabilities=[])
        self.config = dict(schemaVersion=1, formalAuth=True, dataMode='http', captchaSiteKey=None,
                           approvedLegalVersion=None, registrationEnabled=False)
        dist = self.workspace / 'dist'
        (dist / '.release').mkdir(parents=True)
        (dist / 'index.html').write_text('<h1>Non-production workspace</h1>', encoding='utf-8')
        candidate = dict(schemaVersion=1, namespace=self.namespace, sourceIdentity=self.source,
                         apiRequirements=api, allowedBackendReleases=[self.sha], buildToolchainFingerprint='d' * 64)
        (dist / '.release/candidate.json').write_bytes(core.canonical(candidate))
        _, _, subject = manifest.candidate_files(dist, self.config)
        stage_evidence = dict(subject, backendReleases=[dict(backendRelease=self.sha, acceptanceSha256='e' * 64)])
        planned = manifest.pack(dist, self.workspace / 'reference.tgz',
                                dict(assetNamespace=self.namespace, sourceSHA=self.sha, treeFingerprint='b' * 64,
                                     build=dict(toolchainFingerprint='d' * 64, lockfileSha256='c' * 64),
                                     apiRequirements=api, verifiedBackendReleases=[self.sha]), self.config, stage_evidence)
        frontend = self.workspace / 'frontend.tgz'
        with tarfile.open(frontend, 'w:gz', format=tarfile.USTAR_FORMAT) as archive:
            for name in ('index.html', '.release/candidate.json'):
                body = (dist / name).read_bytes()
                entry = tarfile.TarInfo(name)
                entry.size = len(body)
                archive.addfile(entry, io.BytesIO(body))
        backend, backend_manifest = b'non-production transport', 'f' * 64
        pinned = dict(commit=self.sha, runId=2, attempt=1, lane='browser-shadow', frontendNamespace=self.namespace,
                      treeFingerprint='b' * 64, lockfileSha256='c' * 64)
        pinned['backend'] = self.artifact('backend', {'transport.tgz': backend}, 'manifestSha256', backend_manifest)
        subject_bytes = core.canonical(dict(subject, **candidate, acceptanceRequired=True))
        pinned['frontend'] = self.artifact('frontend', {'frontend-rehearsal.tgz': frontend.read_bytes(),
                                                        'frontend-subject.json': subject_bytes}, 'subjectSha256', self.digest(subject_bytes))
        (self.request / 'pins.json').write_bytes(core.canonical(pinned))
        (self.request / 'config.json').write_bytes(core.canonical(self.config))
        self.evidence = dict(artifactDigests={name: pinned[name]['artifactSha256'] for name in ('backend', 'frontend')})
        self.packet = dict(commit=self.sha, runId=2, attempt=1, backendManifestSha256=backend_manifest,
                           frontendSubjectSha256=pinned['frontend']['subjectSha256'])
        self.approval = dict(backendArchiveSha256=self.digest(backend), frontendArchiveSha256=planned['archiveSha256'],
                             frontendManifestSha256=planned['manifestSha256'], stagingAcceptanceSha256='e' * 64,
                             newPair=dict(backend=self.sha, frontend=self.namespace))
        self.acceptance = dict(stage_evidence, artifactId=planned['artifactId'], manifestSha256=planned['manifestSha256'])
        self.backend = Mock(return_value=dict(backendRelease=self.sha, manifestSha256=backend_manifest, activated=False))
        self.system = SimpleNamespace(c=core, paths=SimpleNamespace(etc=self.workspace / 'root-config'),
                                      raw=Mock(side_effect=lambda path: core.canonical(self.acceptance)),
                                      m=SimpleNamespace(frontend=SimpleNamespace(m=manifest), bridge=object(), adapter=object(),
                                                        stage=SimpleNamespace(prepare=self.backend)))

    @staticmethod
    def digest(body):
        return hashlib.sha256(body).hexdigest()

    def artifact(self, component, files, field, digest):
        receipt = dict(schema=1, kind='isolated-github-browser-shadow', productionReady=False,
                       repository='zhYAO/Image-web', workflow=intake.WORKFLOW, commit=self.sha, runId=2, attempt=1,
                       component=component,
                       files=[dict(name=name, bytes=len(body), sha256=self.digest(body)) for name, body in files.items()])
        if component == 'frontend':
            receipt['backendToEvaluate'] = self.sha
        receipt = core.canonical(receipt)
        artifact = self.request / (component + '.zip')
        with zipfile.ZipFile(artifact, 'w') as archive:
            for name, body in dict(files, **{'rehearsal-receipt.json': receipt}).items():
                archive.writestr(name, body)
        return {'artifactSha256': self.digest(artifact.read_bytes()), 'receiptSha256': self.digest(receipt),
                'archiveSha256': self.digest(next(iter(files.values()))), field: digest}

    def prepare(self):
        return ordinary_stage.prepare(self.request, self.evidence, self.packet, self.approval,
                                      system=self.system, intake=intake)

    def test_real_frontend_bytes_rebuild_and_backend_gets_exact_private_transport(self):
        result = self.prepare()
        self.assertEqual(result['archiveSha256'], self.approval['frontendArchiveSha256'])
        work = self.request / 'private-pair-stage'
        self.assertEqual((work / 'frontend-release.tgz').read_bytes(), (self.workspace / 'reference.tgz').read_bytes())
        self.assertEqual(self.backend.call_args.kwargs['received'], work / 'backend/transport.tgz')
        self.system.raw.assert_called_once_with(self.system.paths.etc / 'frontend-acceptances' / (result['artifactId'] + '.json'))

    def test_zips_are_rechecked_against_signed_digests(self):
        (self.request / 'frontend.zip').write_bytes(b'foreign bytes')
        with self.assertRaises(ValueError):
            self.prepare()
        self.system.raw.assert_not_called()
        self.backend.assert_not_called()

    def test_independent_frontend_acceptance_drift_blocks_backend_staging(self):
        self.acceptance['backendReleases'][0]['acceptanceSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'acceptance'):
            self.prepare()
        self.backend.assert_not_called()

    def test_formal_frontend_archive_drift_blocks_backend_staging(self):
        self.approval['frontendArchiveSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'approved package'):
            self.prepare()
        self.backend.assert_not_called()
