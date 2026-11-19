"""Offline contracts/structure only. No application, namespace, network or production access."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BASE = '75b13b75ded14220b6024950b16cefc8255e830a'
spec = importlib.util.spec_from_file_location('lifecycle_smoke', HERE / 'lifecycle-smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
PROFILE = json.loads((HERE / 'backend/next-source-profiles.json').read_text())['candidateProfile']


def framework():
    return dict(protocolVersion=2, nextVersion='16.4.5', sourceProfile=PROFILE)


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
        self.expected = smoke.identity('a'*40, 123, 1, 'b'*64)
        smoke.configure(self.expected, framework())
        self.metadata = dict(schema=1, repository='zhYAO/Image-web', workflow='.github/workflows/ci.yml',
            action='candidate', sha='a'*40, run_id=123, attempt=1, transport_sha256='b'*64)
        self.report = dict(schema=1, releaseSha='a'*40, format='layers', productionReady=False,
                           pack=dict(manifestSha256='c'*64))
        self.target = dict(schema=1, runtime=smoke.RUNTIME,
            toolchain=dict(packageManager='pnpm@11.19.0'), assemblyCacheRoot='/opt/zimage/layer-cache')

    def test_fresh_provenance_and_independent_digest(self):
        smoke.provenance(self.metadata, self.report, self.expected, 'b'*64)
        for key, value in [('sha','d'*40), ('attempt',2), ('repository','other/repo'),
                           ('workflow','other.yml'), ('schema',True)]:
            meta = dict(self.metadata); meta[key] = value
            with self.subTest(key=key), self.assertRaises(smoke.SmokeFailure):
                smoke.provenance(meta, self.report, self.expected, 'b'*64)
        with self.assertRaises(smoke.SmokeFailure):
            smoke.provenance(self.metadata, self.report, self.expected, 'd'*64)
        full = dict(self.report, format='full')
        with self.assertRaises(smoke.SmokeFailure):
            smoke.provenance(self.metadata, full, self.expected, 'b'*64)

    def test_identity_rejects_paths_and_boolean_ids(self):
        for args in [('../path',123,1,'b'*64), ('a'*40,True,1,'b'*64), ('a'*40,123,0,'b'*64)]:
            with self.assertRaises(smoke.SmokeFailure):
                smoke.identity(*args)
        self.assertEqual(self.expected['artifact_name'], 'candidate-'+'a'*40+'-123-1')

    def test_bound_target_mismatch(self):
        manifest = dict(schema=2, distDir='.next', runtime=smoke.RUNTIME,
                        assemblyCacheRoot='/opt/zimage/layer-cache', target=self.target)
        smoke.target_binding(manifest, self.target)
        bad = copy.deepcopy(manifest); bad['target']['runtime']['abi'] = 'wrong'
        with self.assertRaises(smoke.SmokeFailure):
            smoke.target_binding(bad, self.target)

    def test_static_inspection_cannot_learn_from_live_v1_or_wrong_profile(self):
        files = [dict(path=f'/opt/zimage/releases/{smoke.SOURCE}/file-{i}') for i in range(13)]
        files += [dict(path=smoke.PRELOAD), dict(path=smoke.PRELOAD.replace('http-admission.cjs','next-source-profiles.json'))]
        inspected = dict(release=smoke.SOURCE, contract=framework(), files=files)
        smoke.validate_inspection(inspected)
        for contract in [dict(protocolVersion=1,nextVersion='16.4.5'), dict(framework(),sourceProfile='sha256:'+'0'*64), dict(framework(),nextVersion='16.4.6')]:
            with self.assertRaises(smoke.SmokeFailure):
                smoke.validate_inspection(dict(inspected, contract=contract))
        bad = copy.deepcopy(inspected); bad['files'][0]['path'] = '/outside/file'
        with self.assertRaises(smoke.SmokeFailure):
            smoke.validate_inspection(bad)
        self.assertEqual(smoke.EXPECTED_FRAMEWORK, framework())
        with self.assertRaises(smoke.SmokeFailure):
            smoke.configure(self.expected,dict(framework(),sourceProfile='sha256:'+'0'*64))

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

    def test_diagnostics_preserve_startup_isolation_and_all_status_assertions(self):
        baseline = subprocess.check_output(['git','show',
            'f0f6c252f186583dcf4c735276e94960166cc2fe:ops/aliyun/lifecycle-smoke.py'],cwd=ROOT).decode()
        current=(HERE/'lifecycle-smoke.py').read_text(encoding='utf-8')
        def function_body(source,name):
            tree=ast.parse(source)
            node=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name==name)
            return ast.dump(node,include_attributes=False)
        for name in ['validate_status','validate_inspection','child_setup','app_environment',
                     'network_isolated','prepare','recheck','target_binding']:
            self.assertEqual(function_body(baseline,name),function_body(current,name),name)
        original_linux=function_body(baseline,'linux')
        # The two explicit wait phases are the only startup/supervisor edits.
        normalized=current.replace("wait_status(root, app, 40, 'startup')",'wait_status(root, app, 40)')
        normalized=normalized.replace("wait_status(root, app, 2, 'after_probes')",'wait_status(root, app, 2)')
        self.assertEqual(original_linux,function_body(normalized,'linux'))
        # unshare creates a single PID namespace before the supervisor's Popen;
        # child_setup chroots and drops privileges without creating another PID namespace.
        workflow=subprocess.check_output(['git','show',
            'f0f6c252f186583dcf4c735276e94960166cc2fe:.github/workflows/ci.yml'],cwd=ROOT)
        workflow=b''.join(line for line in workflow.splitlines(keepends=True)
            if not line.lstrip().startswith((b'NEXT_PUBLIC_SENTRY_DSN:', b'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE:')))
        self.assertEqual(workflow,(ROOT/'.github/workflows/ci.yml').read_bytes().replace(b'\r\n',b'\n'))
        self.assertIn('--mount --net --pid --fork --kill-child --mount-proc',workflow.decode())

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
        self.assertEqual(env['ZIMAGE_BUILD_SHA'],self.expected['source'])

    def test_wrong_main_context_never_reaches_io(self):
        with mock.patch.dict(smoke.os.environ, {'GITHUB_REF':'refs/heads/other'}, clear=True), mock.patch.object(smoke,'load') as load:
            with self.assertRaises(smoke.SmokeFailure):
                smoke.prepare(Path('unused'),Path('unused'),Path('unused'),self.expected)
            load.assert_not_called()

    def test_main_drift_stops_before_recheck_file_access(self):
        fake=SimpleNamespace(api=lambda _:dict(sha='d'*40))
        with mock.patch.object(smoke,'load',return_value=fake):
            with self.assertRaisesRegex(smoke.SmokeFailure,'Main moved'):
                smoke.recheck(Path('unused'),Path('unused'),Path('unused'),self.expected)

    def test_workflow_only_adds_opt_in_preupload_step_to_same_job(self):
        import yaml
        base=yaml.safe_load(subprocess.check_output(['git','show',BASE+':.github/workflows/ci.yml'],cwd=ROOT))
        current=yaml.safe_load((ROOT/'.github/workflows/ci.yml').read_text(encoding='utf-8'))
        for step in base['jobs']['candidate-build']['steps']:
            for key in ('NEXT_PUBLIC_SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'):
                step.get('env', {}).pop(key, None)
        self.assertEqual(set(base['jobs']),set(current['jobs']))
        for name,job in base['jobs'].items():
            if name!='candidate-build': self.assertEqual(job,current['jobs'][name],name)
        candidate=copy.deepcopy(current['jobs']['candidate-build'])
        new=[step for step in candidate['steps'] if step.get('name')=='Verify fresh candidate lifecycle before upload']
        self.assertEqual(len(new),1)
        step=new[0];index=candidate['steps'].index(step)
        self.assertEqual(candidate['steps'][index+1]['uses'],'actions/upload-artifact@v4')
        candidate['steps'].remove(step)
        self.assertEqual(candidate,base['jobs']['candidate-build'])
        on=current.get('on',current.get(True))
        option=on['workflow_dispatch']['inputs']['verify_lifecycle']
        self.assertEqual(option['type'],'boolean');self.assertIs(option['default'],False)
        self.assertIn('inputs.verify_lifecycle',step['if'])
        self.assertIn("inputs.action == 'candidate'",step['if'])
        self.assertIn('refs/heads/main',step['if'])
        self.assertIn('test "$RELEASE_FORMAT" = layers',step['run'])
        self.assertIn('env -i PATH=',step['run'])
        self.assertNotIn('continue-on-error',step)
        self.assertNotIn('environment',step)
        self.assertNotIn('secrets.',str(step))
        self.assertEqual(current['permissions'],base['permissions'])

    def test_existing_consumer_and_compatibility_sources_unchanged(self):
        for name in ['candidate-artifact.py','release-transport.py','three-layer-release.py',
                     'backend/http-admission.cjs','backend/next-source-profiles.json']:
            old=subprocess.check_output(['git','show',BASE+':ops/aliyun/'+name],cwd=ROOT)
            self.assertEqual((HERE/name).read_bytes().replace(b'\r\n',b'\n'),old,name)
        import hashlib
        for name,checksum in smoke.COMPANION_HASHES.items():
            body=subprocess.check_output(['git','show',BASE+':ops/aliyun/backend/'+name],cwd=ROOT)
            self.assertEqual(hashlib.sha256(body).hexdigest(),checksum)
        for name,checksum in smoke.VALIDATOR_HASHES.items():
            body=subprocess.check_output(['git','show',BASE+':ops/aliyun/'+name],cwd=ROOT)
            self.assertEqual(hashlib.sha256(body).hexdigest(),checksum)

    def test_python_310_syntax_and_no_old_candidate_constants(self):
        source=(HERE/'lifecycle-smoke.py').read_text(encoding='utf-8')
        ast.parse(source,feature_version=(3,10))
        self.assertNotIn('44251245252',source)
        self.assertNotIn('14404186314',source)


if __name__=='__main__':
    unittest.main()
