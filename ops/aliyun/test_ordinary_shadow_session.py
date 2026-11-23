from contextlib import contextmanager
import unittest
from unittest.mock import patch

from ordinary_shadow_session import PINS, Session


class Gate:
    held = False
    @contextmanager
    def lock(self, *, blocking):
        assert not blocking and not self.held
        self.held = True
        try:
            yield
        finally:
            self.held = False

    def assert_clear(self, operation):
        assert self.held and operation == 'test'

    def lock_identity(self):
        assert self.held


class Tests(unittest.TestCase):
    def setUp(self):
        self.t = 100
        self.addCleanup(patch.stopall)
        patch('ordinary_shadow_session.time.monotonic', lambda: self.t).start()
        patch('ordinary_shadow_session.time.time', lambda: 1000).start()
        self.gate = Gate()
        self.pair = {key: 'a'*size for key, size in PINS.items()}
        self.session = Session(gate=self.gate, operation='test', node='test',
                               highest_seen=2, measure=self.measure, ttl=2)

    def measure(self):
        assert self.gate.held
        return self.pair

    def test_success_then_second_use_fails(self):
        def verify(packet, local):
            self.assertFalse(self.gate.held)
            self.assertEqual(local['nonce'], self.session.challenge()['nonce'])
            return packet
        self.assertEqual(self.session.validate('test', verify=verify), 'test')
        with self.assertRaisesRegex(ValueError, 'already used'):
            self.session.validate('test', verify=verify)

    def test_deadline_at_boundary_and_during_verification(self):
        def verify(*_):
            self.t += 2
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.session.validate(None, verify=verify)
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.session.challenge()

    def test_changed_pair_rejected(self):
        def verify(*_):
            self.pair['rollbackBackendSHA'] = 'b'*40
        with self.assertRaisesRegex(ValueError, 'pair changed'):
            self.session.validate(None, verify=verify)

    def test_observation_and_export_do_not_replace_snapshot(self):
        sent = self.session.challenge()
        expected = sent['nonce']
        sent['nonce'] = 'f'*64
        def verify(packet, local):
            self.assertEqual(local['nonce'], expected)
            with self.assertRaises(TypeError):
                local['nonce'] = packet['nonce']
        self.session.validate(sent, verify=verify)
