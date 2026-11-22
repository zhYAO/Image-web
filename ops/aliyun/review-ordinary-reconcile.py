"""Standalone Linux rehearsal of interrupted ordinary write admission."""
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('host_admission_fixture', HERE / 'review-schema3-admission.py')
host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host)
sys.path.insert(0, str(HERE / 'paired'))
from test_ordinary_reconcile import Fixture, RecoverySystem, atomic_json, initialize_site, run_worker


WRITE = '/fixture/write'
STATUS = '/fixture/status'
require = host.require


def process_identity(pid):
    fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    require(fields[0] != 'Z', 'Application is no longer live')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    return dict(pid=pid, startTicks=int(fields[19]), bootId=boot)


def serve(control, release, bound):
    writes = 0

    class Application(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body):
            payload = json.dumps(body).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == STATUS:
                gate = json.loads(control.read_bytes())
                mode = gate['mode']
                self.reply(200, dict(pid=os.getpid(), version=release, writes=writes,
                                    admissionMode=mode, admissionEpoch=gate['operationId'],
                                    maintenance=mode != 'open', activeHttpRequests=0,
                                    activeFrameworkWork=0, counters={}, drained=mode == 'draining'))
            elif self.path == '/api/health/ready':
                self.reply(200, dict(version=release))
            else:
                self.reply(404, {})

        def do_POST(self):
            nonlocal writes
            if self.path != WRITE:
                self.reply(404, {})
            elif json.loads(control.read_bytes())['mode'] != 'open':
                self.reply(503, dict(gate='application'))
            else:
                writes += 1
                self.reply(201, dict(pid=os.getpid(), version=release, writes=writes))

    with HTTPServer(('127.0.0.1', 0), Application) as server:
        bound.send(server.server_port)
        bound.close()
        server.serve_forever()


class LinuxSystem(RecoverySystem):
    def observe(self, release, operation=None, pid=None):
        port = self.read(self.root/'ports.json')['apps'][release]
        status = app_status(port)
        require(status['version'] == release and status['pid'] == pid
                and (operation is None or status['admissionEpoch'] == operation), 'Application identity or gate epoch differs')
        return status

    def process(self):
        selected = self.read(self.root/'process.json')
        if selected is None:
            return None
        observed = process_identity(selected['pid'])
        require(observed == selected, 'Selected process identity differs from Linux procfs')
        return observed

    def seal_probe(self):
        host.assert_denied(self.read(self.root/'ports.json')['nginx'], 'POST', WRITE)

    def crash(self, checkpoint):
        if checkpoint == self.fault == 'ingress_open':
            # Parent first proves a write traverses the open Nginx gate, then
            # kills this worker before SystemOps.open can return to the journal.
            atomic_json(self.root/'opened-window.json', {'pid': os.getpid()})
            signal.pause()
            raise ValueError('Interrupted opening checkpoint unexpectedly resumed')


def app_status(port):
    code, _, body = host.local_http(port, 'GET', STATUS)
    require(code == 200, 'Application status was unavailable')
    return json.loads(body)


def stop(proc):
    proc.join(timeout=0)
    if proc.is_alive():
        proc.kill()
        proc.join(timeout=5)
    require(proc.exitcode is not None, 'Fixture child did not exit')
    proc.close()


def app_start(context, children, root, release):
    with ExitStack() as pipe:
        read, write = context.Pipe(duplex=False)
        pipe.enter_context(read)
        pipe.enter_context(write)
        app = context.Process(target=serve, args=(root/'etc/backend-maintenance.json', release, write))
        app.start()
        children.callback(stop, app)
        write.close()
        require(read.poll(8), 'Application bind timed out')
        return app, read.recv()


def launch_worker(context, children, root, action, fault=''):
    proc = context.Process(target=run_worker, args=(root, action, fault), kwargs={'system_type': LinuxSystem})
    proc.start()
    children.callback(stop, proc)
    return proc


def wait_window(worker, marker):
    deadline = time.monotonic() + 12
    while worker.is_alive() and time.monotonic() < deadline:
        if marker.is_file():
            require(json.loads(marker.read_bytes()) == {'pid': worker.pid}, 'Unexpected publishing worker')
            return
        time.sleep(0.05)
    raise ValueError(f'Publish worker did not reach the open checkpoint (exit {worker.exitcode})')


