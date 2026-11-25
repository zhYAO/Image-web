"""Exercise receive.main on wire bytes and the on-disk journal, without a privileged host."""
from contextlib import ExitStack, nullcontext
import errno
import hmac
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import receive


RETAINED = ('a'*40, 'release-'+'a'*12)
PREVIOUS_CANDIDATE = ('b'*40, 'release-'+'b'*40)
INCOMING = 'c'*40
OLD_TREE, NEW_TREE = '1'*40, '2'*40


class ReceiverEntry(unittest.TestCase):
    def setUp(self):
        contexts = ExitStack()
        self.addCleanup(contexts.close)
        enter = contexts.enter_context
        root = Path(enter(tempfile.TemporaryDirectory()))
        etc = root/'etc'
        etc.mkdir()
        (etc/'ingress-open.json').write_text('{}')
        self.policy_path = etc/'production-target.json'
        self.policy = dict(instanceId='i-test', compatibleMigrationTrees=[OLD_TREE, NEW_TREE])
        self.policy_path.write_text(json.dumps(self.policy))
        self.journal = root/'production-release.json'
        self.state = dict(old=list(RETAINED), new=list(PREVIOUS_CANDIDATE), run=18,
                          oldMigrations=OLD_TREE, newMigrations=NEW_TREE, pairSha256='3'*64)

        management = receive.load(Path(receive.__file__).resolve().parents[1]/'backend/release.py')
        bridge, engine, checks = Mock(), Mock(), Mock()
        bridge.safe_node_environment.return_value = nullcontext()
        bridge.load_tools.return_value = (Mock(), Mock())
        bridge.Adapter.return_value.locked.side_effect = nullcontext
        engine.BackendTransaction.return_value.observed.return_value = dict(pid=7, admissionMode='open')
        enter(patch.object(receive, 'TOOLS', root/('e'*64)))
        modules = {receive.LAYERS/'release-three-layer.py': bridge,
                   receive.BACKEND/'transaction.py': engine, receive.TOOLS/'check.py': checks}
        self.space = Mock()
        modules[receive.TOOLS/'space.py'] = self.space
        enter(patch.object(management, 'load', side_effect=lambda path, name: modules[path]))
        self.owned = enter(patch.object(management, 'owned'))  # Test directory is owned by the local user.
        enter(patch.object(receive.shutil, 'which', return_value=str(Path('/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node'))))
        self.bridge = bridge
        enter(patch.object(management, 'service_launch_preflight'))
        enter(patch.object(receive, 'load', return_value=management))
        enter(patch.multiple(receive, ROOT=root, ETC=etc, JOURNAL=self.journal))
        enter(patch.object(receive.os, 'geteuid', return_value=0))
        enter(patch.object(receive.os, 'umask'))
        enter(patch.object(receive.signal, 'alarm'))
        enter(patch.object(receive, 'target_policy', side_effect=lambda m: m.bounded_json(self.policy_path)))
        self.current = enter(patch.object(receive.Host, 'current'))
        enter(patch.object(receive.Host, 'process'))
        self.public = enter(patch.object(receive.Host, 'public'))
        self.prepare = enter(patch.object(receive.Host, 'prepare', autospec=True))
        self.activate = enter(patch.object(receive, 'activate', return_value=0))
        # Exercise receive.verify as well. Replace only the external binary, never contact a signer.
        self.certificate = {'sourceRepositoryIdentifier': '1329578390'}
        self.gh = enter(patch.object(receive.subprocess, 'check_output', side_effect=self.gh_fixture))

    @staticmethod
    def proof(sha, body):
        return hmac.digest(b'offline receiver test fixture', sha.encode()+body, 'sha256')

    def gh_fixture(self, argv, **kwargs):
        if argv == ['/usr/bin/gh', '--version']:
            return 'gh version 2.102.0 (2026-10-01)'
        self.assertEqual(argv[:3], ['/usr/bin/gh', 'attestation', 'verify'])
        archive, bundle, sha = Path(argv[3]), Path(argv[argv.index('--bundle')+1]), argv[argv.index('--source-digest')+1]
        if not hmac.compare_digest(bundle.read_bytes(), self.proof(sha, archive.read_bytes())):
            raise ValueError('Fixture provenance rejected')
        return json.dumps([{'verificationResult': {'signature': {'certificate': self.certificate}}}])

    def receive(self, phase, live, *, run=19, trusted=True, changes=None, kit_id='e'*64):
        self.current.return_value = live
        if not self.journal.is_symlink():
            self.journal.write_text(json.dumps(dict(self.state, phase=phase) | (changes or {})))
        meta = json.dumps(dict(sha=INCOMING, run=run, manifest='4'*64, migrations=NEW_TREE)).encode()
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as tar:
            member = tarfile.TarInfo('release.json')
            member.size = len(meta)
            tar.addfile(member, io.BytesIO(meta))
        body = archive.getvalue()
        proof = self.proof(INCOMING, body) if trusted else bytes(32)
        header = f'{kit_id} {INCOMING} {len(proof)} {len(body)}\n'.encode()
        stdin = SimpleNamespace(buffer=io.BytesIO(header+proof+body))
        isolated = SimpleNamespace(argv=['receive.py'], flags=SimpleNamespace(isolated=True),
                                   stdin=stdin, stderr=sys.stderr)
        with patch.object(receive, 'sys', isolated):
            return receive.main()

    def test_signed_candidate_for_another_kit_is_rejected_before_archive(self):
        with self.assertRaisesRegex(ValueError, 'different receiver kit'):
            self.receive('committed', PREVIOUS_CANDIDATE, kit_id='f'*64)
        self.gh.assert_not_called()
        self.prepare.assert_not_called()
        self.activate.assert_not_called()

    def test_untrusted_node_prevents_receipt_and_target_check(self):
        def owned(path, **kwargs):
            if path == Path('/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node'):
                raise ValueError('Untrusted root-managed backend path')
        self.owned.side_effect = owned
        with self.assertRaisesRegex(ValueError, 'Untrusted root-managed'):
            self.receive('committed', PREVIOUS_CANDIDATE)
        self.gh.assert_not_called()
        self.bridge.Adapter.assert_not_called()

    def test_terminal_phase_selects_matching_live_pair_and_tree(self):
        for phase, live, tree in [('committed', PREVIOUS_CANDIDATE, NEW_TREE), ('restored', RETAINED, OLD_TREE)]:
            with self.subTest(phase=phase):
                self.assertEqual(self.receive(phase, live), 0)
                self.assertEqual(self.prepare.call_args.args[0].old_migrations, tree)
                self.assertEqual(self.activate.call_args.args[1:], (live, (INCOMING, 'release-'+INCOMING), 19))
        self.assertEqual(sum(call.args[0][1:3] == ['attestation', 'verify'] for call in self.gh.call_args_list), 2)

    def test_insufficient_space_for_retained_version_stops_before_switching(self):
        self.space.check_headroom.side_effect = ValueError('Insufficient verification headroom')
        with self.assertRaisesRegex(ValueError, 'Insufficient verification headroom'):
            self.receive('restored', RETAINED)
        self.assertEqual(self.space.check_headroom.call_args.args[2:4], (INCOMING, RETAINED[0]))
        self.activate.assert_not_called()
        self.assertEqual(json.loads(self.journal.read_text())['phase'], 'restored')

    def test_certificate_identity_required_before_archive_or_journal_is_used(self):
        for cert in [{}, {'sourceRepositoryIdentifier': '1329578391'}]:
            with self.subTest(cert=cert), patch.object(receive, 'unpack') as unpack:
                self.certificate = cert
                with self.assertRaisesRegex(ValueError, 'certificate repository ID'):
                    self.receive('committed', PREVIOUS_CANDIDATE)
                unpack.assert_not_called()
        self.current.assert_not_called()
        self.prepare.assert_not_called()
        self.activate.assert_not_called()

    def test_mismatched_and_superseded_restoration_rejected_before_prepare(self):
        for phase, live, run in [('committed', RETAINED, 19), ('restored', PREVIOUS_CANDIDATE, 19),
                                 ('restored', (RETAINED[0], PREVIOUS_CANDIDATE[1]), 19),
                                 ('restored', (PREVIOUS_CANDIDATE[0], RETAINED[1]), 19),
                                 ('committed', PREVIOUS_CANDIDATE, 17), ('committed', PREVIOUS_CANDIDATE, 18),
                                 ('restored', RETAINED, 17), ('restored', RETAINED, 18)]:
            with self.subTest(phase=phase, live=live, run=run), self.assertRaises(ValueError):
                self.receive(phase, live, run=run)
        self.public.assert_not_called()
        self.prepare.assert_not_called()
        self.activate.assert_not_called()

    def test_nonterminal_and_unsubstantiated_journal_rejected(self):
        for phase, changes in [('switching', {}), ('restoring', {}), ('needs_attention', {}), ('unknown', {}),
                               ('restored', {'run': True}), ('restored', {'run': 0}),
                               ('restored', {'pairSha256': ''}), ('restored', {'oldMigrations': 'unreviewed'})]:
            with self.subTest(phase=phase, changes=changes), self.assertRaises(ValueError):
                self.receive(phase, RETAINED, changes=changes)
        self.public.assert_not_called()
        self.prepare.assert_not_called()
        self.activate.assert_not_called()

    def test_dangling_journal_cannot_reenter_initial_bootstrap(self):
        self.journal.symlink_to('missing-record')
        initial = ('7a811b326aa4b344cee08bc5a33c04e44a780fd4', 'release-7a811b326aa4')
        with self.assertRaises(OSError) as caught:
            self.receive('restored', initial)
        self.assertEqual(caught.exception.errno, errno.ELOOP)
        self.assertEqual(Path(caught.exception.filename), self.journal)
        self.public.assert_not_called()
        self.prepare.assert_not_called()
        self.activate.assert_not_called()

    def test_journal_cannot_substitute_for_signature_or_database_approval(self):
        with self.assertRaisesRegex(ValueError, 'provenance'):
            self.receive('restored', RETAINED, trusted=False)
        self.current.assert_not_called()
        self.policy['compatibleMigrationTrees'] = [NEW_TREE]
        self.policy_path.write_text(json.dumps(self.policy))
        with self.assertRaisesRegex(ValueError, 'Database compatibility'):
            self.receive('restored', RETAINED)
        self.public.assert_not_called()
        self.prepare.assert_not_called()
        self.activate.assert_not_called()
