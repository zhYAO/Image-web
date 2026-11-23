from contextlib import contextmanager
import copy
import unittest

import ordinary as k


def pair(n):
    return dict(backend=n * 40, frontend='release-' + n * 12)


class Fixture:
    def __init__(self):
        self.packet = dict(repository=k.IMAGE, workflow=k.WORKFLOW, commit='b' * 40, runId=1, attempt=2,
                           backendManifestSha256='c' * 64, frontendSubjectSha256='d' * 64)
        self.a = dict(schema=1, operation='fake-test', expiresAt=150, packetSha256=k.sha(self.packet),
                      oldPair=pair('a'), newPair=pair('b'), databaseSha256='0' * 64, backendArchiveSha256='1' * 64,
                      frontendArchiveSha256='6' * 64, frontendManifestSha256='2' * 64, baselineAcceptanceSha256='3' * 64, stagingAcceptanceSha256='4' * 64)
        self.state = dict(self.a['oldPair'], databaseSha256=self.a['databaseSha256'], sealed=False)
        self.events = []
        self.calls = []
        self.locked = False
        self.time = 100
        self.fail = None
        self.check_ok = True
        self.main_checks = 0
        self.drift = False

    @contextmanager
    def lock(self):
        self.locked = True
        try:
            yield
        finally:
            self.locked = False

    def call(self, name):
        if not self.locked:
            raise AssertionError('no lock')
        self.calls.append(name)
        if self.fail == name:
            raise ValueError('injected failure')

    def journal(self, event):
        self.call(event['phase'])
        self.events.append(event)

    def assert_clear(self, operation):
        self.call('assert-clear')
        if any(e['phase'] != 'opened' or e['operation'] == operation for e in self.events):
            raise ValueError('unresolved')

    def assert_main(self, commit):
        self.call('assert-main')
        self.main_checks += 1
        if commit != 'b' * 40 or (self.drift and self.main_checks == 3):
            raise ValueError('stale main')

    def snapshot(self):
        self.call('snapshot')
        return copy.copy(self.state)

    def verify_inputs(self, p, a):
        self.call('evidence')
        if not self.check_ok:
            raise ValueError('no independent acceptance')

    def seal_and_drain(self):
        self.call('seal')
        self.state['sealed'] = True

    def select_backend(self, p, a):
        self.call('backend')
        self.state['backend'] = p['commit']

    def select_frontend(self, p, a):
        self.call('frontend')
        self.state['frontend'] = a['newPair']['frontend']

    def verify_sealed_pair(self, p, a):
        self.call('sealed-auth')

    def open_pair(self):
        self.call('open')
        self.state['sealed'] = False

    def run(self, expected=None):
        return k.transition(self.packet, self.a, expected or k.sha(self.a), self, clock=lambda: self.time)


class TestOrdinary(unittest.TestCase):
    def test_success_order_and_exact_pair(self):
        f = Fixture()
        self.assertEqual(f.run(), {'operation': 'fake-test', 'phase': 'opened', 'pair': pair('b')})
        self.assertEqual([e['phase'] for e in f.events], ['seal-intent', 'backend-intent', 'frontend-intent', 'writes-may-open', 'opened'])
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            f.run()

    def test_bad_digest_expired_namespace_packet_and_equal_receipts(self):
        for bad in ('digest', 'expiry', 'namespace', 'packet', 'receipts', 'boolean'):
            with self.subTest(bad=bad):
                f = Fixture()
                expected = None
                if bad == 'digest': expected = 'e' * 64
                if bad == 'expiry': f.time = 151
                if bad == 'namespace': f.a['newPair']['frontend'] = 'rehearsal-abc'
                if bad == 'packet': f.packet['attempt'] += 1
                if bad == 'receipts': f.a['baselineAcceptanceSha256'] = f.a['stagingAcceptanceSha256']
                if bad == 'boolean': f.packet['runId'] = True
                with self.assertRaises(ValueError):
                    f.run(expected)
                self.assertEqual(f.calls, [])

    def test_staging_and_baseline_evidence_required(self):
        f = Fixture()
        f.check_ok = False
        with self.assertRaisesRegex(ValueError, 'independent acceptance'):
            f.run()
        self.assertEqual(f.events, [])
        self.assertFalse(f.state['sealed'])

    def test_unexpected_live_pair_and_database_drift_reject_before_side_effects(self):
        for key in ('databaseSha256', 'frontend', 'backend'):
            f = Fixture()
            f.state[key] = '5' * 64
            with self.assertRaisesRegex(ValueError, 'Unexpected current'):
                f.run()
            self.assertEqual(f.events, [])

    def test_sealed_failure_blocks_retry_and_does_not_rollback(self):
        for fail in ('backend', 'frontend', 'sealed-auth', 'writes-may-open'):
            with self.subTest(fail=fail):
                f = Fixture()
                f.fail = fail
                with self.assertRaisesRegex(ValueError, 'injected'):
                    f.run()
                self.assertTrue(f.state['sealed'])
                self.assertNotIn('open', f.calls)
                with self.assertRaisesRegex(ValueError, 'unresolved'):
                    f.run()

    def test_uncertain_open_never_reports_recovery_or_retries(self):
        f = Fixture()
        f.fail = 'open'
        with self.assertRaisesRegex(ValueError, 'injected'):
            f.run()
        self.assertEqual(f.events[-1]['phase'], 'writes-may-open')
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            f.run()

    def test_head_drift_between_sealed_probe_and_open(self):
        f = Fixture()
        f.drift = True
        with self.assertRaisesRegex(ValueError, 'stale main'):
            f.run()
        self.assertTrue(f.state['sealed'])
        self.assertNotIn('open', f.calls)


if __name__ == '__main__':
    unittest.main()
