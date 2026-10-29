import json
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys
import shutil
import re
import shlex


SCRIPT = Path(__file__).with_name('deployment-health.sh')
OLD = 'a' * 40
NEW = 'b' * 40
BASH = shutil.which('bash')
if not BASH and os.name == 'nt':
    candidate = Path.home() / 'AppData/Local/Programs/Git/bin/bash.exe'
    BASH = str(candidate) if candidate.is_file() else None
HARNESS = ('readonly FIXTURE_PYTHON FIXTURE_SSH FIXTURE_VERIFY HEALTH_SCRIPT; '
           'ssh() { "$FIXTURE_PYTHON" -I -B "$FIXTURE_SSH" "$@"; }; '
           'python3() { "$FIXTURE_PYTHON" -I -B "$FIXTURE_VERIFY" "$@"; }; '
           'readonly -f ssh python3; '
           'test "$(type -t ssh)" = function && test "$(type -t python3)" = function || exit 92; ')


@unittest.skipUnless(BASH, 'Requires existing Bash; no real SSH or service is used')
class DeploymentHealth(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.log = self.root / 'requests.jsonl'
        ssh = self.root / 'ssh-fixture.py'
        ssh.write_text(r"""#!/usr/bin/env python3
import json, os, sys
sys.stdout.reconfigure(newline='\n')
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
    raise SystemExit(int(os.environ.get('SSH_TEST_HELPER_EXIT', '0')))
if command.startswith('sha256sum /usr/local/libexec/zimage-three-layer/'):
    name = command.rsplit('/', 1)[-1]
    print(json.loads(os.environ['SSH_TEST_LAYER_HASHES'])[name] + '  ' + name)
    raise SystemExit(int(os.environ.get('SSH_TEST_LAYER_HELPER_EXIT', '0')))
if command.endswith('release-three-layer.py check-target'):
    raise SystemExit(int(os.environ.get('SSH_TEST_GATE_EXIT', '0')))
if command.startswith('if test -') and '/opt/zimage/releases/' in command:
    print(os.environ.get('SSH_TEST_FORMAT', 'full'))
    raise SystemExit(0)
if command.startswith('python3 - '):
    sys.stdin.read()
    raise SystemExit(int(os.environ.get('SSH_TEST_VERIFY_EXIT', '0')))
if command.startswith('sudo /usr/local/sbin/zimage-release rollback '):
    raise SystemExit(int(os.environ.get('SSH_TEST_ROLLBACK_EXIT', '0')))
if 'release-three-layer.py rollback ' in command:
    raise SystemExit(int(os.environ.get('SSH_TEST_ROLLBACK_EXIT', '0')))
raise SystemExit(90)
""")
        ssh.chmod(0o755)
        python = self.root / 'python-fixture.py'
        python.write_text('''#!''' + sys.executable + '''
import json, os, sys
sys.stdout.reconfigure(newline='\\n')
if len(sys.argv) > 1 and sys.argv[1].endswith('/verify-release.py'):
    with open(os.environ['SSH_TEST_LOG'], 'a') as log:
        log.write(json.dumps(['runner-public', *sys.argv[2:]]) + '\\n')
    option = 'RUNNER_TEST_RECOVERY_EXIT' if '--public-recovery' in sys.argv else 'RUNNER_TEST_VERIFY_EXIT'
    raise SystemExit(int(os.environ.get(option, '0')))
raise SystemExit(91)  # No fallback to real verification or another interpreter.
''')
        python.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                    'MSYS_NO_PATHCONV': '1', 'MSYS2_ARG_CONV_EXCL': '*', 'MSYS2_ENV_CONV_EXCL': '*',
                    'RELEASE_FORMAT': 'full',
                    'SSH_TEST_LAYER_HASHES': json.dumps({name: hashlib.sha256(SCRIPT.with_name(name).read_bytes()).hexdigest() for name in
                        ('release-three-layer.py', 'release.py', 'release-layers.py', 'three-layer-release.py', 'release-transport.py', 'release-public-policy.json')}),
                    'DEPLOY_HOST': 'deploy.invalid', 'DEPLOY_PORT': '22',
                    'SSH_TEST_HELPER_SHA': hashlib.sha256(SCRIPT.with_name('release.py').read_bytes()).hexdigest(),
                    'SSH_TEST_PREVIOUS': '/opt/zimage/releases/' + OLD,
                    'SSH_TEST_LOG': str(self.log), 'SSH_TEST_CURRENT': '/opt/zimage/releases/' + NEW,
                    'FIXTURE_PYTHON': Path(sys.executable).as_posix(), 'FIXTURE_SSH': ssh.as_posix(),
                    'FIXTURE_VERIFY': python.as_posix(), 'HEALTH_SCRIPT': SCRIPT.absolute().as_posix()}
        source = SCRIPT.read_text()
        for bypass in ('command ssh', 'env ssh', '/usr/bin/ssh', 'command python3', 'env python3', 'curl '):
            self.assertNotIn(bypass, source, 'Unexpected fixture bypass in health script')
        # Prove the same-shell definitions and fail-closed unknown operations
        # before executing the health script, without relying on PATH search.
        proof = subprocess.run([BASH, '--noprofile', '--norc', '-c', HARNESS +
            'ssh fixture-unsupported; a=$?; python3 fixture-unsupported; b=$?; '
            'test "$a" = 90 && test "$b" = 91'], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(proof.returncode, 0, proof.stderr)
        self.assertEqual(self.events(), [['fixture-unsupported']])
        self.log.unlink()

    def run_health(self, *args, **changes):
        # Same-shell readonly functions make fallback to real SSH/Python
        # impossible, including Git Bash's Windows PATH normalization.
        harness = HARNESS + 'source "$HEALTH_SCRIPT" "$@"'
        return subprocess.run([BASH, '--noprofile', '--norc', '-c', harness, 'health-fixture', *args], env={**self.env, **changes},
                              capture_output=True, text=True, timeout=20)

    def commands(self):
        # Format selection is separately asserted by layer-specific tests.
        return [row[-1] for row in self.events() if row[0] != 'runner-public' and not row[-1].startswith('if test -')]

    def events(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_record_reports_exact_retained_release_before_activation(self):
        result = self.run_health('record', SSH_TEST_CURRENT='/opt/zimage/releases/' + OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), OLD)
        self.assertEqual(self.commands(), ['sha256sum /usr/local/sbin/zimage-release', 'readlink -f /opt/zimage/current'])
        self.assertEqual(self.events()[-1], ['runner-public', OLD, '--public-recovery'])

    def test_unreachable_public_original_stops_before_recording_or_activation(self):
        result = self.run_health('record', SSH_TEST_CURRENT='/opt/zimage/releases/' + OLD,
                                 RUNNER_TEST_RECOVERY_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('before activation', result.stderr)
        self.assertEqual(self.events()[-1], ['runner-public', OLD, '--public-recovery'])
        self.assertFalse(any(c.startswith('sudo ') for c in self.commands()))

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
                                          'sha256sum /usr/local/sbin/zimage-release',
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
        self.assertEqual(self.commands(), ['readlink -f /opt/zimage/previous',
                                          'sha256sum /usr/local/sbin/zimage-release',
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
                                          'sha256sum /usr/local/sbin/zimage-release',
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

    def test_layer_inventory_gate_checks_complete_closure_and_enabled_target(self):
        result = self.run_health('check-install', RELEASE_FORMAT='layers')
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.commands()
        self.assertEqual(len([c for c in commands if c.startswith('sha256sum ')]), 6)
        self.assertTrue(any('release-transport.py' in c for c in commands))
        self.assertTrue(commands[-1].endswith('release-three-layer.py check-target'))
        result = self.run_health('check-install', RELEASE_FORMAT='layers', SSH_TEST_GATE_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Administrator', result.stderr)

    def test_layer_rollback_selects_exact_original_format(self):
        result = self.run_health('rollback', OLD, SSH_TEST_FORMAT='layers', SSH_TEST_CURRENT='/opt/zimage/releases/' + OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('sudo /usr/bin/python3 -I /usr/local/libexec/zimage-three-layer/release-three-layer.py rollback ' + OLD, self.commands())
        self.assertFalse(any(c.startswith('sudo /usr/local/sbin/') for c in self.commands()))

    def test_full_new_failure_restores_layered_original_with_reviewed_adapter(self):
        result = self.run_health('verify', NEW, OLD, RELEASE_FORMAT='full', SSH_TEST_FORMAT='layers', RUNNER_TEST_VERIFY_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('Restored original release: ' + OLD, result.stderr)
        self.assertIn('sudo /usr/bin/python3 -I /usr/local/libexec/zimage-three-layer/release-three-layer.py rollback ' + OLD, self.commands())
        self.assertFalse(any(c.startswith('sudo /usr/local/sbin/') for c in self.commands()))
        self.assertEqual(self.events()[-1], ['runner-public', OLD, '--public-recovery'])

    def test_mismatched_layer_closure_stops_before_enabled_gate(self):
        hashes = json.loads(self.env['SSH_TEST_LAYER_HASHES'])
        hashes['release-transport.py'] = '0' * 64
        result = self.run_health('check-install', RELEASE_FORMAT='layers', SSH_TEST_LAYER_HASHES=json.dumps(hashes))
        self.assertEqual(result.returncode, 1)
        self.assertIn('administrator installation', result.stderr)
        self.assertFalse(any('check-target' in c or c.startswith('sudo ') for c in self.commands()))

    def test_damaged_retained_format_cannot_downgrade_to_full(self):
        result = self.run_health('rollback', OLD, SSH_TEST_FORMAT='invalid')
        self.assertEqual(result.returncode, 1)
        self.assertIn('damaged', result.stderr)
        self.assertFalse(any(c.startswith('sudo ') for c in self.commands()))

    def assert_record_rejected(self, **changes):
        self.log.unlink(missing_ok=True)
        result = self.run_health('record', **changes)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '', 'Rejected original must not become a usable rollback point')
        self.assertFalse(any(' rollback ' in c or ' deploy ' in c for c in self.commands()))
        self.assertFalse(any(row[0] == 'runner-public' for row in self.events()))

    def test_record_full_over_layers_rejects_missing_stale_disabled_prerequisites(self):
        hashes = json.loads(self.env['SSH_TEST_LAYER_HASHES'])
        hashes['release-transport.py'] = '0' * 64
        cases = [dict(SSH_TEST_LAYER_HELPER_EXIT='1'), dict(SSH_TEST_LAYER_HASHES=json.dumps(hashes)),
                 dict(SSH_TEST_GATE_EXIT='1'), dict(SSH_TEST_GATE_EXIT='2')]
        for case in cases:
            with self.subTest(case=case):
                self.assert_record_rejected(RELEASE_FORMAT='full', SSH_TEST_FORMAT='layers', **case)

    def test_record_layers_over_full_rejects_missing_or_stale_separate_legacy_helper(self):
        for case in [dict(SSH_TEST_HELPER_EXIT='1'), dict(SSH_TEST_HELPER_SHA='0' * 64)]:
            with self.subTest(case=case):
                self.assert_record_rejected(RELEASE_FORMAT='layers', SSH_TEST_FORMAT='full', **case)

    def test_record_cross_format_checks_both_helpers_before_public_original(self):
        result = self.run_health('record', RELEASE_FORMAT='full', SSH_TEST_FORMAT='layers')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), NEW)
        commands = self.commands()
        self.assertIn('sha256sum /usr/local/sbin/zimage-release', commands)
        self.assertEqual(len([c for c in commands if '/usr/local/libexec/' in c and c.startswith('sha256sum ')]), 6)
        self.assertTrue(commands[-1].endswith('release-three-layer.py check-target'))
        self.assertEqual(self.events()[-1], ['runner-public', NEW, '--public-recovery'])

    def test_record_full_only_installation_does_not_require_unused_layer_tools(self):
        result = self.run_health('record', RELEASE_FORMAT='full', SSH_TEST_FORMAT='full', SSH_TEST_LAYER_HELPER_EXIT='1', SSH_TEST_GATE_EXIT='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), NEW)
        self.assertFalse(any('/usr/local/libexec/' in c for c in self.commands()))

    def test_record_damaged_original_format_cannot_emit_rollback_point(self):
        self.assert_record_rejected(RELEASE_FORMAT='full', SSH_TEST_FORMAT='invalid')

    def local_format(self, directory):
        # Execute the ACTUAL fixed-target predicate locally, replacing only its
        # reviewed fixed root with an owned temporary fixture. No SSH involved.
        source = SCRIPT.read_text()
        matches = re.findall(r'"(if test -[^"\n]+; fi)"', source)
        self.assertEqual(len(matches), 1, 'Expected exactly one shared retained format predicate')
        fixed = '/opt/zimage/releases/$target'
        self.assertIn(fixed, matches[0])
        predicate = matches[0].replace(fixed, shlex.quote(directory.as_posix()))
        self.assertTrue(all(token not in predicate for token in ('ssh', 'sudo', 'curl', 'python', '$target')))
        result = subprocess.run([BASH, '--noprofile', '--norc', '-c', predicate], env=self.env,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_actual_format_predicate_regular_and_directory_metadata(self):
        directory = self.root / 'retained'
        directory.mkdir()
        self.assertEqual(self.local_format(directory), 'full')
        for name, expected in [('.three-layer-release.json', 'layers'), ('.manifest-sha256', 'invalid')]:
            metadata = directory / name
            metadata.write_text('metadata')
            self.assertEqual(self.local_format(directory), expected)
            metadata.unlink()
            metadata.mkdir()
            self.assertEqual(self.local_format(directory), expected)
            metadata.rmdir()

    def test_actual_format_predicate_link_and_dangling_metadata(self):
        directory, target = self.root / 'retained', self.root / 'metadata-target'
        directory.mkdir()
        for name, expected in [('.three-layer-release.json', 'layers'), ('.manifest-sha256', 'invalid')]:
            target.mkdir()
            metadata = directory / name
            try:
                metadata.symlink_to(target, target_is_directory=True)
            except OSError as error:
                if os.name != 'nt':
                    raise
                import _winapi
                try:
                    _winapi.CreateJunction(str(target), str(metadata))
                except OSError:
                    self.skipTest('Native symlink and TEMP directory junction unavailable: ' + str(error))
            self.assertEqual(self.local_format(directory), expected)
            target.rmdir()  # Only the owned empty fixture target, making the link dangling.
            self.assertEqual(self.local_format(directory), expected)
            if os.name == 'nt' and metadata.is_junction():
                metadata.rmdir()
            else:
                metadata.unlink()
