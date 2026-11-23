import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import github_pair_client as client

spec = importlib.util.spec_from_file_location('intake', Path(__file__).with_name('github-rehearsal-intake.py'))
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)


class ClientTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.target = Path(temp.name) / 'payload'
        self.commit, self.run, self.attempt = 'a' * 40, 10, 2
        self.ids = {name: i for i, name in enumerate(client.ARTIFACTS, 10)}
        self.metadata, self.archives = {}, {}
        self.metadata[client.API + '/branches/main'] = dict(name='main', protected=True, commit={'sha': self.commit})
        self.pins = dict(commit=self.commit, runId=self.run, attempt=self.attempt, lane='browser-shadow',
                         frontendNamespace='release-' + self.commit[:12])
        self.statement = dict(sourceSHA=self.commit, runId=self.run, attempt=self.attempt)

        for label in ('backend', 'frontend'):
            digest = self.artifact(label, {'payload': label.encode()})
            self.pins[label] = {'artifactSha256': digest}
            self.statement[label + 'Sha256'] = digest
        self.artifact('descriptor', {'pins.json': json.dumps(self.pins).encode(), 'config.json': b'{}'})
        self.artifact('stage', {'stage.json': json.dumps(self.statement).encode(), 'stage.bundle.jsonl': b'bundle'})

    def artifact(self, label, members):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            for name, body in members.items():
                archive.writestr(name, body)
        raw = out.getvalue()
        digest = hashlib.sha256(raw).hexdigest()
        aid = self.ids[label]
        path = f'{client.API}/actions/artifacts/{aid}'
        self.archives[path + '/zip'] = raw
        prefix = client.ARTIFACTS[label][0]
        self.metadata[path] = dict(id=aid, expired=False, name=f'{prefix}-{self.commit}-{self.run}-{self.attempt}',
                                   size_in_bytes=len(raw), digest='sha256:' + digest,
                                   workflow_run=dict(id=self.run, head_sha=self.commit, head_branch='main',
                                                     repository_id=client.REPO_ID, head_repository_id=client.REPO_ID))
        return digest

    def collect(self):
        def download(path, destination, size):
            destination.write_bytes(self.archives[path])
        client.collect(self.target, commit=self.commit, run=self.run, attempt=self.attempt, ids=self.ids,
                       get=self.metadata.__getitem__, download=download, intake=intake)

    def test_exact_outer_archives_and_safe_descriptors(self):
        self.collect()
        self.assertCountEqual([p.name for p in self.target.iterdir()], [name for name, _ in client.MEMBERS])
        for label in ('backend', 'frontend'):
            self.assertEqual(client.file_sha(self.target / (label + '.zip')), self.pins[label]['artifactSha256'])

    def test_rejects_diagnostic_namespace_even_with_matching_outer_digest(self):
        self.pins['frontendNamespace'] = 'diagnostic-' + self.commit[:12]
        self.artifact('descriptor', {'pins.json': json.dumps(self.pins).encode(), 'config.json': b'{}'})
        with self.assertRaises(ValueError):
            self.collect()

    def test_rejects_cross_attempt_signed_artifact(self):
        path = f'{client.API}/actions/artifacts/{self.ids["stage"]}'
        self.metadata[path]['name'] = self.metadata[path]['name'][:-1] + '1'
        with self.assertRaises(ValueError):
            self.collect()
