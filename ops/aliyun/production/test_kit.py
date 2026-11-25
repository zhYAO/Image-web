from contextlib import ExitStack, nullcontext
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import Mock, patch

import kit
import receive


WORKFLOW = Path(__file__).resolve().parents[3]/'.github/workflows/production.yml'


def bash(script, cwd, env):
    return subprocess.run(['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
                          env={'PATH': '/usr/bin:/bin', **env}, cwd=cwd, text=True, capture_output=True, timeout=5)


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
            flags = '--repo --source-ref --source-digest --signer-workflow --signer-digest --deny-self-hosted-runners --custom-trusted-root --bundle --format'
            version = 'gh version 2.102.0 (2026-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n'
            stack.enter_context(patch.multiple(receive, ROOT=root, ETC=root))
            stack.enter_context(patch.object(receive, 'load', return_value=management))
            stack.enter_context(patch.object(receive, 'target_policy'))
            stack.enter_context(patch.object(receive.shutil, 'which', return_value=str(receive.NODE)))
            process = stack.enter_context(patch.object(receive.Host, 'process'))
            query = stack.enter_context(patch.object(receive.subprocess, 'check_output', side_effect=[
                version, flags, json.dumps(dict(release=sha, contract=contract)), version, flags,
                json.dumps(dict(release=sha, contract={'protocolVersion': 2}))]))
            receive.check_installation()
            with self.assertRaisesRegex(ValueError, 'Live Next profile differs'):
                receive.check_installation()
            self.assertEqual(process.call_count, 2)
            self.assertEqual(query.call_args.args[0][2], 'inspect')
            management.SystemOps.assert_called_with(None, None, preload=receive.PRELOAD)

    def test_admin_check_rejects_fallback_node_before_target_probe(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            (root/'production-trusted-root.jsonl').write_text('{"certificateAuthorities":[{}]}')
            management = Mock()
            bridge = management.load.return_value
            bridge.safe_node_environment.side_effect = nullcontext
            stack.enter_context(patch.object(receive, 'load', return_value=management))
            stack.enter_context(patch.object(receive, 'ETC', root))
            stack.enter_context(patch.object(receive, 'target_policy'))
            stack.enter_context(patch.object(receive.shutil, 'which', return_value='/usr/bin/node'))
            query = stack.enter_context(patch.object(receive.subprocess, 'check_output', side_effect=[
                'gh version 2.102.0', '--repo --signer-workflow --source-ref --source-digest --signer-digest '
                '--deny-self-hosted-runners --bundle --custom-trusted-root --format']))
            with self.assertRaisesRegex(ValueError, 'dedicated Node'):
                receive.check_installation()
            management.owned.assert_any_call(Path('/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node'))
            bridge.enabled_target_check.assert_not_called()
            self.assertEqual(query.call_count, 2)

    def test_installed_admin_check_rejects_unpatched_verifier(self):
        with patch.object(receive, 'load') as load, patch.object(receive.subprocess, 'check_output',
                return_value='gh version 2.101.9 (2026-09-01)') as query:
            with self.assertRaisesRegex(ValueError, 'gh >= 2.102.0'):
                receive.check_installation()
        self.assertEqual(query.call_args.args[0], ['/usr/bin/gh', '--version'])
        load.return_value.SystemOps.assert_not_called()

    def test_pr_merge_gate_runs_the_workflow_step(self):
        workflow = WORKFLOW.read_text()
        job = workflow.split('\n  merged-pr:\n', 1)[1].split('\n  build-only:\n', 1)[0]
        self.assertIn('        shell: bash\n', job)
        step = textwrap.dedent(job.split('        run: |\n', 1)[1])
        sha, repo = 'c'*40, 'zhYAO/Image-web'
        pr = dict(merged_at='2026-01-01T00:00:00Z', merge_commit_sha=sha,
                  base=dict(ref='main', repo=dict(full_name=repo)), head=dict(repo=dict(full_name=repo)))
        match, empty = json.dumps([pr]), '[]'
        mismatches = json.dumps([dict(pr, merged_at=None), dict(pr, merge_commit_sha='d'*40),
                                 dict(pr, base=dict(pr['base'], ref='dev')),
                                 dict(pr, base=dict(ref='main', repo=dict(full_name='elsewhere/repo'))),
                                 dict(pr, head=dict(repo=dict(full_name='fork/Image-web'))),
                                 dict(pr, head=dict(repo=None))])
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
                result = bash(stubs+step, root, dict(GITHUB_SHA=sha, GITHUB_REPOSITORY=repo))
                self.assertEqual(result.returncode == 0, success, result.stderr)
                self.assertEqual((root/'queries').read_text().splitlines(), ['gh']*len(replies))
                self.assertEqual((root/'waits').read_text().splitlines(), ['2', '4', '8', '16'][:len(replies)-1])

    def test_delivery_scope_and_signed_subject(self):
        workflow = WORKFLOW.read_text()
        build_only, publish = workflow.split('\n  build-only:\n')[1].split('\n  publish:\n')
        self.assertIn("if: vars.ZIMAGE_PRODUCTION_DEPLOY_ENABLED != '1' || github.run_attempt != '1'", build_only)
        self.assertIn("if: vars.ZIMAGE_PRODUCTION_DEPLOY_ENABLED == '1' && github.run_attempt == '1'", publish)
        self.assertIn("github.ref == 'refs/heads/main' && github.ref_protected", workflow)
        self.assertNotRegex(build_only, r'environment:|actions/attest@|secrets\.|id-token:')
        self.assertNotIn('upload-artifact', workflow)
        self.assertEqual(workflow.count('secrets.'), 1)
        tip, sender = publish.split('      - name: Deliver once over pinned SSH\n')
        self.assertIn('subject-digest: sha256:${{ steps.pair.outputs.sha256 }}', tip)
        self.assertIn('subject-name: pair.tar', tip)
        self.assertNotIn('secrets.', tip)
        self.assertIn("if: steps.tip.outputs.state == 'current'", sender)
        self.assertIn('SSH_KEY: ${{ secrets.ZIMAGE_PRODUCTION_RELEASE_KEY }}', sender)
        self.assertNotIn('GH_TOKEN:', sender)

    def test_signed_digest_tip_gate_and_terminal_summaries(self):
        def step(name):
            body = WORKFLOW.read_text().split('      - name: '+name+'\n', 1)[1].split('        run: |\n', 1)[1]
            return textwrap.dedent(re.split(r'\n(?=\S| {1,9}\S)', body, maxsplit=1)[0])
        sha = 'c'*40
        env = dict(GITHUB_SHA=sha, GITHUB_RUN_NUMBER='41', GITHUB_RUN_ID='9001', GITHUB_RUN_ATTEMPT='1',
                   GITHUB_REPOSITORY='zhYAO/Image-web', RUNNER_TEMP='.', GITHUB_OUTPUT='output',
                   GITHUB_STEP_SUMMARY='summary')
        tip = step('Check protected main tip')
        gh = '''
gh() {
  [[ $# == 2 && $1 == api && $2 == "repos/$GITHUB_REPOSITORY/branches/main" ]] || return 99
  cat reply
  return "$GH_STATUS"
}
'''
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'zimage-pair').mkdir()
            pair = root/'zimage-pair/pair.tar'
            pair.write_bytes(b'signed bytes')
            # GITHUB_OUTPUT is absolute in Actions and remains outside the pair directory.
            env['GITHUB_OUTPUT'] = (root/'output').as_posix()
            digest = hashlib.sha256(pair.read_bytes()).hexdigest()
            self.assertEqual(bash(step('Hash pair for signing'), root, env).returncode, 0)
            self.assertEqual((root/'output').read_text().strip(), 'sha256='+digest)
            record = step('Record signed pair before delivery')
            self.assertEqual(bash(record, root, dict(env, SIGNED_SHA256=digest)).returncode, 0)
            summary = (root/'summary').read_text()
            for value in (digest, sha, 'run #41', 'ID 9001'):
                self.assertIn(value, summary)
            pair.write_bytes(b'changed after signing')
            self.assertNotEqual(bash(record, root, dict(env, SIGNED_SHA256=digest)).returncode, 0)

            current = dict(name='main', protected=True, commit=dict(sha=sha))
            for response, status, state in [(json.dumps(current), 0, 'current'), (json.dumps(current), 1, None),
                    (json.dumps(dict(current, commit=dict(sha='d'*40))), 0, 'stale'),
                    (json.dumps(dict(current, protected=False)), 0, None), ('{}', 0, None),
                    ('', 0, None), (json.dumps(dict(current, commit=dict(sha='malformed'))), 0, None)]:
                with self.subTest(response=response, status=status):
                    (root/'reply').write_text(response)
                    (root/'output').write_text('')
                    result = bash(gh+tip, root, dict(env, GH_STATUS=str(status)))
                    self.assertEqual(result.returncode == 0, state is not None, result.stderr)
                    self.assertEqual((root/'output').read_text().strip(), 'state='+state if state else '')

            for tip_result, state, delivery, phase, message in [
                    ('success', 'stale', 'skipped', '', 'stale after signing'),
                    ('failure', '', 'skipped', '', 'not sent: could not read'),
                    ('success', 'current', 'failure', 'restored', 'restored: retained pair verified'),
                    ('success', 'current', 'cancelled', '', 'unconfirmed delivery'),
                    ('success', 'current', 'success', 'committed', 'committed: candidate verified')]:
                with self.subTest(message=message):
                    (root/'summary').write_text('')
                    result = bash(step('Record release outcome'), root, dict(env, TIP_RESULT=tip_result,
                                  TIP_STATE=state, DELIVERY=delivery, PHASE=phase))
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn(message, (root/'summary').read_text())
            for attempt, reason in [('1', 'deployment disabled'), ('2', 'reruns cannot publish')]:
                (root/'summary').write_text('')
                result = bash(step('Record build-only outcome'), root, dict(env, BUILD='success', GITHUB_RUN_ATTEMPT=attempt))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(reason, (root/'summary').read_text())
