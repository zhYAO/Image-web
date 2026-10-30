#!/usr/bin/python3 -I
"""Fixed root-only diagnostic observe/cancel/status entrypoint.

No service mutation, DB, network, application build or historical completion.
"""
import hashlib
import types
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

INSTALL = Path('/usr/local/libexec/zimage-observer')
SCRIPT = INSTALL / 'ingress-observe.py'
HELPERS = ('observer.py', 'ingress-observe.py')
MAX_PROC_ENTRIES = 32768
SNAPSHOT_SECONDS = 3
PATHS = {'policy': Path('/etc/zimage/observer-policy.json'),
         'receipt': Path('/etc/zimage/observer-loaded-receipt.json'),
         'open': Path('/etc/zimage/ingress-open.json'),
         'maintenance': Path('/etc/zimage/ingress-maintenance.json'),
         'checking': Path('/etc/zimage/ingress-checking.json'),
         'journal': Path('/opt/zimage/backend-operations/observer-current.json'),
         'lock': Path('/opt/zimage/deploy.lock')}


def reject(code):
    print(json.dumps({'schemaVersion': 1, 'code': code, 'needsAttention': True,
                      'admissionMayBeOpen': True, 'completionAuthorized': False}, sort_keys=True))
    return 1


def trusted_closure():
    if os.geteuid() != 0 or not sys.flags.isolated: return False
    if Path(__file__).absolute() != SCRIPT: return False
    try:
        for name in HELPERS:
            target = INSTALL / name
            for parent in target.parents:
                info = parent.lstat()
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: return False
            info = target.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_nlink != 1: return False
            if not 0 < info.st_size <= 65536: return False
        return True
    except OSError: return False


def trusted_read(path):
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: raise ValueError('SOURCE_TRUST')
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1 or
            before.st_mode & 0o022 or not 0 < before.st_size <= 65536): raise ValueError('SOURCE_TRUST')
    def stamp(info): return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if stamp(os.fstat(descriptor)) != stamp(before): raise ValueError('SOURCE_TRUST')
        chunks = []; size = 0
        while True:
            chunk = os.read(descriptor, min(8192, 65537 - size))
            if not chunk: break
            chunks.append(chunk); size += len(chunk)
            if size > 65536: raise ValueError('SOURCE_TRUST')
        if stamp(os.fstat(descriptor)) != stamp(before) or stamp(path.lstat()) != stamp(before): raise ValueError('SOURCE_TRUST')
        return b''.join(chunks)
    finally: os.close(descriptor)


def authenticated_source():
    # Bootstrap authenticates BOTH raw source files before executing library code.
    def pairs(items):
        value = {}
        for key, child in items:
            if key in value: raise ValueError('POLICY_JSON')
            value[key] = child
        return value
    def invalid(_): raise ValueError('POLICY_JSON')
    policy = json.loads(trusted_read(PATHS['policy']).decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)
    helpers = policy.get('helperFiles') if type(policy) is dict else None
    if type(helpers) is not list or len(helpers) != len(HELPERS): raise ValueError('SOURCE_BINDING')
    sources = {}
    for entry, name in zip(helpers, HELPERS):
        if type(entry) is not dict or set(entry) != {'name', 'sha256'} or entry['name'] != name: raise ValueError('SOURCE_BINDING')
        sources[name] = trusted_read(INSTALL / name)
        if hashlib.sha256(sources[name]).hexdigest() != entry['sha256']: raise ValueError('SOURCE_BINDING')
    return sources['observer.py']


def load_library():
    source = authenticated_source()
    value = types.ModuleType('zimage_observer_fixed')
    value.__file__ = str(INSTALL / 'observer.py')
    exec(compile(source, value.__file__, 'exec', dont_inherit=True), value.__dict__)
    return value


