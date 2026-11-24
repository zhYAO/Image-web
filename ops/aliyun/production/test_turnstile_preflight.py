"""Offline tests exercise the actual preflight command without account access."""

import subprocess
import sys
import unittest
from pathlib import Path


class TurnstilePreflight(unittest.TestCase):
    def invoke(self, key=None):
        env = {} if key is None else {'NEXT_PUBLIC_TURNSTILE_SITE_KEY': key}
        return subprocess.run(
            [sys.executable, '-I', '-B', str(Path(__file__).with_name('check_turnstile.py'))],
            env=env, capture_output=True, text=True, check=False,
        )

    def test_rejects_unset_malformed_and_each_published_dummy_without_echo(self):
        for key in (
            None, '', ' ', 'missing', 'unsafe.fixture.value', 'X' * 101,
            '1x00000000000000000000AA', '2x00000000000000000000AB',
            '1x00000000000000000000BB', '2x00000000000000000000BB',
            '3x00000000000000000000FF', '1x00000000000000000000AA ',
            'X' * 22 + '\n',
        ):
            with self.subTest(key=key):
                result = self.invoke(key)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr.strip(), 'Production requires a configured, non-test Turnstile site key.')

    def test_accepts_synthetic_supported_shape_without_echo(self):
        result = self.invoke('synthetic_Site-Key_12345678901234')
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
