"""Check repository path names before running the legacy source handoff."""
import os
import subprocess
import unittest

from test_linux_handoff import HANDOFF, SCRIPT, credential_name


class LegacySourceScope(unittest.TestCase):
    maxDiff = None

    def test_actual_repository_candidate_names_require_no_credential_content(self):
        root = SCRIPT.resolve().parents[2]
        result = subprocess.run(
            ['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
            check=True, capture_output=True,
            env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'GIT_OPTIONAL_LOCKS': '0'},
        )
        names = [name.decode() for name in result.stdout.split(b'\0') if name]
        self.assertIn('ops/aliyun/linux-handoff.py', names)
        self.assertIn('apps/web/.env.example', names)
        self.assertIn('supabase/functions/generation-worker/.npmrc', names)
        rejected = sorted({name for name in names if not credential_name(name) and not HANDOFF.allowed(name)})
        self.assertEqual(rejected, [], 'Review these paths before using the legacy source handoff')


if __name__ == '__main__':
    unittest.main()
