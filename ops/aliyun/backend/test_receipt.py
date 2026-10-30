"""Unprivileged receipt boundary fixtures; never contact service/provider."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load():
    path = HERE / 'receipt.py'
    if not path.exists(): raise AssertionError('Missing safe receipt acceptance kernel')
    spec = importlib.util.spec_from_file_location('backend_receipt_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.r = load()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.incoming, self.private = self.root / 'incoming', self.root / 'private'
        self.incoming.mkdir(mode=0o700)
        self.private.mkdir(mode=0o700)
        self.fd = os.open(self.incoming, os.O_RDONLY | os.O_DIRECTORY)
        self.request = {'schemaVersion': 1, 'operationId': 'operation-1', 'backendRelease': 'a' * 40, 'pid': 101,
                        'nonce': 'b' * 64, 'createdAt': 1000, 'expiresAt': 1120}
        self.receipt = {'schemaVersion': 1, 'verifierProtocol': 'zimage-backend-readonly-v2', 'operationId': 'operation-1',
                        'backendRelease': 'a' * 40, 'pid': 101, 'nonce': 'b' * 64, 'requestSha256': self.r.request_digest(self.request),
                        'checkedAt': 1001, 'checks': [{'path': path, 'status': 200, 'noStore': True, 'authenticated': index >= 2}
                                                    for index, path in enumerate(self.r.PATHS)],
                        'authenticatedReadOnly': True, 'independentPublic': True, 'catalogReady': True}
        self.journal = {'schemaVersion': 1, 'operationId': 'operation-1', 'sequence': 1, 'old': 'c' * 40, 'target': 'a' * 40,
                        'oldPid': 100, 'frontend': 'd' * 64, 'writesOpened': False, 'phase': 'checking', 'verificationTarget': 'a' * 40}
        self.current, self.pid = 'a' * 40, 101
        self.path = self.incoming / 'backend-readonly-receipt.json'
        self.upload()

    def tearDown(self):
        if hasattr(self, 'fd'): os.close(self.fd)
        if hasattr(self, 'tmp'): self.tmp.cleanup()

    def upload(self, body=None):
        self.path.write_bytes(json.dumps(self.receipt if body is None else body).encode())
        self.expected_sha256 = hashlib.sha256(self.path.read_bytes()).hexdigest()

    def validate(self, receipt=None, request=None, **kwargs):
        return self.r.validate_receipt(self.receipt if receipt is None else receipt, self.request if request is None else request,
            operation='operation-1', release='a' * 40, pid=101, now=kwargs.get('now', 1002))

    def accept(self):
        return self.r.accept_incoming(self.fd, self.private, request=self.request, journal=lambda: self.journal,
            operation='operation-1', release='a' * 40, pid=101, current_release=lambda: self.current,
            live_pid=lambda: self.pid, expected_sha256=self.expected_sha256, now=lambda: 1002, owner_uid=os.getuid())

    def test_successful_exact_receipt_copies_once_and_leaves_no_private_temps(self):
        result = self.accept()
        self.assertEqual(result, self.receipt)
        self.assertEqual(list(self.private.iterdir()), [])

    def test_actual_v2_verifier_output_passes_exact_receipt_transport(self):
        spec = importlib.util.spec_from_file_location('backend_receipt_verifier_fixture', HERE / 'verify.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        identity = '00000000-0000-4000-8000-000000000001'
        bodies = {
            '/api/health/ready': {'status': 'ok', 'version': 'a' * 40},
            '/api/meta': {'schemaVersion': 1, 'backendRelease': 'a' * 40, 'api': {'major': 1, 'minor': 0}, 'capabilities': []},
            '/api/auth/session': {'id': identity},
            '/api/account': {'id': identity, 'status': 'active', 'displayName': None, 'email': 'fixture@example.test'},
            '/api/sessions': {'sessions': []},
            '/api/credits/pricing': {'version': 'catalog-fixture', 'enabled': True, 'prices': []},
        }
        seen = []
        def fetch(path):
            seen.append(path)
            headers = {'cache-control': 'no-store'}
            if path == '/api/credits/pricing': headers['x-zimage-readonly-probe'] = 'catalog-v1'
            return 200, headers, bodies[path]
        self.receipt = verifier.verify(self.request, fetch, now=lambda: 1001)
        self.upload()
        self.assertEqual(self.accept(), self.receipt)
        self.assertEqual(seen, [*self.r.PATHS, '/api/meta'])
        self.assertNotIn('dependenciesReady', self.receipt)
        self.assertNotIn('fixture@example.test', json.dumps(self.receipt))

    def test_validation_returns_detached_safe_dto(self):
        result = self.validate()
        result['checks'][0]['status'] = 500
        self.assertEqual(self.receipt['checks'][0]['status'], 200)

    def test_integral_float_request_times_survive_node_json_roundtrip(self):
        integral_float = dict(self.request, createdAt=1000.0, expiresAt=1120.0)
        self.assertEqual(self.r.request_digest(integral_float), self.r.request_digest(self.request))

    def test_wrong_nonce_digest_operation_release_and_pid_fail_closed(self):
        for field, value in [('nonce', 'e' * 64), ('requestSha256', 'f' * 64), ('operationId', 'other-operation'),
                             ('backendRelease', 'c' * 40), ('pid', 102), ('pid', True)]:
            body = dict(self.receipt, **{field: value})
            with self.subTest(field=field, value=value), self.assertRaises(ValueError): self.validate(body)

    def test_request_schema_nonce_and_freshness_are_strict(self):
        for field, value in [('nonce', 'e' * 64), ('createdAt', 1003), ('expiresAt', 999), ('expiresAt', 1201),
                             ('schemaVersion', True), ('createdAt', float('nan')), ('expiresAt', float('inf')), ('pid', True)]:
            request = dict(self.request, **{field: value})
            with self.subTest(field=field, value=value), self.assertRaises(ValueError): self.validate(request=request)
        with self.assertRaises(ValueError): self.validate(request=dict(self.request, extra='not permitted'))

    def test_receipt_freshness_rejects_stale_future_and_nonfinite_times(self):
        for stamp in [999, 1003, float('nan'), float('inf'), True, 10 ** 400]:
            with self.subTest(stamp=stamp), self.assertRaises(ValueError): self.validate(dict(self.receipt, checkedAt=stamp))
        with self.assertRaises(ValueError): self.validate(now=1121)

    def test_extra_or_partial_or_pending_checks_cannot_authorize_receipt(self):
        candidates = [dict(self.receipt, extra='opaque'), dict(self.receipt, catalogReady=False), dict(self.receipt, authenticatedReadOnly='true'),
                      dict(self.receipt, checks=self.receipt['checks'][:-1]), dict(self.receipt, checks=list(reversed(self.receipt['checks'])))]
        for key, value in [('status', 202), ('noStore', False), ('authenticated', True), ('path', '/api/chat'), ('extra', True)]:
            body = copy.deepcopy(self.receipt)
            body['checks'][0][key] = value
            candidates.append(body)
        for body in candidates:
            with self.subTest(body=body), self.assertRaises(ValueError): self.validate(body)

    def test_v1_wallet_ledger_and_broad_dependency_claims_are_rejected(self):
        self.assertEqual(self.r.PROTOCOL, 'zimage-backend-readonly-v2')
        self.assertEqual(self.r.PATHS[-1], '/api/credits/pricing')
        self.assertNotIn('/api/credits', self.r.PATHS)
        self.assertNotIn('/api/credits/ledger', self.r.PATHS)
        candidates = [dict(self.receipt, verifierProtocol='zimage-backend-readonly-v1'),
                      dict(self.receipt, dependenciesReady=True)]
        legacy = dict(self.receipt, dependenciesReady=True)
        del legacy['catalogReady']
        candidates.append(legacy)
        for path in ['/api/credits', '/api/credits/ledger']:
            body = copy.deepcopy(self.receipt)
            body['checks'][-1]['path'] = path
            candidates.append(body)
        for body in candidates:
            with self.subTest(body=body), self.assertRaises(ValueError): self.validate(body)

    def test_wrong_phase_target_operation_or_open_writes_are_rejected(self):
        for field, value in [('phase', 'committed'), ('phase', 'draining'), ('operationId', 'another-operation'),
                             ('verificationTarget', 'c' * 40), ('target', 'c' * 40), ('writesOpened', True), ('sequence', True)]:
            original = self.journal
            self.journal = dict(original, **{field: value})
            with self.subTest(field=field, value=value), self.assertRaises(ValueError): self.accept()
            self.journal = original

    def test_recovery_binds_old_exact_target_without_rewriting_original_candidate(self):
        self.journal.update(phase='checking_recovery', target='c' * 40, old='a' * 40)
        self.assertEqual(self.accept(), self.receipt)
        self.assertEqual(self.journal['target'], 'c' * 40)
        self.journal['old'] = 'c' * 40
        with self.assertRaises(ValueError): self.accept()

    def test_current_or_live_pid_drift_rejects_receipt(self):
        self.current = 'c' * 40
        with self.assertRaises(ValueError): self.accept()
        self.current, self.pid = 'a' * 40, 102
        with self.assertRaises(ValueError): self.accept()

    def test_symlink_hardlink_fifo_and_oversized_incoming_are_rejected(self):
        target = self.root / 'target.json'
        target.write_bytes(self.path.read_bytes())
        for kind in ['symlink', 'hardlink', 'fifo', 'large']:
            self.path.unlink(missing_ok=True)
            if kind == 'symlink': os.symlink(target, self.path)
            elif kind == 'hardlink': os.link(target, self.path)
            elif kind == 'fifo': os.mkfifo(self.path)
            else: self.path.write_bytes(b'x' * 65537)
            with self.subTest(kind=kind), self.assertRaises((ValueError, OSError)): self.accept()

    def test_duplicate_json_fields_and_partial_upload_rejected(self):
        for body in [b'{"schemaVersion":1,"schemaVersion":1}', self.path.read_bytes()[:-5], b'[]']:
            self.path.write_bytes(body)
            self.expected_sha256 = hashlib.sha256(body).hexdigest()
            with self.subTest(body=body[:20]), self.assertRaises(ValueError): self.accept()

    def test_expected_receipt_digest_is_independent_and_binds_exact_bytes(self):
        original = self.expected_sha256
        for expected in ['e' * 64, None, True, '../digest']:
            self.expected_sha256 = expected
            with self.subTest(expected=expected), self.assertRaises(ValueError): self.accept()
        self.expected_sha256 = original
        # The same DTO under a different serialization is still different
        # transport bytes and cannot inherit the verifier's frozen digest.
        self.path.write_bytes(json.dumps(self.receipt, sort_keys=True, indent=2).encode())
        with self.assertRaises(ValueError): self.accept()

    def test_nonprivate_or_symlink_stage_directory_rejected(self):
        os.chmod(self.private, 0o755)
        with self.assertRaises(ValueError): self.accept()
        os.chmod(self.private, 0o700)
        link = self.root / 'private-link'
        os.symlink(self.private, link)
        self.private = link
        with self.assertRaises((ValueError, OSError)): self.accept()

    def test_incoming_inplace_mutation_during_copy_rejected(self):
        original_read, inode = os.read, self.path.stat().st_ino
        done = False
        def mutate(fd, count):
            nonlocal done
            if not done and os.fstat(fd).st_ino == inode:
                done = True
                self.path.write_bytes(b'changed')
            return original_read(fd, count)
        with patch.object(self.r.os, 'read', side_effect=mutate), self.assertRaises(ValueError): self.accept()

    def test_replacing_incoming_after_open_rejected(self):
        original_read, inode = os.read, self.path.stat().st_ino
        done = False
        def replace(fd, count):
            nonlocal done
            if not done and os.fstat(fd).st_ino == inode:
                done = True
                self.path.unlink()
                self.upload()
            return original_read(fd, count)
        with patch.object(self.r.os, 'read', side_effect=replace), self.assertRaises(ValueError): self.accept()

    def test_private_copy_mutation_after_validation_is_detected(self):
        original_validate = self.r.validate_receipt
        def mutate(*args, **kwargs):
            result = original_validate(*args, **kwargs)
            for path in self.private.iterdir(): path.write_bytes(b'changed')
            return result
        with patch.object(self.r, 'validate_receipt', side_effect=mutate), self.assertRaises(ValueError): self.accept()

    def test_journal_or_pid_changes_after_copy_rejected(self):
        original_validate = self.r.validate_receipt
        def drift(*args, **kwargs):
            result = original_validate(*args, **kwargs)
            self.journal = dict(self.journal, phase='opening')
            self.pid = 102
            return result
        with patch.object(self.r, 'validate_receipt', side_effect=drift), self.assertRaises(ValueError): self.accept()


if __name__ == '__main__': unittest.main()
