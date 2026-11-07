"""Verify the Node archive cache and fail-closed download behavior offline."""
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


HELPER = Path(__file__).with_name("yunxiao-node-archive-draft.sh")
GOOD = b"verified archive fixture\n"
DIGEST = hashlib.sha256(GOOD).hexdigest()


class NodeArchiveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="yunxiao-node-test-")
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.cache = self.root / "cache" / "node.tar.gz"
        self.calls = self.root / "calls"
        (self.root / "good").write_bytes(GOOD)
        (self.root / "bad").write_bytes(b"tampered archive\n")
        curl = self.bin / "curl"
        curl.write_text('''#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$TEST_CALLS"
output=''
url=''
while [[ $# -gt 0 ]]; do
  case "$1" in --output) output="$2"; shift 2;; https://*) url="$1"; shift;; *) shift;; esac
done
if [[ "${FAIL_MIRROR:-0}" == 1 && "$url" == *npmmirror.com* ]]; then exit 22; fi
if [[ "${FAIL_ALL:-0}" == 1 ]]; then printf 'partial' > "$output"; exit 28; fi
cp "${TEST_PAYLOAD:?}" "$output"
''')
        curl.chmod(0o755)
        # The production Linux image has sha256sum; adapt macOS shasum for this fixture.
        sha = self.bin / "sha256sum"
        sha256sum = shutil.which("sha256sum")
        command = shlex.quote(sha256sum) if sha256sum else "/usr/bin/shasum -a 256"
        sha.write_text(f'#!/bin/bash\nexec {command} "$@"\n')
        sha.chmod(0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def run_helper(self, *, payload="good", mirror_fails=False, all_fail=False):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                   TEST_CALLS=str(self.calls), TEST_PAYLOAD=str(self.root / payload),
                   FAIL_MIRROR="1" if mirror_fails else "0", FAIL_ALL="1" if all_fail else "0")
        return subprocess.run(["bash", str(HELPER), str(self.cache), DIGEST],
                              env=env, text=True, capture_output=True)

    def test_first_fetch_is_verified_and_cache_hit_needs_no_network(self):
        first = self.run_helper()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(self.cache.read_bytes(), GOOD)
        self.calls.unlink()
        second = self.run_helper(payload="bad")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertFalse(self.calls.exists(), "a valid cache should not require a download")
        self.assertEqual(self.cache.read_bytes(), GOOD)

    def test_corrupt_cache_is_replaced_only_by_verified_download(self):
        self.cache.parent.mkdir()
        self.cache.write_bytes(b"bad cache")
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.cache.read_bytes(), GOOD)

    def test_bad_download_fails_without_caching_or_fallback(self):
        result = self.run_helper(payload="bad")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.cache.exists())
        self.assertEqual(len(self.calls.read_text().splitlines()), 1)

    def test_network_failure_uses_official_fallback(self):
        result = self.run_helper(mirror_fails=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.cache.read_bytes(), GOOD)
        calls = self.calls.read_text().splitlines()
        self.assertEqual(len(calls), 2)
        self.assertIn("nodejs.org", calls[1])

    def test_two_network_failures_remove_partial_downloads(self):
        result = self.run_helper(all_fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.cache.exists())
        self.assertEqual(list(self.cache.parent.glob("*.tmp.*")), [])


if __name__ == "__main__":
    unittest.main()
