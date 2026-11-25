"""Offline local package and lifecycle contracts. No external service is used."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('lifecycle_smoke', HERE / 'lifecycle-smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
PROFILE = json.loads((HERE / 'backend/next-source-profiles.json').read_text())['candidateProfile']
NEXT_VERSION = json.loads((HERE.parents[1] / 'apps/web/package.json').read_text())['dependencies']['next']


def framework():
    return dict(protocolVersion=2, nextVersion=NEXT_VERSION, sourceProfile=PROFILE)


def status():
    bridge = dict(installed=True, protocolVersion=1, barrierId='node-http-create-server-v1',
        wrappedServerCount=1, activeHttpRequests=0, activeFrameworkWork=0, controlValid=True,
        schemaVersion=2, admissionMode='checking', admissionEpoch=smoke.EPOCH,
        frameworkWork=dict(installed=True, **framework(), hook='response-cache-revalidate-v1', controlValid=True))
    return dict(schemaVersion=1, backendRelease=smoke.SOURCE, pid=17, controlValid=True, maintenance=True,
        admissionMode='checking', admissionEpoch=smoke.EPOCH, httpAdmission=bridge,
        activeHttpRequests=0, activeFrameworkWork=0,
        counters=dict.fromkeys(['activeMutations','activeStreams','activeRenders','activeExports','pendingFinalizers'], 0))


class SmokeTests(unittest.TestCase):
    def setUp(self):
        smoke.configure('a'*40)
        self.target = dict(schema=1, runtime=smoke.RUNTIME,
            toolchain=dict(packageManager='pnpm@11.19.0'), assemblyCacheRoot='/opt/zimage/layer-cache')

    def test_bound_target_mismatch(self):
        manifest = dict(schema=2, distDir='.next', runtime=smoke.RUNTIME,
                        assemblyCacheRoot='/opt/zimage/layer-cache', target=self.target)
        smoke.target_binding(manifest, self.target)
        bad = copy.deepcopy(manifest); bad['target']['runtime']['abi'] = 'wrong'
        with self.assertRaises(smoke.SmokeFailure):
            smoke.target_binding(bad, self.target)
        with self.assertRaisesRegex(ValueError, 'Invalid target schema'):
            smoke.target_binding(manifest, dict(self.target, schema=True))

    def test_static_inspection_cannot_learn_from_live_v1_or_wrong_profile(self):
        files = [dict(path=f'/opt/zimage/releases/{smoke.SOURCE}/file-{i}') for i in range(13)]
        files += [dict(path=smoke.PRELOAD), dict(path=smoke.PRELOAD.replace('http-admission.cjs','next-source-profiles.json'))]
        inspected = dict(release=smoke.SOURCE, contract=framework(), files=files)
        smoke.validate_inspection(inspected)
        for contract in [dict(protocolVersion=1,nextVersion=NEXT_VERSION), dict(framework(),sourceProfile='sha256:'+'0'*64), dict(framework(),nextVersion='0.0.0')]:
            with self.assertRaises(smoke.SmokeFailure):
                smoke.validate_inspection(dict(inspected, contract=contract))
        bad = copy.deepcopy(inspected); bad['files'][0]['path'] = '/outside/file'
        with self.assertRaises(smoke.SmokeFailure):
            smoke.validate_inspection(bad)
        self.assertEqual(smoke.EXPECTED_FRAMEWORK, framework())

    def test_actual_status_contract_pid_counters_and_control(self):
        smoke.validate_status(status(),17)
        for key, value in [('pid',18),('controlValid',False),('admissionMode','open'),('admissionEpoch','other')]:
            bad=status();bad[key]=value
            with self.assertRaises(smoke.SmokeFailure): smoke.validate_status(bad,17)
        for change in [lambda x:x['httpAdmission']['frameworkWork'].update(protocolVersion=1),
                       lambda x:x['httpAdmission']['frameworkWork'].update(sourceProfile='sha256:'+'0'*64),
                       lambda x:x['counters'].update(pendingFinalizers=1),
                       lambda x:x['httpAdmission'].update(installed=False)]:
            bad=status();change(bad)
            with self.assertRaises(smoke.SmokeFailure): smoke.validate_status(bad,17)

    def test_linux_socket_path_counts_full_prefix_and_encoded_bytes(self):
        from pathlib import PurePosixPath
        external = PurePosixPath('/tmp/zimage-artifact-smoke-abcdefgh/root')
        internal = PurePosixPath('/')
        self.assertEqual(len(smoke.os.fsencode(smoke.socket_path(external))), 74)
        self.assertEqual(len(smoke.os.fsencode(smoke.socket_path(internal))), 34)
        suffix = '/run/zimage-lifecycle/control.sock'
        exact = PurePosixPath('/' + 'x' * (107 - len(suffix) - 1))
        self.assertEqual(len(smoke.os.fsencode(smoke.socket_path(exact))), 107)
        for root in [PurePosixPath(str(exact)+'x'), PurePosixPath('/'+'字'*40)]:
            with self.assertRaisesRegex(smoke.SmokeFailure, 'bounded address'):
                smoke.socket_path(root)

    def test_socket_reader_binds_same_namespace_child_pid_and_keeps_guards(self):
        import stat
        import struct
        root = mock.Mock()
        root.__truediv__ = mock.Mock(return_value=root)
        root.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600, st_uid=smoke.UID)
        conn = mock.MagicMock()
        conn.__enter__.return_value = conn
        conn.getsockopt.return_value = struct.pack('3i', 17, smoke.UID, smoke.UID)
        conn.recv.return_value = json.dumps(status()).encode() + b'\n'
        with mock.patch.object(smoke.socket, 'AF_UNIX', 1, create=True), mock.patch.object(smoke.socket, 'SO_PEERCRED', 17, create=True), mock.patch.object(smoke, 'socket_path', return_value=root), mock.patch.object(smoke.socket, 'socket', return_value=conn):
            progress = dict(stage='waiting')
            self.assertEqual(smoke.private_status(root,17,progress),status())
            self.assertEqual(progress['stage'],'status_validated')
            conn.sendall.assert_called_once_with(b'{"command":"status"}\n')
            for peer in [(18,smoke.UID,0),(17,0,0)]:
                conn.getsockopt.return_value = struct.pack('3i',*peer)
                with self.assertRaisesRegex(smoke.SmokeFailure,'peer PID/UID differs'):
                    smoke.private_status(root,17,dict(stage='waiting'))
            root.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o666, st_uid=smoke.UID)
            with self.assertRaisesRegex(smoke.SmokeFailure,'Untrusted private socket'):
                smoke.private_status(root,17,dict(stage='waiting'))

    def test_wait_reports_fixed_phase_stage_reason_without_payload(self):
        import errno
        errors = [
            (FileNotFoundError(errno.ENOENT,'synthetic-private-payload'),'socket_missing','path_checked'),
            (ConnectionRefusedError(errno.ECONNREFUSED,'synthetic-private-payload'),'connection_refused','socket_verified'),
            (TimeoutError('synthetic-private-payload'),'socket_timeout','peer_verified'),
            (PermissionError(errno.EACCES,'synthetic-private-payload'),'socket_permission','path_checked'),
            (OSError(errno.EIO,'synthetic-private-payload'),'socket_io_error','connected'),
            (smoke.SmokeFailure('Malformed private status shape'),'status_shape_invalid','response_received'),
            (smoke.SmokeFailure('Linux Unix socket pathname exceeds the bounded address'),'socket_path_too_long','waiting'),
            (smoke.SmokeFailure('Private socket peer PID/UID differs'),'peer_mismatch','connected'),
            (smoke.SmokeFailure('Private lifecycle identity/control mismatch'),'identity_control_mismatch','response_received'),
            (smoke.SmokeFailure('Actual HTTP bridge is unavailable'),'http_bridge_invalid','response_received'),
            (smoke.SmokeFailure('Actual audited Next hook is unavailable'),'framework_contract_invalid','response_received'),
            (smoke.SmokeFailure('Offline smoke left unfinished work'),'work_not_idle','response_received'),
            (json.JSONDecodeError('synthetic-private-payload','private',0),'status_json_invalid','response_received'),
            (smoke.SmokeFailure('synthetic-private-payload'),'status_invalid','waiting'),
        ]
        app=SimpleNamespace(pid=17,poll=lambda:None)
        for phase in ('startup','after_probes'):
            for error,code,stage in errors:
                def fail(root,pid,progress):
                    progress['stage']=stage
                    raise error
                with mock.patch.object(smoke,'private_status',side_effect=fail), mock.patch.object(smoke.time,'monotonic',side_effect=[0,41]):
                    with self.assertRaises(smoke.StatusWaitFailure) as caught:
                        smoke.wait_status(None,app,40,phase)
                self.assertEqual(caught.exception.diagnostic,dict(phase=phase,reachedStage=stage,reasonCode=code))
                self.assertNotIn('synthetic-private-payload',str(caught.exception)+json.dumps(caught.exception.diagnostic))

    def test_wait_keeps_furthest_stage_and_observed_exit(self):
        app=SimpleNamespace(pid=17,poll=lambda:None)
        stages=iter(['response_received','path_checked'])
        def fail(root,pid,progress):
            progress['stage']=next(stages)
            raise FileNotFoundError(smoke.errno.ENOENT,'private')
        with mock.patch.object(smoke,'private_status',side_effect=fail), mock.patch.object(smoke.time,'monotonic',side_effect=[0,1,41]), mock.patch.object(smoke.time,'sleep'):
            with self.assertRaises(smoke.StatusWaitFailure) as caught:
                smoke.wait_status(None,app,40,'startup')
        self.assertEqual(caught.exception.diagnostic,dict(phase='startup',reachedStage='response_received',reasonCode='socket_missing'))
        with mock.patch.object(smoke,'private_status') as reader:
            with self.assertRaises(smoke.StatusWaitFailure) as caught:
                smoke.wait_status(None,SimpleNamespace(poll=lambda:1),40,'after_probes')
            reader.assert_not_called()
        self.assertEqual(caught.exception.diagnostic['reasonCode'],'child_exited')

    def test_network_namespace_and_routes_fail_closed(self):
        smoke.network_isolated('net:[1]',['lo'],[dict(dev='lo',dst='::1')],'net:[2]')
        for args in [('same',['lo'],[],'same'), ('old',['lo','eth0'],[],'new'),
                     ('old',['lo'],[dict(dev='eth0',dst='::/0')],'new')]:
            with self.assertRaises(smoke.SmokeFailure): smoke.network_isolated(*args)

    def test_environment_does_not_inherit_tokens_or_accounts(self):
        with mock.patch.dict(smoke.os.environ, dict(GH_TOKEN='synthetic',SUPABASE_SECRET_KEY='synthetic')):
            env=smoke.app_environment(dict(ZIMAGE_SHARED_FONT_DIR='/opt/zimage/layer-cache/assets/'+'c'*64+'/fonts',
                                           ZIMAGE_STATIC_ASSET_SHA256='c'*64))
        self.assertNotIn('GH_TOKEN',env);self.assertNotIn('SUPABASE_SECRET_KEY',env)
        self.assertEqual(env['ZIMAGE_LIFECYCLE_ENABLED'],'1')
        self.assertEqual(env['ZIMAGE_BUILD_SHA'], 'a'*40)
        model_env = smoke.app_environment(dict(ZIMAGE_STATIC_ASSET_SHA256='c'*64))
        self.assertNotIn('ZIMAGE_SHARED_FONT_DIR', model_env)
        with self.assertRaises(smoke.SmokeFailure):
            smoke.app_environment(dict(ZIMAGE_STATIC_ASSET_SHA256='c'*64, UNEXPECTED='value'))


fixture_spec = importlib.util.spec_from_file_location('layers_fixture', HERE / 'test_three_layer_release.py')
fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixture)


class LocalPackage(fixture.PortableFixture):
    runtime = smoke.RUNTIME

    def test_offline_cli_checks_exact_complete_local_store(self):
        old = self.source / self.dist
        self.dist = 'apps/web/.next/'
        old.rename(self.source / self.dist)
        self.config['distDir'] = '.next'
        self.set_config()
        source = '1' * 40
        packed = self.pack(source)
        digest = packed['manifestSha256']
        target = self.root / 'target.json'
        target.write_text(json.dumps(self.target))

        def run(source, digest):
            return subprocess.run([sys.executable, '-I', '-B', str(HERE / 'lifecycle-smoke.py'),
                'check', str(self.store), str(target), source, digest], capture_output=True, text=True)

        result = run(source, digest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), dict(source=source, manifestSha256=digest,
                                                        verifiedFiles=7, productionReady=False))
        for wrong_source, wrong_digest in [(source, '0'*64), ('../invalid', digest), ('2'*40, digest)]:
            self.assertNotEqual(run(wrong_source, wrong_digest).returncode, 0)
        (self.store / packed['layers']['code']['archive']).write_bytes(b'changed')
        self.assertNotEqual(run(source, digest).returncode, 0)


if __name__=='__main__':
    unittest.main()
