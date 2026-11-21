"""Hosted review-only check of the real schema3 preload, socket and Nginx gate."""
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
SPEC = importlib.util.spec_from_file_location('zimage_lifecycle_primitives', HERE / 'lifecycle-smoke.py')
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)
require = smoke.require
PORT = 8088
PHASE = 'isolation'


class CheckFailure(smoke.SmokeFailure):
    def __init__(self, reason, status=None):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def json_file(path, limit):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= limit, 'Bounded regular input required')
    return json.loads(path.read_bytes())


def local_http(port, method, path):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    try:
        connection.request(method, path, headers={'Host': 'diagnostic.invalid', 'Connection': 'close'})
        response = connection.getresponse()
        body = response.read(16385)
        require(len(body) <= 16384, 'Diagnostic response exceeded limit')
        return response.status, response.headers, body
    finally:
        connection.close()


def exact_peer_status(root, pid, mode):
    path = smoke.socket_path(root)
    info = path.lstat()
    require(stat.S_ISSOCK(info.st_mode) and info.st_uid == smoke.UID and stat.S_IMODE(info.st_mode) == 0o600,
            'Unexpected socket owner or permissions')
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(2)
        client.connect(str(path))
        peer = struct.unpack('3i', client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        require(peer[:2] == (pid, smoke.UID), 'Socket peer differs from exact running application')
        client.sendall(b'{"command":"status"}\n')
        with client.makefile('rb') as stream:
            data = stream.readline(16385)
        require(len(data) <= 16384 and data.endswith(b'\n'), 'Socket status truncated')
    value = json.loads(data)
    bridge = value['httpAdmission']
    require(value['schemaVersion'] == 1 and value['pid'] == pid and value['backendRelease'] == smoke.SOURCE
            and value['controlValid'] is True and value['maintenance'] is (mode != 'open')
            and value['admissionMode'] == mode and value['admissionEpoch'] == smoke.EPOCH
            and bridge['installed'] is True and bridge['controlValid'] is True
            and bridge['schemaVersion'] == 2 and bridge['protocolVersion'] == 1 and bridge['admissionMode'] == mode
            and bridge['admissionEpoch'] == smoke.EPOCH and bridge['wrappedServerCount'] >= 1
            and bridge['barrierId'] == 'node-http-create-server-v1', 'Runtime hook or operation identity mismatch')
    require(bridge['frameworkWork'] == dict(installed=True, **smoke.EXPECTED_FRAMEWORK,
            hook='response-cache-revalidate-v1', controlValid=True), 'Reviewed framework hook missing')
    names = {'activeMutations', 'activeStreams', 'activeRenders', 'activeExports', 'pendingFinalizers'}
    require(set(value['counters']) == names
            and all(type(count) is int and count == 0 for count in (*value['counters'].values(),
                    value['activeHttpRequests'], value['activeFrameworkWork'],
                    bridge['activeHttpRequests'], bridge['activeFrameworkWork']))
            and value['drained'] is (mode == 'draining'), 'Admission did not reach zero active work')


def assert_ready(port, version):
    code, headers, body = local_http(port, 'GET', '/api/health/ready')
    if code != 200:
        cause = {502: 'upstream-bad-gateway', 503: 'gate-or-upstream-unavailable',
                 504: 'upstream-timeout'}.get(code, 'unexpected-ready-status')
        raise CheckFailure(cause, code)
    try:
        payload = json.loads(body)
    except ValueError:
        raise CheckFailure('ready-json-invalid', code)
    if not isinstance(payload, dict) or payload.get('version') != version:
        raise CheckFailure('ready-version-mismatch', code)
    if 'no-store' not in headers.get('Cache-Control', ''):
        raise CheckFailure('ready-cache-header', code)


def assert_denied(port, method, path):
    code, headers, body = local_http(port, method, path)
    if code != 503 or headers.get('Retry-After') != '30':
        raise CheckFailure('missing-expected-denial', code)
    try:
        payload = json.loads(body)
    except ValueError:
        raise CheckFailure('denial-json-invalid', code)
    if not isinstance(payload, dict) or payload.get('code') != 'network':
        raise CheckFailure('denial-body-invalid', code)


def ready_after_bind(child, port, version):
    deadline = time.monotonic() + 8
    while child.poll() is None and time.monotonic() < deadline:
        try:
            return assert_ready(port, version)
        except (ConnectionRefusedError, ConnectionResetError):
            time.sleep(0.15)
    if child.poll() is not None:
        raise CheckFailure('listener-exited')
    raise CheckFailure('listener-bind-timeout')


def wait_child(child, callback):
    deadline = time.monotonic() + 35
    while child.poll() is None and time.monotonic() < deadline:
        try:
            return callback()
        except (OSError, ValueError, KeyError):
            time.sleep(0.2)
    raise smoke.SmokeFailure('Process or readiness deadline')


def marker(folder, name, attempt):
    destination = folder / name
    temporary = destination.with_suffix('.next')
    temporary.write_text(json.dumps(attempt))
    temporary.chmod(0o644)
    temporary.replace(destination)


def run(candidate, node, net, mount, sha, run_id, attempt, digest):
    global PHASE
    expected = smoke.identity(sha, int(run_id), int(attempt), digest)
    require(sys.platform == 'linux' and os.geteuid() == 0 and os.getpid() == 1, 'Isolated Linux supervisor required')
    require(set(os.environ) == {'PATH', 'LC_ALL'} and os.environ['PATH'] == '/usr/bin:/bin'
            and os.environ['LC_ALL'] == 'C.UTF-8', 'Unexpected supervisor environment')
    require(re.fullmatch(r'mnt:\[[0-9]+\]', mount) and os.readlink('/proc/self/ns/mnt') != mount,
            'Independent mount namespace required')
    subprocess.run(['/usr/bin/mount', '--make-rprivate', '/'], check=True, capture_output=True)
    routes = []
    for args in ([], ['-6']):
        routes += json.loads(subprocess.check_output(['/usr/sbin/ip', *args, '-j', 'route', 'show', 'table', 'all']))
    smoke.network_isolated(net, [name for _, name in socket.if_nameindex()], routes, os.readlink('/proc/self/ns/net'))
    subprocess.run(['/usr/sbin/ip', 'link', 'set', 'lo', 'up'], check=True, capture_output=True)

    os.umask(0o022)  # Private chroot parents must be traversable by the dropped UID.
    PHASE = 'artifact-and-runtime'
    candidate = Path(candidate).resolve(strict=True)
    node = Path(node).resolve(strict=True)
    release, report = candidate / 'app', candidate / 'assembly.json'
    manifest = release / '.three-layer-release.json'
    assembled = json_file(report, 262144)
    config = json_file(manifest, 500000)
    require(smoke.digest(candidate / 'packed/transport.tgz') == expected['transport_sha256']
            and smoke.digest(manifest) == assembled['manifestSha256'] and assembled['releaseId'] == sha
            and assembled['activated'] is False and assembled['productionReady'] is False
            and config['releaseId'] == sha and config['schema'] == 3
            and config['runtimeProfile'] == 'model-only-jsquash' and config['productionReady'] is False
            and config['runtime'] == smoke.RUNTIME, 'Exact nonpromotable schema3 release required')
    environment = assembled['environment']
    require(set(environment) == {'ZIMAGE_STATIC_ASSET_SHA256'} and
            environment['ZIMAGE_STATIC_ASSET_SHA256'] == config['assetsVersion']
            and re.fullmatch('[a-f0-9]{64}', config['assetsVersion']), 'Unexpected model-only resource environment')
    smoke.configure(expected, dict(protocolVersion=2, nextVersion='16.4.5', sourceProfile=smoke.REVIEWED_PROFILE))
    for name, checksum in smoke.COMPANION_HASHES.items():
        require(smoke.digest(HERE / 'backend' / name) == checksum, 'Reviewed preload companion changed')

    with tempfile.TemporaryDirectory(prefix='zimage-s3-') as work:
        work = Path(work)
        work.chmod(0o755)
        root = work / 'root'
        root.mkdir(0o755)
        installed = root / 'opt/zimage/releases' / sha
        installed.parent.mkdir(parents=True)
        shutil.copytree(release, installed, symlinks=True)
        smoke.trusted_copy(node, root / smoke.NODE.lstrip('/'))
        for dependency in set(re.findall(r'(?:=>\s*)?(/[^\s()]+)', subprocess.check_output(['/usr/bin/ldd', str(node)], text=True))):
            require(dependency.startswith(('/lib/', '/lib64/', '/usr/lib/')), 'Unexpected trusted Node library path')
            smoke.trusted_copy(Path(dependency).resolve(), root / dependency.lstrip('/'))
        for name in smoke.COMPANION_HASHES:
            destination = root / Path(smoke.PRELOAD).parent.relative_to('/') / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(HERE / 'backend' / name, destination)
            destination.chmod(0o444)
            require(smoke.digest(destination) == smoke.COMPANION_HASHES[name], 'Copied preload companion changed')
        etc = root / 'etc/zimage'
        etc.mkdir(parents=True)
        token = dict(schemaVersion=2, operationId=smoke.EPOCH)
        marker(etc, 'backend-maintenance.json', dict(token, mode='open'))
        marker(etc, 'ingress-open.json', token)
        for relative in ('run/zimage-lifecycle', 'tmp', smoke.ENTRY.lstrip('/') + '/.next/cache'):
            target = root / relative
            target.mkdir(mode=0o700, parents=True)
            os.chown(target, smoke.UID, smoke.UID)
        env = dict(PATH='/nonexistent', HOME='/tmp', TMPDIR='/tmp', NODE_ENV='production',
                   HOSTNAME='127.0.0.1', PORT='3100', ZIMAGE_LIFECYCLE_ENABLED='1',
                   ZIMAGE_BUILD_SHA=sha, NEXT_TELEMETRY_DISABLED='1',
                   NODE_OPTIONS='--max-old-space-size=640', **environment)
        PHASE = 'immutable-next-inspection'
        app = nginx = None
        log = work / 'private-process.log'
        with log.open('xb') as out:
            log.chmod(0o600)
            # Runner checkout is not root-owned. Audited companions are pinned
            # before copying and ownership is asserted inside the real preload.
            inspected = subprocess.run([smoke.NODE, smoke.PRELOAD, 'inspect', smoke.ENTRY + '/server.js'],
                executable=smoke.NODE, env=env, stdout=subprocess.PIPE, stderr=out,
                preexec_fn=lambda: smoke.child_setup(root), timeout=15)
            require(inspected.returncode == 0 and len(inspected.stdout) <= 32768, 'Actual Next inspection failed')
            smoke.validate_inspection(json.loads(inspected.stdout))
            try:
                PHASE = 'application-and-peer'
                app = subprocess.Popen([smoke.NODE, '--require', smoke.PRELOAD, 'server.js'],
                    executable=smoke.NODE, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                    preexec_fn=lambda: smoke.child_setup(root))
                wait_child(app, lambda: exact_peer_status(root, app.pid, 'open'))
                PHASE = 'direct-backend-ready'
                assert_ready(3100, sha)
                PHASE = 'nginx-config'
                fixture = work / 'nginx'
                fixture.mkdir(0o755)
                os.chown(fixture, smoke.UID, smoke.UID)
                shutil.copyfile(HERE / 'ingress-maintenance-maps.conf', fixture / 'maps.conf')
                rule = (HERE / 'ingress-maintenance-server.conf').read_text().replace('/etc/zimage/', str(etc) + '/')
                (fixture / 'rules.conf').write_text(rule)
                temp = '\n'.join(f'  {item}_temp_path {fixture}/{item};' for item in
                                ('client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'))
                (fixture / 'nginx.conf').write_text(
                    f'pid {fixture}/nginx.pid; daemon off; master_process off; error_log stderr; events {{}}\n'
                    f"http {{ log_format codes '$status $upstream_status'; access_log {fixture}/codes.log codes; "
                    f"include {fixture}/maps.conf;\n{temp}\n"
                    f'  server {{ listen 127.0.0.1:{PORT}; include {fixture}/rules.conf;\n'
                    '  location / { proxy_pass http://127.0.0.1:3100; proxy_http_version 1.1; '
                    'proxy_set_header Host 127.0.0.1:3100; proxy_set_header Connection close; '
                    'proxy_next_upstream off; } } }\n')
                args = ['/usr/sbin/nginx', '-p', str(fixture) + '/', '-c', str(fixture / 'nginx.conf')]
                child_options = dict(env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C.UTF-8'}, stdin=subprocess.DEVNULL,
                    stdout=out, stderr=out, user=smoke.UID, group=smoke.UID, extra_groups=[])
                if subprocess.run(['/usr/bin/test', '-r', str(etc / 'ingress-open.json')],
                                  timeout=3, **child_options).returncode:
                    raise CheckFailure('worker-cannot-read-marker')
                if subprocess.run([*args, '-t', '-q'], timeout=8, **child_options).returncode:
                    raise CheckFailure('nginx-config-rejected')
                PHASE = 'nginx-proxied-ready'
                nginx = subprocess.Popen(args, **child_options)
                try:
                    ready_after_bind(nginx, PORT, sha)
                except CheckFailure as error:
                    codes = fixture / 'codes.log'
                    if codes.is_file() and codes.stat().st_size < 65536:
                        rows = codes.read_text().splitlines()
                        if rows and re.fullmatch(r'[1-5][0-9]{2} (?:-|[1-5][0-9]{2})', rows[-1]):
                            error.hop = 'nginx' if rows[-1].endswith(' -') else 'upstream'
                    raise
                PHASE = 'drain'
                marker(etc, 'ingress-maintenance.json', token)
                (etc / 'ingress-open.json').unlink()
                marker(etc, 'backend-maintenance.json', dict(token, mode='draining'))
                assert_denied(PORT, 'GET', '/api/health/ready')
                wait_child(app, lambda: exact_peer_status(root, app.pid, 'draining'))
                PHASE = 'checking'
                marker(etc, 'backend-maintenance.json', dict(token, mode='checking'))
                marker(etc, 'ingress-checking.json', token)
                wait_child(app, lambda: smoke.private_status(root, app.pid, {}))
                assert_ready(PORT, sha)
                assert_denied(PORT, 'POST', '/api/health/ready')
                assert_denied(3100, 'GET', '/api/chat')
                PHASE = 'reopen'
                marker(etc, 'ingress-open.json', token)
                marker(etc, 'backend-maintenance.json', dict(token, mode='open'))
                (etc / 'ingress-checking.json').unlink()
                (etc / 'ingress-maintenance.json').unlink()
                exact_peer_status(root, app.pid, 'open')
                assert_ready(PORT, sha)
                print(json.dumps(dict(commit=sha, scope='schema3-linux-private-admission', productionReady=False,
                    network='loopback-only', nginxGate=True, actualPreload=True, samePrivatePeer=True,
                    zeroWorkDrain=True, checkingReadiness=True, reopened=True)))
            finally:
                for proc in (nginx, app):
                    if proc is not None and proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait()


if __name__ == '__main__':
    try:
        run(*sys.argv[1:])
    except Exception as err:
        # Never publish arbitrary filesystem paths, environment or process logs.
        failure = dict(admissionFixtureFailed=True, phase=PHASE, kind=type(err).__name__, productionReady=False)
        if isinstance(err, CheckFailure):
            failure['reason'] = err.reason
            if type(err.status) is int and 100 <= err.status <= 599:
                failure['status'] = err.status
            if getattr(err, 'hop', None) in ('nginx', 'upstream'):
                failure['hop'] = err.hop
        print(json.dumps(failure), file=sys.stderr)
        sys.exit(1)
