"""Exercise the draft shard runner with real Vitest and disposable fixtures."""
import pathlib
import json
import os
import signal
import subprocess
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[4]
RUNNER = pathlib.Path(__file__).with_name("yunxiao-web-shards-draft.sh")
VERIFY = pathlib.Path(__file__).with_name("yunxiao-verify-web-report-draft.mjs")


class ReportCompletenessTest(unittest.TestCase):
    def test_missing_file_fails_even_when_report_claims_success(self):
        self.assertTrue(VERIFY.is_file(), "report completeness verifier has not been implemented")
        with tempfile.TemporaryDirectory(prefix="zimage-report-test-") as directory:
            root = pathlib.Path(directory).resolve()
            expected = root / "expected.json"
            actual = root / "actual.json"
            expected.write_text(json.dumps([{"file": str(root / "a.test.js")}, {"file": str(root / "b.test.js")}]))
            actual.write_text(json.dumps({"success": True, "testResults": [{"name": str(root / "a.test.js")}]}))
            result = subprocess.run(["node", str(VERIFY), str(expected), str(actual)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_duplicate_or_extra_file_cannot_pass_the_gate(self):
        with tempfile.TemporaryDirectory(prefix="zimage-report-test-") as directory:
            root = pathlib.Path(directory).resolve()
            expected = root / "expected.json"
            actual = root / "actual.json"
            a, b, c = (str(root / name) for name in ("a.test.js", "b.test.js", "c.test.js"))
            expected.write_text(json.dumps([{"file": a}, {"file": b}]))
            for names in ([a, a], [a, b, c]):
                with self.subTest(names=names):
                    actual.write_text(json.dumps({"success": True, "testResults": [{"name": name} for name in names]}))
                    result = subprocess.run(["node", str(VERIFY), str(expected), str(actual)], capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


class ShardRunnerTest(unittest.TestCase):
    def fixture(self, directory, *, broken=False, uncovered=False, slow=None, failing=None, child=False):
        root = pathlib.Path(directory).resolve()
        (root / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
        (root / "src").mkdir()
        (root / "tests").mkdir()
        (root / "coverage").mkdir()
        (root / "coverage" / "existing-report.txt").write_text("preserve")
        (root / "vitest.config.mjs").write_text(
            "import {defineConfig} from 'vitest/config'; "
            "export default defineConfig({cacheDir:'./.vite-cache',test:{include:['tests/*.test.js'],maxWorkers:1,"
            "coverage:{provider:'v8',include:['src/*.js'],reporter:['text'],"
            "thresholds:{lines:100,statements:100,functions:100,branches:100}}}});\n"
        )
        for name in ("a", "b"):
            (root / "src" / f"{name}.js").write_text(f"export const {name} = () => 1;\n")
            expected = 2 if (broken and name == "b") or name == failing else 1
            delay = "await new Promise(resolve=>setTimeout(resolve,20000));" if name == slow else ""
            child_setup = (
                "import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; "
                "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); "
                "child.unref(); writeFileSync('child.pid',String(child.pid)); "
            ) if child and name == 'a' else ''
            (root / "tests" / f"{name}.test.js").write_text(
                f"import {{test,expect}} from 'vitest'; import {{{name}}} from '../src/{name}.js'; "
                f"{child_setup}test('{name}',async()=>{{{delay}expect({name}()).toBe({expected});}});\n"
            )
        if uncovered:
            (root / "src" / "uncovered.js").write_text("export const uncovered = () => 3;\n")
        return root

    def run_fixture(self, **kwargs):
        self.assertTrue(RUNNER.is_file(), "reviewed shard runner has not been implemented")
        with tempfile.TemporaryDirectory(prefix="zimage-shard-test-") as directory:
            root = self.fixture(directory, **kwargs)
            start = time.monotonic()
            result = subprocess.run(
                ["bash", str(RUNNER), str(root)],
                cwd=ROOT, capture_output=True, text=True, timeout=90,
            )
            result.duration = time.monotonic() - start
            result.shared_results = list((root / '.vite-cache').rglob('results.json'))
            result.existing_report_preserved = (root / 'coverage' / 'existing-report.txt').is_file()
            result.child_alive = False
            if kwargs.get('child') and (root / 'child.pid').exists():
                pid = int((root / 'child.pid').read_text())
                try:
                    os.kill(pid, 0)
                    result.child_alive = True
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            return result

    def test_both_shards_merge_with_full_coverage(self):
        result = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("2 passed (2)", result.stdout)
        self.assertIn("100", result.stdout)
        self.assertIn("Verified 2 distinct Web test files", result.stdout)
        self.assertEqual(result.shared_results, [], "parallel shards must not share Vitest results cache")
        self.assertTrue(result.existing_report_preserved, "existing coverage report must not be overwritten")

    def test_failing_shard_cannot_pass_the_gate(self):
        result = self.run_fixture(broken=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("A Web test shard failed", result.stderr)

    def test_merged_coverage_must_meet_original_threshold(self):
        result = self.run_fixture(uncovered=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("threshold", (result.stdout + result.stderr).lower())

    def test_failed_shard_stops_the_other_without_waiting_for_it(self):
        for slow, failing in (("a", "b"), ("b", "a")):
            with self.subTest(slow=slow):
                result = self.run_fixture(slow=slow, failing=failing)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("A Web test shard failed", result.stderr)
                self.assertLess(result.duration, 15, "failed shard should not wait for a 20-second test")

    def test_successful_shard_does_not_leave_a_background_child(self):
        result = self.run_fixture(child=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(result.child_alive, "a successful shard left its subprocess alive")


if __name__ == "__main__":
    unittest.main()
