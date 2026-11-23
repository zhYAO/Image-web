import hashlib
from contextlib import nullcontext
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

import core as test_core


script = Path(__file__).with_name('receive-ordinary-pair')
loader = SourceFileLoader('test_fixed_receiver', str(script))
receiver = ModuleType(loader.name)
receiver.__file__ = str(script)
loader.exec_module(receiver)


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.bodies = {path: str(path).encode() for path in receiver.FILES}
        self.pins = {str(path): hashlib.sha256(body).hexdigest() for path, body in self.bodies.items()}

    def read(self, path, cap):
        body = json.dumps(self.pins).encode() if path == receiver.INVENTORY else self.bodies[path]
        self.assertLessEqual(len(body), cap)
        return body

    def test_no_operational_arguments_or_unprivileged_or_script_alias(self):
        flags = dict(script=receiver.LOCATION, uid=0, isolated=True)
        receiver.invocation(['receive-ordinary-pair'], **flags)
        for argv, overrides in ((['receive-ordinary-pair', 'bash'], {}), (['receive-ordinary-pair'], dict(uid=1001)),
                                (['receive-ordinary-pair'], dict(isolated=False)),
                                (['receive-ordinary-pair'], dict(script=Path('other')))):
            with self.subTest(argv=argv, overrides=overrides), self.assertRaisesRegex(ValueError, 'Fixed isolated'):
                receiver.invocation(argv, **dict(flags, **overrides))

    def test_source_inventory_is_closed_and_matches_snapshot_bytes(self):
        self.assertEqual(receiver.authenticate(self.read), (self.pins, self.bodies))
        self.pins['/tmp/extra.py'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'inventory'):
            receiver.authenticate(self.read)
        self.pins.pop('/tmp/extra.py')
        self.bodies[receiver.BASE / 'cli.py'] = b'different lifecycle code'
        with self.assertRaisesRegex(ValueError, 'approved inventory'):
            receiver.authenticate(self.read)

    def test_missing_authority_stops_before_import_or_ssh_stream(self):
        missing = receiver.RUNTIME / 'ordinary-authority.py'
        def read(path, limit):
            if path == missing:
                raise FileNotFoundError(str(path))
            return self.read(path, limit)
        with patch.object(receiver, 'invocation'), patch.object(receiver.os, 'umask'), \
                patch.object(receiver.os, 'geteuid', return_value=0, create=True), \
                patch.object(receiver, 'read_installed', side_effect=read), patch.object(receiver, 'source') as source, \
                patch.object(receiver.sys, 'stdin', Mock()) as stdin:
            with self.assertRaises(FileNotFoundError):
                receiver.main()
            source.assert_not_called()
            stdin.fileno.assert_not_called()

    def test_only_fixed_coordinator_can_return_receipt_from_initialized_host(self):
        core = test_core
        cli = Mock()
        cli.ROOT = Path('/opt/zimage')
        cli.authenticate.return_value = (core, {str(receiver.BASE / 'cli.py'): self.pins[str(receiver.BASE / 'cli.py')]})
        cli.source_only.return_value = nullcontext()
        cli.safe_environment.return_value = nullcontext()
        spool = Mock()
        spool.lstat.return_value.st_mode = 0o700
        tools = {name: Mock() for name, _ in receiver.MODULES}
        tools['ordinary_installed_cli'] = cli
        authority = tools['ordinary_authority'].open_authority.return_value
        authority.attestation_digests = dict(ghSha256='a' * 64, trustedRootSha256='b' * 64)
        authority.github_read_token = 'nonproduction-fixture-token'
        expected = {'status': 'opened', 'operationId': 'nonproduction-fixture'}
        coordinator = tools['ordinary_ssh'].run
        def execute(stream, *, host, **kwargs):
            self.assertIs(host.system_for({'fixture': 'packet'}, {'fixture': 'approval'}),
                          cli.load.return_value.SystemOps.return_value)
            return expected
        coordinator.side_effect = execute
        stdin = Mock()
        stdin.fileno.return_value = 27
        with patch.object(receiver, 'invocation'), patch.object(receiver.os, 'umask'), \
                patch.object(receiver.os, 'geteuid', return_value=0, create=True), \
                patch.object(receiver, 'authenticate', return_value=(self.pins, self.bodies)), \
                patch.object(receiver, 'source', side_effect=lambda name, *_: tools[name]), \
                patch.object(receiver, 'SPOOL', spool), patch.object(receiver.sys, 'stdin', stdin), \
                patch.object(receiver, 'BoundedInput') as bounded:
            self.assertEqual(receiver.main(), core.canonical(expected))
        bounded.assert_called_once_with(27)
        call = coordinator.call_args
        self.assertIs(call.args[0], bounded.return_value)
        self.assertIs(call.kwargs['handoff'], tools['github_pair_handoff'])
        self.assertIs(call.kwargs['host'].gate, tools['ordinary_journal'].JournalGate.return_value)
        self.assertIs(call.kwargs['host'].restore, tools['ordinary_restore'].restore)
        authority.lifecycle_policy.assert_called_once_with({'fixture': 'packet'}, {'fixture': 'approval'})
        packet = {'fixture': 'packet'}
        github = call.kwargs['host'].github
        github.merge(packet)
        get = tools['ordinary_github'].read_only.return_value
        tools['ordinary_github'].observe.assert_called_once_with(packet, get=get, policy=authority.merge_policy,
                                                                  verify_check=tools['github_protected_merge_observe'].observe)
        github.verify(payload=b'fixture')
        tools['github_shadow_offline'].verify.assert_called_once_with(payload=b'fixture', gh_path=receiver.VERIFIER,
            gh_sha256='a' * 64, trusted_root_path=receiver.SIGSTORE_ROOT, trusted_root_sha256='b' * 64)

    @unittest.skipIf(sys.platform == 'win32', 'Linux pipe readiness')
    def test_bounded_wire_reads_short_chunks_eof_and_deadline(self):
        read, write = os.pipe()
        try:
            os.write(write, b'ABC')
            os.close(write)
            write = None
            stream = receiver.BoundedInput(read)
            self.assertEqual(stream.read(2), b'AB')
            self.assertEqual(stream.read(2), b'C')
            self.assertEqual(stream.read(1), b'')
            with self.assertRaisesRegex(ValueError, 'timed out'):
                receiver.BoundedInput(read, timeout=0).read(1)
        finally:
            os.close(read)
            if write is not None:
                os.close(write)
