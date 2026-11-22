import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('shadow_intake', HERE / 'github-rehearsal-intake.py')
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)


class ShadowMode(unittest.TestCase):
    def test_shell_gate_and_namespace(self):
        env = dict(os.environ, ZIMAGE_PROTECTED_MAIN_BROWSER_SHADOW='true',
                   ZIMAGE_PAIRED_BUILD_MODE='false', ZIMAGE_PAIRED_PRODUCTION='false',
                   GITHUB_REF='refs/heads/main', GITHUB_REF_PROTECTED='true',
                   GITHUB_REPOSITORY='zhYAO/Image-web', GITHUB_EVENT_NAME='push',
                   RUNNER_ENVIRONMENT='github-hosted', RUNNER_OS='Linux',
                   GITHUB_SHA='a'*40)
        fn = 'set -e; source "$1"; zimage_shadow_mode "${2:-}"; zimage_frontend_namespace'
        def run(args=(), **updates):
            return subprocess.run(['bash', '-c', fn, 'shadow', str(HERE / 'github-shadow-mode.sh'), *args],
                                  env=dict(env, **updates), capture_output=True, text=True)
        self.assertEqual(run().stdout.strip(), 'release-'+'a'*12)
        for key, value in (('GITHUB_REF', 'refs/pull/1/merge'), ('GITHUB_EVENT_NAME', 'workflow_dispatch'),
                           ('GITHUB_REF_PROTECTED', 'false'), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                           ('ZIMAGE_PAIRED_BUILD_MODE', 'true'), ('ZIMAGE_PAIRED_PRODUCTION', ''),
                           ('ZIMAGE_PAIRED_PRODUCTION', 'true')):
            self.assertNotEqual(run(**{key: value}).returncode, 0, key)
        self.assertNotEqual(run(('production',)).returncode, 0)

    def test_hosted_extractor_requires_exact_namespace_and_lane(self):
        sha = 'a' * 40
        legacy = dict(commit=sha, runId=42, attempt=1, frontendNamespace=f'rehearsal-{sha}-42-1')
        shadow = dict(legacy, frontendNamespace='release-' + sha[:12], lane='browser-shadow')
        self.assertTrue(intake.hosted_namespace(shadow, 'hosted-shadow'))
        self.assertFalse(intake.hosted_namespace(legacy, 'hosted-smoke'))
        for pins, mode in ((legacy, 'hosted-shadow'), (shadow, 'hosted-smoke'),
                           (dict(shadow, lane=None), 'hosted-shadow'),
                           (dict(shadow, frontendNamespace='release-' + 'b' * 12), 'hosted-shadow')):
            with self.subTest(mode=mode, pins=pins), self.assertRaises(ValueError):
                intake.hosted_namespace(pins, mode)

    def test_receipt_kinds_are_not_interchangeable(self):
        digest = lambda data: hashlib.sha256(data).hexdigest()
        sha = 'a'*40
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'transport.tgz').write_bytes(b'archive')
            pin = {'archiveSha256': digest(b'archive')}
            for shadow in (False, True):
                kind = 'isolated-github-browser-shadow' if shadow else 'isolated-github-rehearsal'
                doc = dict(schema=1, kind=kind, productionReady=False, repository='zhYAO/Image-web',
                           workflow=intake.WORKFLOW, commit=sha, runId=1, attempt=1, component='backend',
                           files=[dict(name='transport.tgz', bytes=7, sha256=pin['archiveSha256'])])
                body = json.dumps(doc).encode()
                (root/'rehearsal-receipt.json').write_bytes(body)
                pin['receiptSha256'] = digest(body)
                intake.closure_receipt(root, 'backend', pin, sha, 1, 1, shadow=shadow)
                with self.assertRaisesRegex(ValueError, 'does not bind'):
                    intake.closure_receipt(root, 'backend', pin, sha, 1, 1, shadow=not shadow)
