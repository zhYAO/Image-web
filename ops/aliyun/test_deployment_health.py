import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('deployment-health.sh')
OLD = 'a' * 40
NEW = 'b' * 40


class DeploymentHealth(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.log = self.root / 'requests.jsonl'
        ssh = self.root / 'ssh'
        ssh.write_text(r"""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['SSH_TEST_LOG'], 'a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\n')
command = sys.argv[-1]
if command == 'readlink -f /opt/zimage/current':
    print(os.environ['SSH_TEST_CURRENT'])
    raise SystemExit(int(os.environ.get('SSH_TEST_READ_EXIT', '0')))
if command.startswith('python3 - '):
    sys.stdin.read()
    raise SystemExit(int(os.environ.get('SSH_TEST_VERIFY_EXIT', '0')))
if command.startswith('sudo /usr/local/sbin/zimage-release rollback '):
    raise SystemExit(int(os.environ.get('SSH_TEST_ROLLBACK_EXIT', '0')))
raise SystemExit(90)
""")
        ssh.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                    'DEPLOY_HOST': 'deploy.invalid', 'DEPLOY_PORT': '22',
                    'SSH_TEST_LOG': str(self.log), 'SSH_TEST_CURRENT': '/opt/zimage/releases/' + NEW}

    def run_health(self, *args, **changes):
        return subprocess.run(['bash', str(SCRIPT), *args], env={**self.env, **changes},
                              capture_output=True, text=True, timeout=5)

    def commands(self):
        return [json.loads(line)[-1] for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_record_reports_exact_retained_release_before_activation(self):
        result = self.run_health('record', SSH_TEST_CURRENT='/opt/zimage/releases/' + OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), OLD)
        self.assertEqual(self.commands(), ['readlink -f /opt/zimage/current'])

    def test_record_rejects_unreadable_or_unexpected_current_before_activation(self):
        for current, status in [('/tmp/' + OLD, '0'), ('/opt/zimage/releases/previous', '0'),
                                ('/opt/zimage/releases/' + OLD, '1')]:
            with self.subTest(current=current, status=status):
                result = self.run_health('record', SSH_TEST_CURRENT=current, SSH_TEST_READ_EXIT=status)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')
        self.assertTrue(all(command.startswith('readlink ') for command in self.commands()))

    def test_successful_verification_never_requests_rollback(self):
        result = self.run_health('verify', NEW, OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.commands(), ['python3 - ' + NEW])

    def test_failed_verification_restores_exact_original_release_and_stays_failed(self):
        result = self.run_health('verify', NEW, OLD, SSH_TEST_VERIFY_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.commands(), ['python3 - ' + NEW, 'readlink -f /opt/zimage/current',
                                          'sudo /usr/local/sbin/zimage-release rollback ' + OLD])
        self.assertIn('Restored original release: ' + OLD, result.stderr)

    def test_same_sha_redeployment_does_not_roll_back_an_older_previous(self):
        result = self.run_health('verify', NEW, NEW, SSH_TEST_VERIFY_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.commands(), ['python3 - ' + NEW, 'readlink -f /opt/zimage/current'])
        self.assertIn('no version change', result.stderr)

    def test_current_drift_or_read_failure_prevents_rollback(self):
        for current, status in [('/opt/zimage/releases/' + OLD, '0'),
                                ('/opt/zimage/releases/' + NEW, '1')]:
            with self.subTest(current=current, status=status):
                result = self.run_health('verify', NEW, OLD, SSH_TEST_VERIFY_EXIT='1',
                                         SSH_TEST_CURRENT=current, SSH_TEST_READ_EXIT=status)
                self.assertEqual(result.returncode, 1)
        self.assertFalse(any(command.startswith('sudo ') for command in self.commands()))

    def test_rollback_failure_is_explicit_and_never_reports_restored(self):
        result = self.run_health('verify', NEW, OLD, SSH_TEST_VERIFY_EXIT='1', SSH_TEST_ROLLBACK_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('Rollback failed', result.stderr)
        self.assertNotIn('Restored original release', result.stderr)

    def test_invalid_release_identifiers_fail_before_ssh(self):
        for sha in ['previous', 'A' * 40, NEW + ';echo unsafe']:
            with self.subTest(sha=sha):
                result = self.run_health('verify', NEW, sha)
                self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.commands(), [])
