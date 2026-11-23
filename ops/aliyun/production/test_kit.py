from contextlib import ExitStack, nullcontext
import json
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import kit
import receive


class ReceiverKitTests(unittest.TestCase):
    def test_exclusive_stage_and_content_identity(self):
        contents = kit.source_contents()
        expected = kit.identity(contents)
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            with self.assertRaisesRegex(ValueError, 'reviewed digest'):
                kit.stage(parent, '0'*64, contents)
            self.assertEqual(list(parent.iterdir()), [])
            root = kit.stage(parent, expected, contents)
            with self.assertRaises(FileExistsError):
                kit.stage(parent, expected, contents)
            with patch.object(kit, 'trusted'):  # Workspace fixtures have the tester's UID.
                kit.verify_tree(root)
                bridge = receive.load(root/'layers/release-three-layer.py')
                self.assertTrue(callable(bridge.Adapter.prepare_archive))
                bridge.load_tools()
                receive.load(root/'backend/transaction.py')
                receive_module = receive.load(root/'receive.py')
                self.assertEqual(receive_module.PRELOAD.parent, root/'backend')
                (root/'backend/extra.pyc').touch()
                with self.assertRaisesRegex(ValueError, 'Unexpected'):
                    kit.verify_tree(root)
                (root/'backend/extra.pyc').unlink()
                (root/'backend/next-source-profiles.json').write_text('{}')
                with self.assertRaisesRegex(ValueError, 'digest'):
                    kit.verify_tree(root)

    def test_root_owner_type_mode_and_link_count(self):
        for mode, uid, links in [(stat.S_IFLNK | 0o777, 0, 1), (stat.S_IFREG | 0o664, 0, 1),
                                 (stat.S_IFREG | 0o644, 1000, 1), (stat.S_IFREG | 0o444, 0, 2)]:
            with self.subTest(mode=mode, uid=uid, links=links):
                path = Mock()
                path.lstat.return_value = Mock(st_mode=mode, st_uid=uid, st_nlink=links)
                with self.assertRaises(ValueError):
                    kit.trusted(path, False)

    def test_installed_admin_check_requires_live_and_inspected_framework_to_match(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            sha = 'a'*40
            target = root/'releases'/sha
            target.mkdir(parents=True)
            (root/'current').symlink_to(target)
            (root/'production-trusted-root.jsonl').write_text('{"certificateAuthorities":[{}]}')
            contract = {'protocolVersion': 1, 'nextVersion': '16.4.1'}
            management, bridge = Mock(), Mock()
            management.load.side_effect = [bridge, Mock(), bridge, Mock()]
            bridge.safe_node_environment.side_effect = nullcontext
            control = management.SystemOps.return_value
            control.status.return_value = dict(backendRelease=sha, admissionMode='open', controlValid=True, pid=123,
                httpAdmission={'frameworkWork': dict(contract, installed=True, hook='response-cache-revalidate-v1', controlValid=True)})
            flags = '--repo --source-ref --source-digest --signer-workflow --signer-digest --deny-self-hosted-runners --custom-trusted-root --bundle'
            stack.enter_context(patch.multiple(receive, ROOT=root, ETC=root))
            stack.enter_context(patch.object(receive, 'load', return_value=management))
            stack.enter_context(patch.object(receive, 'target_policy'))
            process = stack.enter_context(patch.object(receive.Host, 'process'))
            query = stack.enter_context(patch.object(receive.subprocess, 'check_output', side_effect=[
                flags, json.dumps(dict(release=sha, contract=contract)), flags,
                json.dumps(dict(release=sha, contract={'protocolVersion': 2}))]))
            receive.check_installation()
            with self.assertRaisesRegex(ValueError, 'Live Next profile differs'):
                receive.check_installation()
            self.assertEqual(process.call_count, 2)
            self.assertEqual(query.call_args.args[0][2], 'inspect')
            management.SystemOps.assert_called_with(None, None, preload=receive.PRELOAD)

    def test_pr_merge_filter_matches_repository_base_and_exact_sha(self):
        workflow = (Path(__file__).resolve().parents[3]/'.github/workflows/production.yml').read_text()
        line = next(x for x in workflow.splitlines() if 'jq -se ' in x)
        expression = line[line.index("'")+1:line.rindex("'")]
        sha, repo = 'c'*40, 'zhYAO/Image-web'
        pr = dict(merged_at='2026-01-01T00:00:00Z', merge_commit_sha=sha,
                  base=dict(ref='main', repo=dict(full_name=repo)))
        for pages, accepted in [([[], [pr]], True), ([[]], False), ([[dict(pr, merged_at=None)]], False),
                                ([[dict(pr, merge_commit_sha='d'*40)]], False),
                                ([[dict(pr, base=dict(pr['base'], ref='dev'))]], False),
                                ([[dict(pr, base=dict(ref='main', repo=dict(full_name='elsewhere/repo')))]], False)]:
            with self.subTest(pages=pages):
                result = subprocess.run(['jq', '-se', '--arg', 'sha', sha, '--arg', 'repo', repo, expression],
                                        input='\n'.join(map(json.dumps, pages)), text=True, capture_output=True)
                self.assertEqual(result.returncode, 0 if accepted else 1)
