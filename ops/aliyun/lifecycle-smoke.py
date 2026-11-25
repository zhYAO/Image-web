"""Check a local layer store against an independently supplied SHA, manifest digest and target.

`check` is read-only. `linux` additionally boots that package on a disposable,
isolated Linux builder. Both use the trusted checkout's validation tools.
"""
import argparse
import errno
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
SOURCE = EPOCH = ENTRY = EXPECTED_FRAMEWORK = None
RUNTIME = dict(node='24.19.0', abi='137', platform='linux', arch='x64', libc='glibc-2.35')
NODE = '/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node'
PRELOAD = '/usr/local/libexec/zimage-backend/http-admission.cjs'
UID = 65534
_spec = importlib.util.spec_from_file_location('smoke_transport', HERE / 'release-transport.py')
transport = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(transport)


class SmokeFailure(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise SmokeFailure(message)


def configure(source):
    global SOURCE, EPOCH, ENTRY, EXPECTED_FRAMEWORK
    require(re.fullmatch('[a-f0-9]{40}', source), 'Invalid expected source')
    SOURCE = source
    EPOCH = 'lifecycle-' + source
    ENTRY = f'/opt/zimage/releases/{SOURCE}/apps/web'
    # Expected framework comes from the trusted checkout, never the app's first status.
    app = json.loads((HERE.parents[1] / 'apps/web/package.json').read_bytes())
    catalog = json.loads((HERE / 'backend/next-source-profiles.json').read_bytes())
    EXPECTED_FRAMEWORK = dict(protocolVersion=2, nextVersion=app['dependencies']['next'],
                              sourceProfile=catalog['candidateProfile'])


def check(store, target_file, source, manifest_sha):
    require(re.fullmatch('[a-f0-9]{40}', source), 'Invalid expected source')
    manifest_path = store / 'releases' / (source + '.json')
    # request() checks every file's size and digest, the exact SHA path, and layer bindings.
    verified = transport.request(store, manifest_path, manifest_sha)
    body = transport.layers.read_regular(manifest_path)
    require(hashlib.sha256(body).hexdigest() == manifest_sha, 'Manifest changed after validation')
    target_binding(transport.layers.parse(body), transport.layers.parse(target_file.read_bytes()))
    return dict(source=source, manifestSha256=manifest_sha, verifiedFiles=len(verified['files']), productionReady=False)


def app_environment(environment):
    # No inherited environment, task token, account, Supabase secret, DSN or SSH material.
    result = dict(PATH='/nonexistent', HOME='/tmp', TMPDIR='/tmp', NODE_ENV='production',
                  HOSTNAME='127.0.0.1', PORT='3100', ZIMAGE_LIFECYCLE_ENABLED='1',
                  ZIMAGE_BUILD_SHA=SOURCE, NEXT_TELEMETRY_DISABLED='1',
                  NODE_OPTIONS='--max-old-space-size=640')
    require(set(environment) in ({'ZIMAGE_STATIC_ASSET_SHA256'}, {'ZIMAGE_SHARED_FONT_DIR', 'ZIMAGE_STATIC_ASSET_SHA256'}),
            'Unexpected resource environment')
    require(re.fullmatch('[a-f0-9]{64}', environment['ZIMAGE_STATIC_ASSET_SHA256'])
            and ('ZIMAGE_SHARED_FONT_DIR' not in environment or environment['ZIMAGE_SHARED_FONT_DIR'] ==
                 '/opt/zimage/layer-cache/assets/' + environment['ZIMAGE_STATIC_ASSET_SHA256'] + '/fonts'),
            'Invalid resource binding')
    return {**result, **environment}


def network_isolated(outer_namespace, interfaces, routes, current_namespace):
    require(current_namespace != outer_namespace, 'Network namespace was not changed')
    require(set(interfaces) == {'lo'}, 'Non-loopback interface exists')
    require(all(r.get('dev') == 'lo' and r.get('dst') != 'default' for r in routes),
            'Outbound route exists')


def target_binding(manifest, target):
    transport.layers.validate_target_shape(target)
    require(manifest['schema'] in (2, 3) and manifest['distDir'] == '.next'
            and manifest['runtime'] == RUNTIME and manifest['assemblyCacheRoot'] == '/opt/zimage/layer-cache'
            and manifest['target'] == target, 'Manifest differs from independently supplied bound target')


def validate_inspection(value):
    require(set(value) == {'release', 'contract', 'files'} and value['release'] == SOURCE
            and value['contract'] == EXPECTED_FRAMEWORK, 'Artifact pin/profile differs from reviewed compiled expectation')
    paths = [item['path'] for item in value['files']]
    require(len(paths) == 15 and len(set(paths)) == 15
            and all(name.startswith('/opt/zimage/releases/' + SOURCE + '/')
                    or name in (PRELOAD, PRELOAD.replace('http-admission.cjs', 'next-source-profiles.json'))
                    for name in paths), 'Inspected modules escape the reviewed immutable closure')


def validate_status(value, pid):
    bridge = value.get('httpAdmission', {})
    require(type(value.get('schemaVersion')) is int and value['schemaVersion'] == 1 and type(value.get('pid')) is int
            and value.get('backendRelease') == SOURCE and value.get('pid') == pid
            and value.get('controlValid') is True and value.get('maintenance') is True
            and value.get('admissionMode') == 'checking' and value.get('admissionEpoch') == EPOCH,
            'Private lifecycle identity/control mismatch')
    require(bridge.get('installed') is True and type(bridge.get('protocolVersion')) is int
            and bridge.get('protocolVersion') == 1
            and bridge.get('barrierId') == 'node-http-create-server-v1'
            and type(bridge.get('wrappedServerCount')) is int and bridge['wrappedServerCount'] >= 1
            and bridge.get('controlValid') is True and type(bridge.get('schemaVersion')) is int
            and bridge['schemaVersion'] == 2
            and bridge.get('admissionMode') == 'checking' and bridge.get('admissionEpoch') == EPOCH,
            'Actual HTTP bridge is unavailable')
    require(type(bridge.get('frameworkWork', {}).get('protocolVersion')) is int
            and bridge.get('frameworkWork', {}).get('installed') is True
            and bridge.get('frameworkWork', {}).get('controlValid') is True
            and bridge.get('frameworkWork') == dict(installed=True, **EXPECTED_FRAMEWORK, hook='response-cache-revalidate-v1', controlValid=True),
            'Actual audited Next hook is unavailable')
    counters = value.get('counters', {})
    require(set(counters) == {'activeMutations', 'activeStreams', 'activeRenders', 'activeExports', 'pendingFinalizers'}
            and all(type(v) is int and v == 0 for v in counters.values())
            and all(type(v) is int and v == 0 for v in
                [value.get('activeHttpRequests'), bridge.get('activeHttpRequests'),
                 value.get('activeFrameworkWork'), bridge.get('activeFrameworkWork')]),
            'Offline smoke left unfinished work')


# Only these fixed values can reach a diagnostic. Never serialize an exception,
# pathname, PID, status payload or application output.
STATUS_STAGES = ('waiting', 'path_checked', 'socket_verified', 'connected',
                 'peer_verified', 'response_received', 'status_validated')
STATUS_REASONS = {
    'Malformed private status shape': 'status_shape_invalid',
    'Untrusted private socket': 'socket_untrusted',
    'Private socket peer PID/UID differs': 'peer_mismatch',
    'Invalid bounded status response': 'response_invalid',
    'Private lifecycle identity/control mismatch': 'identity_control_mismatch',
    'Actual HTTP bridge is unavailable': 'http_bridge_invalid',
    'Actual audited Next hook is unavailable': 'framework_contract_invalid',
    'Offline smoke left unfinished work': 'work_not_idle',
    'Linux Unix socket pathname exceeds the bounded address': 'socket_path_too_long',
}


class StatusWaitFailure(SmokeFailure):
    def __init__(self, phase, stage, code):
        require(phase in ('startup', 'after_probes') and stage in STATUS_STAGES
                and code in set(STATUS_REASONS.values()) | {
                    'socket_missing', 'connection_refused', 'socket_timeout',
                    'socket_permission', 'socket_io_error', 'status_json_invalid',
                    'status_shape_invalid', 'status_invalid', 'child_exited'},
                'Invalid diagnostic enum')
        super().__init__('Exact bridge/status verification failed')
        self.diagnostic = dict(phase=phase, reachedStage=stage, reasonCode=code)


def socket_path(root):
    path = root / 'run/zimage-lifecycle/control.sock'
    # Linux sockaddr_un.sun_path has 108 bytes, including the terminating NUL.
    # Count the supervisor's full path, including the chroot's external prefix.
    require(len(os.fsencode(path)) <= 107,
            'Linux Unix socket pathname exceeds the bounded address')
    return path


def private_status(root, pid, progress):
    path = socket_path(root)
    progress['stage'] = 'path_checked'
    info = path.lstat()
    require(stat.S_ISSOCK(info.st_mode) and info.st_uid == UID and stat.S_IMODE(info.st_mode) == 0o600,
            'Untrusted private socket')
    progress['stage'] = 'socket_verified'
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(2)
        connection.connect(str(path))
        progress['stage'] = 'connected'
        peer = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        require(peer[:2] == (pid, UID), 'Private socket peer PID/UID differs')
        progress['stage'] = 'peer_verified'
        connection.sendall(b'{"command":"status"}\n')
        body = b''
        while not body.endswith(b'\n'):
            chunk = connection.recv(4096)
            require(bool(chunk) and len(body) + len(chunk) <= 16384, 'Invalid bounded status response')
            body += chunk
    progress['stage'] = 'response_received'
    value = json.loads(body)
    require(isinstance(value, dict) and isinstance(value.get('httpAdmission'), dict)
            and isinstance(value['httpAdmission'].get('frameworkWork'), dict)
            and isinstance(value.get('counters'), dict), 'Malformed private status shape')
    validate_status(value, pid)
    progress['stage'] = 'status_validated'
    return value


def status_reason(error):
    if isinstance(error, SmokeFailure):
        return STATUS_REASONS.get(str(error), 'status_invalid')
    if isinstance(error, OSError):
        return {errno.ENOENT: 'socket_missing', errno.ECONNREFUSED: 'connection_refused',
                errno.EACCES: 'socket_permission', errno.EPERM: 'socket_permission',
                errno.ETIMEDOUT: 'socket_timeout'}.get(error.errno,
                    'socket_timeout' if isinstance(error, TimeoutError) else 'socket_io_error')
    if isinstance(error, (json.JSONDecodeError, UnicodeError)):
        return 'status_json_invalid'
    return 'status_invalid'


def wait_status(root, app, timeout, phase):
    deadline = time.monotonic() + timeout
    reached = 'waiting'
    while True:
        if app.poll() is not None:
            raise StatusWaitFailure(phase, reached, 'child_exited')
        progress = dict(stage='waiting')
        try:
            return private_status(root, app.pid, progress)
        except (OSError, ValueError) as error:
            if STATUS_STAGES.index(progress['stage']) > STATUS_STAGES.index(reached):
                reached = progress['stage']
            if time.monotonic() >= deadline:
                raise StatusWaitFailure(phase, reached, status_reason(error)) from None
            time.sleep(0.1)


def get(path):
    connection = http.client.HTTPConnection('127.0.0.1', 3100, timeout=2)
    try:
        connection.request('GET', path, headers={'Host': 'www.zimage.store', 'Connection': 'close'})
        response = connection.getresponse()
        body = response.read(16385)
        require(len(body) <= 16384, 'Response exceeds smoke bound')
        return response.status, {k.lower(): v for k, v in response.getheaders()}, json.loads(body)
    finally:
        connection.close()


def trusted_copy(source, destination):
    require(source.is_absolute() and source.is_file(), 'Trusted runtime file missing')
    info = source.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'Writable/untrusted host runtime')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    destination.chmod(0o555)


