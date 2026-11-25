from contextlib import ExitStack, nullcontext
import json
from pathlib import Path
import stat
import subprocess
import tempfile
import textwrap
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

    def test_pr_merge_gate_runs_the_workflow_step(self):
        workflow = (Path(__file__).resolve().parents[3]/'.github/workflows/production.yml').read_text()
        job = workflow.split('\n  merged-pr:\n', 1)[1].split('\n  build-only:\n', 1)[0]
        self.assertIn('        shell: bash\n', job)
        step = textwrap.dedent(job.split('        run: |\n', 1)[1])
        sha, repo = 'c'*40, 'zhYAO/Image-web'
        pr = dict(merged_at='2026-01-01T00:00:00Z', merge_commit_sha=sha,
                  base=dict(ref='main', repo=dict(full_name=repo)))
        match, empty = json.dumps([pr]), '[]'
        mismatches = json.dumps([dict(pr, merged_at=None), dict(pr, merge_commit_sha='d'*40),
                                 dict(pr, base=dict(pr['base'], ref='dev')),
                                 dict(pr, base=dict(ref='main', repo=dict(full_name='elsewhere/repo')))])
        # Only gh and sleep are replaced. Bash uses the same exit/pipefail flags as Actions.
        stubs = '''
gh() {
  echo gh >> queries
  [[ $# == 3 && $1 == api && $2 == --paginate &&
     $3 == "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls" ]] || return 91
  local n
  n=$(wc -l < queries)
  cat "reply-$n" || return 92
  return "$(cat "status-$n")"
}
sleep() { echo "$1" >> waits; }
'''
        # Each reply is gh's stdout (one array per page) plus its exit code.
        for name, replies, success in [
            ('first page', [(match+'\n'+empty, 0)], True),
            ('delayed last page', [(empty, 0), (empty, 0), (empty+'\n'+match, 0)], True),
            ('last attempt', [(empty, 0)]*4 + [(match, 0)], True),
            ('no PR', [(empty, 0)]*5, False),
            ('inexact PRs', [(mismatches, 0)]*5, False),
            ('API failure', [('', 1)], False),
            ('later page failed', [(empty, 0), (match, 1)], False),
            ('invalid JSON', [(match+'\n[', 0)], False),
            ('missing body', [('', 0)], False),
            ('invalid page', [(match+'\n{}', 0)], False),
        ]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                for n, (reply, status) in enumerate(replies, 1):
                    (root/f'reply-{n}').write_text(reply)
                    (root/f'status-{n}').write_text(str(status))
                (root/'waits').touch()
                result = subprocess.run(['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', stubs+step],
                                        env=dict(PATH='/usr/bin:/bin', GITHUB_SHA=sha, GITHUB_REPOSITORY=repo),
                                        cwd=root, text=True, capture_output=True, timeout=5)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                self.assertEqual((root/'queries').read_text().splitlines(), ['gh']*len(replies))
                self.assertEqual((root/'waits').read_text().splitlines(), ['2', '4', '8', '16'][:len(replies)-1])
