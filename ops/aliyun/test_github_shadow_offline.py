import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import github_shadow_offline as offline
from github_hosted_stage_shadow import FIELDS, KIND, PREDICATE


class OfflineTest(unittest.TestCase):
    def test_dry_run_command_is_offline_and_environment_isolated(self):
        expected = dict.fromkeys(FIELDS, 'a'*40)
        expected.update(repository='zhYAO/Image-web', repositoryId=73, runId=42, attempt=2,
                        sourceRef='refs/heads/main', signerWorkflow='trusted/flow/.github/workflows/build.yml')
        payload = json.dumps(dict(expected, schemaVersion=1, kind=KIND, productionReady=False)).encode()
        digest = hashlib.sha256(payload).hexdigest()

        def fake(argv, **kw):
            self.assertGreater(kw['timeout'], 0)
            self.assertEqual(Path(argv[3]).read_bytes(), payload)
            self.assertEqual(Path(argv[-3]).read_bytes(), b'candidate bundle')
            self.assertEqual(Path(argv[-1]).read_bytes(), b'policy root')
            self.assertNotIn('GH_TOKEN', kw['env'])
            self.assertEqual(kw['env']['GH_TELEMETRY'], '0')
            self.assertEqual(kw['env']['HTTPS_PROXY'], 'http://127.0.0.1:9')
            data = dict(statement={'_type': 'https://in-toto.io/Statement/v1',
                                   'predicateType': PREDICATE, 'predicate': {},
                                   'subject': [{'digest': {'sha256': digest}}]},
                        signature={'certificate': {'sourceRepositoryIdentifier': '73', 'runInvocationURI':
                            'https://github.com/zhYAO/Image-web/actions/runs/42/attempts/2'}})
            return subprocess.CompletedProcess(argv, 0, json.dumps([dict(verificationResult=data)]).encode())

        with patch.dict(os.environ, GH_TOKEN='foreign', HTTPS_PROXY='foreign'), \
             patch.object(offline, '_read_trusted', side_effect=(b'bin', b'policy root')), \
             patch.object(offline.subprocess, 'run', side_effect=fake):
            result = offline.verify(payload=payload, bundle=b'candidate bundle', expected=expected,
                                    gh_path='/trusted/gh', gh_sha256='a'*64,
                                    trusted_root_path='/trusted/root', trusted_root_sha256='b'*64)
        self.assertEqual(result['verified_subject_sha256'], digest)
        self.assertNotIn('productionReady', result)

    def test_untrusted_root_symlink_or_digest_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'root'
            path.write_bytes(b'actual')
            alias = Path(td) / 'alias'
            alias.symlink_to(path)
            with self.assertRaises(ValueError):
                offline._trusted_ancestors(path, Path('/etc/zimage'))
            with patch.object(offline, '_trusted_ancestors'), self.assertRaises(OSError):
                offline._read_trusted(alias, 42, 'a'*64, Path(td))
            with patch.object(offline, '_trusted_ancestors'), patch.object(offline.os, 'fstat', return_value=type('Owned', (), {
                'st_mode': 0o100400, 'st_uid': 0, 'st_size': 6})()), self.assertRaises(ValueError):
                offline._read_trusted(path, 42, 'a'*64, Path(td))

    def test_ancestor_rejects_symlink_group_write_and_nonroot(self):
        path = Path('/etc/zimage/receipt/roots.jsonl')
        for bad_mode, uid in ((0o120755, 0), (0o040775, 0), (0o040755, 501)):
            def stat_parent(parent):
                mode, owner = (bad_mode, uid) if parent == Path('/etc/zimage') else (0o040755, 0)
                return type('Stat', (), {'st_mode': mode, 'st_uid': owner})()
            with patch.object(Path, 'lstat', autospec=True, side_effect=stat_parent), self.assertRaises(ValueError):
                offline._trusted_ancestors(path, Path('/etc/zimage'))