def child_setup(root):
    # Called only in the forked child before exec. No namespace/privilege fallback.
    import ctypes
    import resource
    os.setsid()
    os.chroot(root)
    os.chdir(ENTRY)
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(38, 1, 0, 0, 0) == 0, 'Cannot enforce no_new_privs')
    for capability in range(64):
        if libc.prctl(24, capability, 0, 0, 0) != 0:
            require(ctypes.get_errno() == 22, 'Cannot drop capability bounding set')
    require(libc.prctl(47, 4, 0, 0, 0) == 0, 'Cannot clear ambient capabilities')
    os.setgroups([])
    os.setgid(UID)
    os.setuid(UID)
    class Header(ctypes.Structure):
        _fields_ = [('version', ctypes.c_uint32), ('pid', ctypes.c_int)]
    class Data(ctypes.Structure):
        _fields_ = [('effective', ctypes.c_uint32), ('permitted', ctypes.c_uint32), ('inheritable', ctypes.c_uint32)]
    header, data = Header(0x20080522, 0), (Data * 2)()
    require(libc.capget(ctypes.byref(header), ctypes.byref(data)) == 0
            and all(d.effective == d.permitted == d.inheritable == 0 for d in data)
            and libc.prctl(39, 0, 0, 0, 0) == 1, 'Child retained privilege')
    resource.setrlimit(resource.RLIMIT_CPU, (45, 60))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (1024, 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.umask(0o077)


def linux(store, target_file, source, manifest_sha, node, outer_namespace, outer_mount_namespace):
    require(sys.platform == 'linux' and os.geteuid() == 0, 'Requires isolated Linux root supervisor')
    require(set(os.environ) == {'PATH', 'LC_ALL'} and os.environ['PATH'] == '/usr/bin:/bin'
            and os.environ['LC_ALL'] == 'C.UTF-8',
            'Supervisor inherited an unexpected environment')
    require(os.getpid() == 1, 'PID namespace is required')
    require(re.fullmatch(r'mnt:\[[0-9]+\]', outer_mount_namespace)
            and os.readlink('/proc/self/ns/mnt') != outer_mount_namespace,
            'Mount namespace was not changed')
    subprocess.run(['/usr/bin/mount', '--make-rprivate', '/'], check=True, capture_output=True)
    routes = json.loads(subprocess.check_output(['/usr/sbin/ip', '-j', 'route', 'show', 'table', 'all']))
    routes += json.loads(subprocess.check_output(['/usr/sbin/ip', '-6', '-j', 'route', 'show', 'table', 'all']))
    network_isolated(outer_namespace, [n for _, n in socket.if_nameindex()], routes,
                     os.readlink('/proc/self/ns/net'))
    subprocess.run(['/usr/sbin/ip', 'link', 'set', 'lo', 'up'], check=True, capture_output=True)
    require(not os.path.lexists('/opt/zimage'), 'Ephemeral runner already contains a zimage tree')
    require(node.is_absolute() and node.name == 'node', 'Expected explicit trusted Node binary')
    info = node.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
            'Writable/untrusted host runtime')
    fingerprint = json.loads(subprocess.check_output([str(node), '-e',
        "const h=process.report.getReport().header;console.log(JSON.stringify({node:process.versions.node,abi:process.versions.modules,platform:process.platform,arch:process.arch,libc:'glibc-'+h.glibcVersionRuntime}))"]))
    require(fingerprint == RUNTIME, 'Exact Linux/Node runtime mismatch')
    checked = check(store, target_file, source, manifest_sha)
    configure(source)
    with tempfile.TemporaryDirectory(prefix='zimage-artifact-smoke-') as work:
        work = Path(work)
        root = work / 'root'
        root.mkdir(mode=0o755)
        # The assembler requires the absolute cache binding. Only the private
        # mount namespace sees this temporary root at /opt; the host never does.
        (root / 'opt').mkdir()
        subprocess.run(['/usr/bin/mount', '--bind', str(root / 'opt'), '/opt'], check=True, capture_output=True)
        # Original offline assembly, explicit local-only mode; no server adapter/activation.
        node_dir = work / 'node-bin'
        node_dir.mkdir()
        (node_dir / 'node').symlink_to(node)
        os.environ['PATH'] = str(node_dir) + ':/usr/bin:/bin'
        assembled = transport.layers.assemble(store / 'releases' / (SOURCE + '.json'), store,
            Path('/opt/zimage/releases') / SOURCE, Path('/opt/zimage/layer-cache'),
            manifest_sha, True)
        trusted_copy(node, root / NODE.lstrip('/'))
        # ldd is run only against the trusted setup-node binary, never candidate code.
        linked = subprocess.check_output(['/usr/bin/ldd', str(node)], text=True)
        libraries = re.findall(r'(?:=>\s*)?(/[^\s()]+)', linked)
        require(bool(libraries), 'Cannot establish trusted Node shared libraries')
        for library in set(libraries):
            require(library.startswith(('/lib/', '/lib64/', '/usr/lib/')), 'Unexpected Node library path')
            trusted_copy(Path(library).resolve(), root / library.lstrip('/'))
        preload = root / PRELOAD.lstrip('/')
        preload.parent.mkdir(parents=True)
        shutil.copyfile(HERE / 'backend/http-admission.cjs', preload)
        preload.chmod(0o444)
        catalog = preload.with_name('next-source-profiles.json')
        shutil.copyfile(HERE / 'backend/next-source-profiles.json', catalog)
        catalog.chmod(0o444)
        control = root / 'etc/zimage/backend-maintenance.json'
        control.parent.mkdir(parents=True)
        control.write_text(json.dumps(dict(schemaVersion=2, operationId=EPOCH, mode='checking')))
        control.chmod(0o644)
        directory = root / 'run/zimage-lifecycle'
        directory.mkdir(parents=True, mode=0o700)
        os.chown(directory, UID, UID)
        (root / 'tmp').mkdir(mode=0o700)
        os.chown(root / 'tmp', UID, UID)
        cache = root / ENTRY.lstrip('/') / '.next/cache'
        require(not cache.exists() and not cache.is_symlink(), 'Unexpected application cache')
        cache.mkdir(mode=0o700)
        os.chown(cache, UID, UID)
        env = app_environment(assembled['environment'])
        with (work / 'private-app.log').open('xb') as log:
            os.chmod(log.name, 0o600)
            # Inspect the actual installed artifact BEFORE asking the live app for status.
            inspected = subprocess.run([NODE, PRELOAD, 'inspect', ENTRY + '/server.js'], executable=NODE,
                env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=log,
                close_fds=True, preexec_fn=lambda: child_setup(root), timeout=15)
            require(inspected.returncode == 0 and len(inspected.stdout) <= 32768, 'Immutable artifact inspection failed')
            contract = json.loads(inspected.stdout)
            validate_inspection(contract)
            app = subprocess.Popen([NODE, '--require', PRELOAD, 'server.js'],
                executable=NODE, env=env,
                stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True,
                preexec_fn=lambda: child_setup(root))
            try:
                wait_status(root, app, 40, 'startup')
                status, headers, value = get('/api/health/ready')
                require(status == 200 and value.get('version') == SOURCE
                        and 'no-store' in headers.get('cache-control', ''), 'Exact ready failed')
                status, _, value = get('/api/meta')
                require(status == 200 and value.get('backendRelease') == SOURCE, 'Exact meta failed')
                # This GET is blocked by the real HTTP barrier before route/auth/DB execution.
                status, headers, value = get('/api/chat')
                require(status == 503 and value.get('code') == 'network'
                        and headers.get('retry-after') == '30', 'Protected-path barrier did not reject')
                wait_status(root, app, 2, 'after_probes')
                print(json.dumps(dict(**checked, runtime=fingerprint, framework=EXPECTED_FRAMEWORK,
                    exactArtifactBoot=True, privatePeerAndBridge=True, checkingBarrier=True,
                    outboundNetwork=False, rollbackTested=False)))
            finally:
                if app.poll() is None:
                    os.killpg(app.pid, 15)
                    try:
                        app.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(app.pid, 9)
                        app.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('check', 'linux'):
        item = sub.add_parser(command)
        item.add_argument('store', type=Path)
        item.add_argument('target_file', type=Path)
        item.add_argument('source')
        item.add_argument('manifest_sha')
        if command == 'linux':
            item.add_argument('node', type=Path)
            item.add_argument('outer_namespace')
            item.add_argument('outer_mount_namespace')
    args = parser.parse_args()
    if args.command == 'check':
        print(json.dumps(check(args.store, args.target_file, args.source, args.manifest_sha)))
    else:
        linux(args.store, args.target_file, args.source, args.manifest_sha,
              args.node, args.outer_namespace, args.outer_mount_namespace)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print app output, inherited values, URL bodies or arbitrary exception text.
        failure = dict(smokeFailed=True, errorType=type(error).__name__,
            reason=str(error) if isinstance(error, SmokeFailure) else 'Runner prerequisite or execution failed; no fallback',
            productionReady=False)
        if isinstance(error, StatusWaitFailure):
            failure.update(error.diagnostic)
        print(json.dumps(failure), file=sys.stderr)
        sys.exit(1)
