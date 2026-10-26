import json
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys


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
if command == 'readlink -f /opt/zimage/previous':
    print(os.environ['SSH_TEST_PREVIOUS'])
    raise SystemExit(0)
if command == 'sha256sum /usr/local/sbin/zimage-release':
    print(os.environ['SSH_TEST_HELPER_SHA'] + '  /usr/local/sbin/zimage-release')
    raise SystemExit(0)
if command.startswith('python3 - '):
    sys.stdin.read()
    raise SystemExit(int(os.environ.get('SSH_TEST_VERIFY_EXIT', '0')))
if command.startswith('sudo /usr/local/sbin/zimage-release rollback '):
    raise SystemExit(int(os.environ.get('SSH_TEST_ROLLBACK_EXIT', '0')))
raise SystemExit(90)
""")
        ssh.chmod(0o755)
        python = self.root / 'python3'
        python.write_text('''#!''' + sys.executable + '''
import json, os, sys
if len(sys.argv) > 1 and sys.argv[1].endswith('/verify-release.py'):
    with open(os.environ['SSH_TEST_LOG'], 'a') as log:
        log.write(json.dumps(['runner-public', *sys.argv[2:]]) + '\\n')
    option = 'RUNNER_TEST_RECOVERY_EXIT' if '--public-recovery' in sys.argv else 'RUNNER_TEST_VERIFY_EXIT'
    raise SystemExit(int(os.environ.get(option, '0')))
os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
''')
        python.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                    'DEPLOY_HOST': 'deploy.invalid', 'DEPLOY_PORT': '22',
                    'SSH_TEST_HELPER_SHA': hashlib.sha256(SCRIPT.with_name('release.py').read_bytes()).hexdigest(),
                    'SSH_TEST_PREVIOUS': '/opt/zimage/releases/' + OLD,
                    'SSH_TEST_LOG': str(self.log), 'SSH_TEST_CURRENT': '/opt/zimage/releases/' + NEW}

    def run_health(self, *args, **changes):
        return subprocess.run(['bash', str(SCRIPT), *args], env={**self.env, **changes},
                              capture_output=True, text=True, timeout=5)

    def commands(self):
        return [row[-1] for row in self.events() if row[0] != 'runner-public']

    def events(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_record_reports_exact_retained_release_before_activation(self):
        result = self.run_health('record', SSH_TEST_CURRENT='/opt/zimage/releases/' + OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), OLD)
        self.assertEqual(self.commands(), ['sha256sum /usr/local/sbin/zimage-release', 'readlink -f /opt/zimage/current'])

    def test_old_root_helper_stops_before_any_activation_or_rollback(self):
        result = self.run_health('record', SSH_TEST_HELPER_SHA='0' * 64)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertIn('release helper', result.stderr.lower())
        self.assertEqual(self.commands(), ['sha256sum /usr/local/sbin/zimage-release'])

    def test_record_rejects_unreadable_or_unexpected_current_before_activation(self):
        for current, status in [('/tmp/' + OLD, '0'), ('/opt/zimage/releases/previous', '0'),
                                ('/opt/zimage/releases/' + OLD, '1')]:
            with self.subTest(current=current, status=status):
                result = self.run_health('record', SSH_TEST_CURRENT=current, SSH_TEST_READ_EXIT=status)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')
        self.assertTrue(all(command.startswith(('readlink ', 'sha256sum ')) for command in self.commands()))

    def test_successful_verification_never_requests_rollback(self):
        result = self.run_health('verify', NEW, OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.commands(), ['python3 - ' + NEW])
        self.assertEqual(self.events()[-1], ['runner-public', NEW, '--public-only'])

    def test_failed_external_check_after_local_success_rolls_back_exact_original(self):
        result = self.run_health('verify', NEW, OLD, RUNNER_TEST_VERIFY_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.events()[1], ['runner-public', NEW, '--public-only'])
        self.assertEqual(self.commands(), ['python3 - ' + NEW, 'readlink -f /opt/zimage/current',
                                          'sudo /usr/local/sbin/zimage-release rollback ' + OLD])
        self.assertIn('Restored original release', result.stderr)
        self.assertEqual(self.events()[-1], ['runner-public', OLD, '--public-recovery'])

    def test_external_recovery_failure_remains_explicit_without_reselecting_bad_version(self):
        result = self.run_health('verify', NEW, OLD, RUNNER_TEST_VERIFY_EXIT='1', RUNNER_TEST_RECOVERY_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('external recovery verification failed', result.stderr.lower())
        self.assertNotIn('Restored original release:', result.stderr)
        self.assertEqual([c for c in self.commands() if c.startswith('sudo ')],
                         ['sudo /usr/local/sbin/zimage-release rollback ' + OLD])

    def test_manual_previous_rollback_checks_external_legacy_paths(self):
        result = self.run_health('rollback', 'previous', SSH_TEST_CURRENT='/opt/zimage/releases/' + OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.commands(), ['sha256sum /usr/local/sbin/zimage-release',
                                          'readlink -f /opt/zimage/previous',
                                          'sudo /usr/local/sbin/zimage-release rollback ' + OLD,
                                          'readlink -f /opt/zimage/current'])
        self.assertEqual(self.events()[-1], ['runner-public', OLD, '--public-recovery'])

    def test_unversioned_manual_rollback_stops_before_changing_the_current_release(self):
        result = self.run_health('rollback', 'previous', SSH_TEST_PREVIOUS='/opt/zimage/releases/legacy-20260917')
        self.assertEqual(result.returncode, 1)
        self.assertFalse(any(c.startswith('sudo ') for c in self.commands()))

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