def stop_nginx(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def pointers(root):
    return [(path.lstat().st_ino, os.readlink(path)) for path in (root/'backend', root/'frontend-current')]


def run(root, nginx):
    context = multiprocessing.get_context('fork')
    fixture = Fixture()
    old = fixture.a['oldPair']['backend']
    candidate = fixture.a['newPair']['backend']
    operation = fixture.a['operation']
    system = LinuxSystem(root, fixture)
    with ExitStack() as children:
        baseline, old_port = app_start(context, children, root, old)
        app, app_port = app_start(context, children, root, candidate)
        selected = process_identity(app.pid)
        initialize_site(root, fixture, system, process_identity(baseline.pid), selected)
        with socket.socket() as port:
            port.bind(('127.0.0.1', 0))
            nginx_port = port.getsockname()[1]
        atomic_json(root/'ports.json', dict(nginx=nginx_port, apps={old: old_port, candidate: app_port}))

        directory = root/'nginx'
        directory.mkdir()
        config = host.nginx_config(directory, system.paths.etc, nginx_port, app_port)
        args = [nginx, '-e', 'stderr', '-p', str(directory) + '/', '-c', str(config)]
        log = children.enter_context((directory/'process.log').open('w+b'))
        options = dict(cwd=root, env=dict(PATH='/usr/bin:/bin', HOME=str(root), TMPDIR=str(root), LC_ALL='C'),
                       stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        checked = subprocess.run([*args, '-t', '-q'], cwd=root, env=options['env'],
                                 stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=8)
        require(checked.returncode == 0, f'Nginx rejected the fixture configuration: {checked.stderr.strip()}')
        proxy = subprocess.Popen(args, **options)
        children.callback(stop_nginx, proxy)
        host.ready_after_bind(proxy, nginx_port, candidate)

        publish = launch_worker(context, children, root, 'publish', 'ingress_open')
        wait_window(publish, root/'opened-window.json')
        journal = system.c.Journal(root/'ordinary-operations'/operation, owner_uid=os.getuid())
        opening = journal.load()
        require(opening['phase'] == 'writes-may-open', 'Expected only a durable open intent')
        before = pointers(root)
        require([target for _, target in before] == [candidate, fixture.a['newPair']['frontend']],
                'Exact candidate pointers were not selected')
        code, _, body = host.local_http(nginx_port, 'POST', WRITE)
        accepted = json.loads(body)
        require(code == 201 and accepted == dict(pid=app.pid, version=candidate, writes=1),
                'Candidate did not accept a fixture write through Nginx')
        publish.kill()
        publish.join(timeout=5)
        require(publish.exitcode == -signal.SIGKILL and journal.load() == opening,
                'Publish worker was not killed before the opened record')

        recovery = launch_worker(context, children, root, 'reconcile')
        recovery.join(timeout=12)
        require(recovery.exitcode == 0, f'Recovery worker failed (exit {recovery.exitcode})')
        host.assert_denied(nginx_port, 'POST', WRITE)
        host.assert_denied(nginx_port, 'GET', '/api/health/ready')
        status = app_status(app_port)
        require(status['admissionMode'] == 'draining' and status['admissionEpoch'] == operation
                and status['drained'] is True and status['writes'] == 1, 'Application did not hold new writes closed')
        require(status['pid'] == app.pid and status['version'] == candidate and process_identity(app.pid) == selected
                and pointers(root) == before and journal.load() == opening, 'Recovery changed the candidate process, pointers or journal')
        print(json.dumps(dict(scope='ordinary-linux-loopback', openWriteStatus=201, heldWriteStatus=503,
                              applicationMode='draining', sameCandidatePointers=True, sameApplicationProcess=True,
                              phase='writes-may-open')))


def main():
    if sys.platform != 'linux' or os.geteuid() == 0:
        raise SystemExit('Run on Linux as an unprivileged user with Nginx already installed.')
    if len(sys.argv) != 1:
        raise SystemExit('This self-contained rehearsal takes no arguments.')
    nginx = shutil.which('nginx', path='/usr/sbin:/usr/bin:/usr/local/sbin:/usr/local/bin')
    if nginx is None:
        raise SystemExit('Nginx executable unavailable. This rehearsal did not run.')
    # Fixture children inherit no credentials, config paths or proxy settings.
    os.environ.clear()
    with tempfile.TemporaryDirectory(prefix='zimage-ordinary-nginx-', dir='/tmp') as work:
        run(Path(work), nginx)


if __name__ == '__main__':
    main()
