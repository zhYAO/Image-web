import hashlib
import io
import json
import unittest
import zipfile

from github_shadow_signer_caller import statement
from test_github_shadow_signer_intake import Intake, REPO


class CallerTest(unittest.TestCase):
    def test_exact_attempt_only(self):
        fixture = Intake()
        fixture.setUp()
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('stage-report.json', json.dumps(fixture.report))
        raw = archive.getvalue()
        base = '/repos/' + REPO
        run = base + '/actions/runs/42/attempts/3'
        suffix = 'a' * 40 + '-42-3'
        endpoints = {
            run: fixture.run,
            run + '/jobs?per_page=100': dict(total_count=1, jobs=[fixture.job]),
            base + '/branches/main': dict(name='main', protected=True, commit=dict(sha='a' * 40)),
        }
        for aid, label in ((6, 'shadow-stage-report'), (7, 'shadow-rehearsal-backend'),
                           (8, 'shadow-rehearsal-frontend')):
            digest = hashlib.sha256(raw).hexdigest() if aid == 6 else 'b' * 64
            endpoints[f'{base}/actions/artifacts/{aid}'] = dict(
                id=aid, workflow_run=fixture.binding, expired=False, name=f'{label}-{suffix}',
                digest='sha256:' + digest, size_in_bytes=len(raw),
            )

        def get_zip(path, limit):
            self.assertEqual((path, limit), (base + '/actions/artifacts/6/zip', 65536))
            return raw

        def call():
            return statement(endpoints.__getitem__, get_zip,
                             ids=dict(report=6, backend=7, frontend=8), expected=fixture.expected,
                             workflow_id=99, stage_job_name='shadow-stage')

        self.assertIs(json.loads(call())['productionReady'], False)
        for path, key, bad in (
            (base + '/actions/artifacts/7', 'digest', 'sha256:' + 'c' * 64),
            (base + '/actions/artifacts/8', 'name', 'out-of-attempt'),
            (run + '/jobs?per_page=100', 'total_count', 2),
            (base + '/branches/main', 'protected', False),
        ):
            original = endpoints[path][key]
            endpoints[path][key] = bad
            try:
                with self.subTest(key=key), self.assertRaises(ValueError):
                    call()
            finally:
                endpoints[path][key] = original
