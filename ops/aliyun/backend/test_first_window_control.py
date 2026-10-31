"""Exercise fixed adapter metadata and actual local atomic template replacement."""
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('first_window_control', HERE / 'first-window.py')
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
NODE = '/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node'


class FirstWindowControlTests(unittest.TestCase):
    def metadata(self, argv=None):
        return ('User=zimage\nGroup=zimage\nWorkingDirectory=/opt/zimage/current/apps/web\n'
                'ExecStart={ path=' + NODE + ' ; argv[]=' + (argv or NODE + ' server.js') + ' ; ignore_errors=no ; }\n'
                'EnvironmentFiles=/etc/zimage/environment /opt/zimage/current/.runtime-assets.env\n'
                'DropInPaths=/etc/systemd/system/zimage.service.d/10-trusted-node.conf\n')
    def policy(self):
        return {'serviceTemplates': {mode: hashlib.sha256((HERE / name).read_bytes()).hexdigest()
                for mode, name in (('candidate', 'backend-lifecycle.conf'), ('legacy', 'backend-legacy.conf'))}}
    def test_original_metadata_is_nonsecret_selected_properties_and_requires_trusted_node(self):
        ops = c.FirstOps(None, None)
        with patch.object(c.subprocess, 'check_output', return_value=self.metadata()) as query:
            value = ops.service_metadata()
            self.assertEqual(value['ExecStart'], [NODE, 'server.js'])
            self.assertEqual(query.call_args.args[0][-1], '--property=User,Group,WorkingDirectory,ExecStart,EnvironmentFiles,DropInPaths')
            self.assertNotIn('--property=Environment', query.call_args.args[0])
        for bad in (self.metadata('/usr/bin/node server.js'), self.metadata().replace('User=zimage', 'User=root'), self.metadata().replace('EnvironmentFiles=', 'Unexpected=')):
            with patch.object(c.subprocess, 'check_output', return_value=bad), self.assertRaises(ValueError): ops.service_metadata()
    def test_live_service_never_changes_or_reloads_its_launch_template(self):
        ops = c.FirstOps(None, None)
        ops.process = lambda: {'pid': 101, 'startTicks': 1, 'bootId': 'irrelevant'}
        with patch.object(c.subprocess, 'run') as run, self.assertRaises(RuntimeError):
            ops.service_mode('candidate', self.policy())
        run.assert_not_called()
    def test_actual_atomic_service_template_replacement_and_reload_preserve_mode_choice(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'backend-lifecycle.conf'
            ops = c.FirstOps(None, None); ops.process = lambda: None
            metadata = Mock()
            for mode, name, argv in (('candidate', 'backend-lifecycle.conf', [NODE, '--require', '/usr/local/libexec/zimage-backend/http-admission.cjs', 'server.js']),
                                    ('legacy', 'backend-legacy.conf', [NODE, 'server.js'])):
                metadata.return_value = {'ExecStart': argv}
                ops.service_metadata = metadata
                with patch.object(c.r, 'SERVICE_DROPIN', path), patch.object(c.r, 'owned'), patch.object(c.subprocess, 'run') as run:
                    ops.service_mode(mode, self.policy())
                    self.assertEqual(path.read_bytes(), (HERE / name).read_bytes())
                    self.assertEqual(path.stat().st_mode & 0o777, 0o644)
                    self.assertEqual(list(path.parent.iterdir()), [path])
                    run.assert_called_once_with(['/usr/bin/systemctl', 'daemon-reload'], check=True)
    def test_template_digest_drift_or_loaded_argv_drift_rejects(self):
        ops = c.FirstOps(None, None); ops.process = lambda: None
        policy = self.policy(); policy['serviceTemplates']['legacy'] = '0' * 64
        with patch.object(c.r, 'owned'), self.assertRaises(ValueError): ops.service_policy(policy)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mode.conf'
            ops.service_metadata = lambda: {'ExecStart': [NODE, 'server.js']}
            with patch.object(c.r, 'SERVICE_DROPIN', path), patch.object(c.r, 'owned'), patch.object(c.subprocess, 'run'), self.assertRaises(ValueError):
                ops.service_mode('candidate', self.policy())


    def test_fixed_root_dispatch_rejects_stale_approval_before_prepare_or_recovery(self):
        policy, completion = {'review': 'original-policy'}, {'review': 'original-completion'}
        for command in ('run', 'recover'):
            for changed in ('policy', 'completion'):
                args = SimpleNamespace(command=command, expected_policy_sha256=c.f.digest(policy),
                                       expected_completion_sha256=c.f.digest(completion))
                ops, adapter, legacy = Mock(), Mock(), Mock()
                ops.first_policy.return_value = policy if changed != 'policy' else {'review': 'changed-policy'}
                ops.completion.return_value = completion if changed != 'completion' else {'review': 'changed-completion'}
                with self.assertRaises(ValueError): c.mutate_locked(args, ops, adapter, legacy)
                adapter.deploy.assert_not_called()
                adapter.prepare.assert_not_called()
                self.assertEqual([call[0] for call in ops.method_calls], ['first_policy', 'completion'])
                self.assertEqual(legacy.mock_calls, [])

    def test_static_checking_marker_cannot_remove_another_operation(self):
        ops = c.FirstOps(None, None)
        policy = {'operationId': 'first-window-01', 'frontendBootstrap': {'namespace': 'web-A', 'splitIngressSha256': 'a' * 64}}
        ops.first_policy = lambda: policy
        ops.frontend_checking = lambda: dict(c.b.marker(policy), operationId='foreign-operation')
        with patch.object(c, 'unlink_synced') as unlink, patch.object(c.f.tx, 'atomic_json') as write:
            with self.assertRaises(ValueError): ops.frontend_mark(None)
            with self.assertRaises(ValueError): ops.frontend_mark(c.b.marker(policy))
            unlink.assert_not_called(); write.assert_not_called()

    def test_public_open_is_published_before_removing_the_exact_seal(self):
        ops = c.FirstOps(None, None)
        policy = {'operationId': 'first-window-01', 'ingressConfigSha256': 'a' * 64}
        token = c.f.seal_token(policy)
        ops.ingress_state = lambda: token
        ops.ingress_open_exists = lambda: False
        ops.ingress_checking = lambda: None
        ops.frontend_checking = lambda: None
        actions = []
        with patch.object(c.r, 'bounded_json', return_value={'schemaVersion': 2, 'operationId': policy['operationId'], 'mode': 'open'}), \
                patch.object(c.f.tx, 'atomic_json', side_effect=lambda path, value, mode: actions.append(('publish', path, value))), \
                patch.object(c, 'unlink_synced', side_effect=lambda path: actions.append(('remove', path))):
            ops.open_ingress(policy)
        self.assertEqual(actions, [('publish', c.OPEN, token), ('remove', c.INGRESS)])

    def test_unreviewed_frontend_tools_cannot_be_imported_by_the_wrapper(self):
        policy, completion = {'review': 'policy'}, {'review': 'completion'}
        args = SimpleNamespace(command='frontend-deploy', operation_id='first-window-01',
                               expected_policy_sha256=c.f.digest(policy), expected_completion_sha256=c.f.digest(completion))
        ops, adapter, legacy = Mock(), Mock(), Mock()
        ops.first_policy.return_value, ops.completion.return_value = policy, completion
        with patch.object(c.r, 'owned', side_effect=ValueError('untrusted closure')), patch.object(c.r, 'load') as load:
            with self.assertRaises(ValueError): c.mutate_locked(args, ops, adapter, legacy)
            load.assert_not_called(); adapter.deploy.assert_not_called()

if __name__ == '__main__': unittest.main()