class ReadOnlyRuntime:
    """Only fixed systemctl show, process stat/boot and trusted config reads."""
    def __init__(self, module, fs): self.module = module; self.fs = fs; self.snapshot_deadline = None
    def wall(self): return time.time()
    def monotonic(self): return time.monotonic()
    def wait(self, seconds): time.sleep(seconds)
    def check_progress(self):
        if self.snapshot_deadline is None: return 3
        remaining = self.snapshot_deadline - self.monotonic()
        self.module.require(remaining > 0, 'PROCESS_BUDGET')
        return min(3, remaining)
    def read_proc(self, path):
        self.check_progress()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            body = os.read(descriptor, 8193)
            self.module.require(len(body) <= 8192, 'PROCESS_UNCERTAIN')
            return body.decode('utf-8', errors='replace').strip()
        finally: os.close(descriptor)
    def service(self, service):
        self.module.require(service in ('zimage.service', 'nginx.service'), 'SERVICE_UNCERTAIN')
        timeout = self.check_progress()
        try:
            result = subprocess.run(['/usr/bin/systemctl', 'show', service, '--property=MainPID,ActiveState,SubState'],
                                    check=True, capture_output=True, text=True, timeout=timeout,
                                    env={'LANG': 'C', 'LC_ALL': 'C'})
            self.module.require(len(result.stdout) <= 4096, 'SERVICE_UNCERTAIN')
            lines = result.stdout.splitlines(); fields = dict(line.split('=', 1) for line in lines)
            self.module.require(len(lines) == 3 and set(fields) == {'MainPID', 'ActiveState', 'SubState'} and
                                fields['ActiveState'] == 'active' and fields['SubState'] == 'running' and
                                fields['MainPID'].isascii() and fields['MainPID'].isdigit(), 'SERVICE_UNCERTAIN')
            pid = int(fields['MainPID']); self.module.require(0 < pid < 2147483648, 'SERVICE_UNCERTAIN')
            return pid
        except (subprocess.SubprocessError, OSError, ValueError, UnicodeError):
            raise self.module.ObserverError('SERVICE_UNCERTAIN') from None
    def process(self, pid, boot):
        body = self.read_proc('/proc/' + str(pid) + '/stat')
        start = body.find('('); end = body.rfind(')'); tail = body[end + 2:].split()
        self.module.require(start > 0 and end > start and body[:start].strip() == str(pid) and
                            len(tail) >= 20 and tail[1].isdigit() and tail[19].isdigit(), 'PROCESS_UNCERTAIN')
        value = {'pid': pid, 'startTicks': int(tail[19]), 'bootId': boot}
        self.module.identity(value, 'PROCESS_UNCERTAIN')
        return value, body[start + 1:end], int(tail[1])
    def generation(self, master, boot):
        value, name, _ = self.process(master, boot)
        self.module.require(name == 'nginx', 'PROCESS_UNCERTAIN')
        workers = []
        with os.scandir('/proc') as entries:
            for count, entry in enumerate(entries, 1):
                self.check_progress(); self.module.require(count <= MAX_PROC_ENTRIES, 'PROCESS_LIMIT')
                child = entry.name
                if not child.isascii() or not child.isdigit(): continue
                try: process, name, parent = self.process(int(child), boot)
                except FileNotFoundError: continue
                if parent == master:
                    self.module.require(name == 'nginx', 'PROCESS_UNCERTAIN'); workers.append(process)
        workers.sort(key=lambda item: item['pid'])
        self.module.require(bool(workers), 'PROCESS_UNCERTAIN')
        return value, workers
    def once(self, policy):
        boot = self.read_proc('/proc/sys/kernel/random/boot_id')
        app = self.process(self.service('zimage.service'), boot)[0]
        master, workers = self.generation(self.service('nginx.service'), boot)
        current = Path('/opt/zimage/current'); self.fs.ancestors(current)
        info = current.lstat()
        self.module.require(stat.S_ISLNK(info.st_mode) and info.st_uid == 0, 'CURRENT_UNCERTAIN')
        target = os.readlink(current)
        bodies = {}
        for entry in policy['configFiles']:
            self.check_progress(); bodies[entry['path']] = self.fs.read(Path(entry['path']))
        self.module.validate_config_closure(bodies)
        configs = [{'path': entry['path'], 'sha256': hashlib.sha256(bodies[entry['path']]).hexdigest()}
                   for entry in policy['configFiles']]
        helpers = [{'name': name, 'sha256': hashlib.sha256(self.fs.read(INSTALL / name)).hexdigest()} for name in HELPERS]
        return {'release': target.removeprefix('/opt/zimage/releases/'), 'currentTarget': target,
                'process': app, 'nginxMaster': master, 'nginxWorkers': workers, 'configFiles': configs, 'helperFiles': helpers}
    def snapshot(self, policy):
        self.snapshot_deadline = self.monotonic() + SNAPSHOT_SECONDS
        try:
            before = self.once(policy); self.check_progress()
            after = self.once(policy); self.check_progress()
            self.module.require(before == after, 'CONTROL_DRIFT')
            return after
        finally: self.snapshot_deadline = None


def main():
    if not trusted_closure(): return reject('ROOT_ISOLATED_CLOSURE_REQUIRED')
    arguments = sys.argv[1:]
    if arguments in (['cancel'], ['status']): action = arguments[0]; seconds = None
    elif (len(arguments) == 2 and arguments[0] == 'observe' and arguments[1].isascii() and
          arguments[1].isdigit() and len(arguments[1]) <= 3 and 1 <= int(arguments[1]) <= 300):
        action = 'observe'; seconds = int(arguments[1])
    else: return reject('CLI_USAGE')
    try:
        module = load_library(); fs = module.ProtectedFS()
        observer = module.Observer(fs, PATHS, ReadOnlyRuntime(module, fs))
        if action == 'observe':
            for name in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM): signal.signal(name, observer.request_cancel)
            result = observer.observe(seconds)
        elif action == 'cancel': result = observer.cancel()
        else: result = observer.status()
        print(json.dumps(result, sort_keys=True))
        return 1 if result['needsAttention'] else 0
    except Exception:
        return reject('CLI_UNCERTAIN')  # Never echo arbitrary exceptions or command output.


if __name__ == '__main__': raise SystemExit(main())
