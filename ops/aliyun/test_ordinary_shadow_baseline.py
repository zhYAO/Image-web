import hashlib
from pathlib import Path
import unittest
from unittest.mock import Mock

from ordinary_shadow_baseline import measure

SHA = '1' * 40
ARTIFACT = '2' * 64
NAMESPACE = 'release-' + SHA[:12]
BODY = b'fixture'
DIGEST = hashlib.sha256(BODY).hexdigest()


class Tests(unittest.TestCase):
    def fixture(self):
        ops = Mock()
        ops.paths.root = Path('/never/opened')
        ops.snapshot.return_value = dict(backend=SHA, frontend=NAMESPACE, frontendArtifact=ARTIFACT,
                                         nodeMode='open', ingressMode='open', process={'pid': 1})
        ops.raw.side_effect = lambda path, *_: {
            '.release-sha': SHA.encode(), '.three-layer-release.json': BODY,
            '.manifest-sha256': DIGEST.encode(),
        }[path.name]
        ops.pub.sealed.return_value = dict(artifactId=ARTIFACT, sourceSHA=SHA, assetNamespace=NAMESPACE,
                                          build={'publicConfigFingerprint': '4' * 64})
        ops.pub.checked_meta.return_value = SHA
        return ops

    def test_exact_pins_and_store_closure(self):
        ops = self.fixture()
        result = measure(ops)
        self.assertEqual(list(result.values()), [SHA, SHA, DIGEST, ARTIFACT, '4' * 64])
        ops.m.adapter.target_check.assert_called_once_with()
        ops.m.adapter.verify_store_closure.assert_called_once()

    def test_corrupt_manifest_refuses_before_closure(self):
        ops = self.fixture()
        ops.raw.side_effect = [SHA.encode(), BODY + b'x', DIGEST.encode()]
        with self.assertRaisesRegex(ValueError, 'manifest mismatch'):
            measure(ops)
        ops.m.adapter.verify_store_closure.assert_not_called()

    def test_incompatible_or_changed_baseline_rejected(self):
        ops = self.fixture()
        ops.pub.checked_meta.return_value = '0' * 40
        with self.assertRaisesRegex(ValueError, 'compatibility mismatch'):
            measure(ops)
        ops = self.fixture()
        old = ops.snapshot.return_value
        ops.snapshot.side_effect = [old, dict(old, process={'pid': 2})]
        with self.assertRaisesRegex(ValueError, 'baseline moved'):
            measure(ops)

    def test_frontend_source_and_namespace_have_to_match_live_backend(self):
        ops = self.fixture()
        ops.pub.sealed.return_value['sourceSHA'] = '3' * 40
        with self.assertRaisesRegex(ValueError, 'not part of the exact active pair'):
            measure(ops)
        ops = self.fixture()
        ops.snapshot.return_value['frontend'] = 'other-app'
        with self.assertRaisesRegex(ValueError, 'Invalid frontend namespace'):
            measure(ops)
        ops.raw.assert_not_called()
