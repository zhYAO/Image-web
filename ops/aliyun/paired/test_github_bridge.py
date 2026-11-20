"""Offline framing/router tests, never mint real authentication."""
import hashlib
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest

PATH = Path(__file__).with_name('github-bridge')
LOADER = importlib.machinery.SourceFileLoader('staging_bridge_test', str(PATH))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
bridge = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(bridge)


def data(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


class StagingBridge(unittest.TestCase):
    def setUp(self):
        parent = tempfile.TemporaryDirectory()
        self.addCleanup(parent.cleanup)
        self.root = Path(parent.name)
        self.pins = dict(commit='a' * 40, frontendNamespace='release-' + 'a' * 12)
        self.pair = hashlib.sha256(data(self.pins)).hexdigest()
        self.paths = []
        self.intake = SimpleNamespace(read_json=lambda p: json.loads(p.read_bytes()), evaluate=self.evaluate)

    def evaluate(self, pins, backend, frontend, config):
        self.paths.extend((backend.name, frontend.name))
        self.assertEqual(pins, self.pins)
        self.assertEqual(backend.read_bytes(), b'backend')
        self.assertEqual(frontend.read_bytes(), b'frontend')
        self.assertTrue(config['formalAuth'])
        return dict(immutablePairVerified=True, productionReady=False)

    def frame(self):
        return bridge.MAGIC + b''.join(struct.pack('!Q', len(x)) + x for x in (
            data(self.pins), b'backend', b'frontend', data(dict(formalAuth=True, dataMode='http'))))

    def test_fixed_members_only_and_no_receipt_for_valid_intake(self):
        receipt = bridge.route(['staging', self.pair], io.BytesIO(self.frame()), self.intake, self.root)
        self.assertEqual(self.paths, ['backend.zip', 'frontend.zip'])
        self.assertFalse(receipt['authenticatedStaging'])
        self.assertEqual(receipt['status'], 'blocked')
        self.assertNotIn('stageReceiptSha256', receipt)
        self.assertFalse(list(self.root.iterdir()))

    def test_rejects_unauthorized_commands_and_bindings_before_evaluation(self):
        for args in (['production', self.pair], ['authorization', self.pair], ['staging', '0' * 64],
                     ['staging', self.pair, '/etc/passwd']):
            with self.subTest(args=args), self.assertRaises(ValueError):
                bridge.route(args, io.BytesIO(self.frame()), self.intake, self.root)
        self.assertEqual(self.paths, [])

    def test_bounds_version_truncation_and_trailing_bytes(self):
        for body in (b'wrong' + self.frame(), self.frame()[:-1], self.frame() + b'extra',
                     bridge.MAGIC + struct.pack('!Q', 65537)):
            with self.subTest(body=body[:36]), self.assertRaises(ValueError):
                bridge.route(['staging', self.pair], io.BytesIO(body), self.intake, self.root)
        self.assertEqual(self.paths, [])
