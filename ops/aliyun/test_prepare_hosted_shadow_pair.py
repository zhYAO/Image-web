import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('pair', Path(__file__).with_name('prepare-hosted-shadow-pair.py'))
pair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pair)


class TestPair(unittest.TestCase):
    def test_missing_or_foreign_verified_intake_never_materializes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            source, output, cache = (root / x for x in ('source', 'output', 'cache'))
            source.mkdir(mode=0o700)
            cache.mkdir(mode=0o700)
            for name in ('pins.json', 'config.json', 'backend.zip', 'frontend.zip'):
                (source/name).write_bytes(b'content')
                (source/name).chmod(0o600)
            intake = Mock()
            actual = hashlib.sha256(b'content').hexdigest()
            pins = dict(commit='a'*40, runId=4, attempt=2,
                        backend={'artifactSha256':actual}, frontend={'artifactSha256':actual})
            intake.read_json.return_value = pins
            intake.checked.side_effect = pair.module().checked
            trusted = dict(commit='a'*40, run_id=4, attempt=2, backend_sha256=actual, frontend_sha256=actual)
            for override, error in ((dict(commit='b'*40), 'run identity'),
                                    (dict(backend_sha256='c'*64), 'outer archive digest')):
                with self.assertRaisesRegex(ValueError, error):
                    pair.run(source, output, cache, intake, **dict(trusted, **override))
            (source/'backend.zip').write_bytes(b'fake self-consistent bytes')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                pair.run(source, output, cache, intake, **trusted)
            (source/'backend.zip').write_bytes(b'content')
            intake.evaluate.assert_not_called()
            for suspect in (cache/'old', source/'extra'):
                suspect.touch()
                with self.assertRaises(ValueError):
                    pair.run(source, output, cache, intake, **trusted)
                suspect.unlink()

            intake.evaluate.return_value = dict(immutablePairVerified=True, productionReady=False,
                                                status='blocked', commit='a'*40, runId=4, attempt=1)
            with self.assertRaisesRegex(ValueError, 'proof missing'):
                pair.run(source, output, cache, intake, **trusted)
            self.assertFalse(output.exists())
            intake.extract_github_zip.assert_not_called()
            (source/'backend.zip').unlink()
            (source/'backend.zip').symlink_to(source/'frontend.zip')
            with self.assertRaisesRegex(ValueError, 'Missing exact inputs'):
                pair.run(source, output, cache, intake, **trusted)
