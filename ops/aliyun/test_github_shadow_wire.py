import unittest
from unittest.mock import Mock, patch

from github_shadow_wire import HEADER, LIMITS, MAGIC, inspect, parse


def packet(parts=(b'stage', b'bundle', b'head', b'head-bundle')):
    return HEADER.pack(MAGIC, *map(len, parts)) + b''.join(parts)


class WireTest(unittest.TestCase):
    def test_exact_four_parts(self):
        self.assertEqual(parse(packet()), (b'stage', b'bundle', b'head', b'head-bundle'))

    def test_bad_packet_rejected_before_any_callbacks(self):
        observer, verifier = Mock(), Mock()
        for bad in (b'', packet()[:-1], packet() + b'x', b'x' + packet()[1:],
                    packet((b'stage', b'bundle', b'', b'head-bundle')),
                    packet((b'X'*(LIMITS[0]+1), b'bundle', b'head', b'head-bundle'))):
            self.assertEqual(inspect(bad, observe=observer, verify=verifier)['reason'], 'invalid-packet')
        observer.assert_not_called()
        verifier.assert_not_called()

    def test_untrusted_or_missing_observer_stops_before_stage_verifier(self):
        verifier = Mock()
        self.assertEqual(inspect(packet(), verify=verifier)['status'], 'blocked')
        with self.subTest('empty observer'):
            self.assertEqual(inspect(packet(), observe=Mock(return_value=None),
                                     verify=verifier)['status'], 'rejected')
        with self.subTest('failed observer, suppressed detail'):
            self.assertEqual(inspect(packet(), observe=Mock(side_effect=RuntimeError("private detail")),
                                     verify=verifier)['reason'], 'untrusted-evidence')
        verifier.assert_not_called()

    def test_dispatch_is_shadow_only(self):
        observed = dict(expected={}, jobs=[], run_started_at=1, now=2, seen=set())
        result = dict(verified_subject_sha256='x', verified_certificate={}, verified_predicate_type='p')
        observer, verifier = Mock(return_value=observed), Mock(return_value=result)
        with patch('github_shadow_wire.shadow', return_value={'productionReady': False}) as checker:
            output = inspect(packet(), observe=observer, verify=verifier)
        observer.assert_called_once_with(b'head', b'head-bundle')
        verifier.assert_called_once_with(b'stage', b'bundle', {})
        checker.assert_called_once_with(b'stage', **result, **observed)
        self.assertEqual(output, {'status': 'shadow-verified', 'productionReady': False})
