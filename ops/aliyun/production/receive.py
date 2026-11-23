"""Fixed root-owned OpenSSH forced command, invoked with isolated Python and no arguments."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import select
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

ROOT = Path('/opt/zimage')
ETC = Path('/etc/zimage')
TOOLS = Path(__file__).absolute().parent
BACKEND = TOOLS/'backend'
LAYERS = TOOLS/'layers'
PRELOAD = BACKEND/'http-admission.cjs'
JOURNAL = ROOT/'production-release.json'
MAX_PAIR = 2_600_000_000
REPO = 'zhYAO/Image-web'
WORKFLOW = REPO+'/.github/workflows/production.yml'


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require(condition, message):
    if not condition:
        raise ValueError(message)


def target_policy(management):
    review = management.bounded_json(ETC/'production-target.json')
    instance = Path('/var/lib/cloud/data/instance-id').read_text().strip()
    require(review['instanceId'] == instance and re.fullmatch(r'i-[a-zA-Z0-9]+', instance), 'Wrong ECS instance')
    return review


def read_exact(stream, dest, size, digest=None):
    with dest.open('xb') as out:
        while size:
            block = stream.read(min(size, 1024*1024))
            if not block:
                raise EOFError('Incomplete transport')
            out.write(block)
            if digest is not None:
                digest.update(block)
            size -= len(block)


def verify(archive, bundle, sha):
    subprocess.run(['/usr/bin/gh', 'attestation', 'verify', str(archive), '--repo', REPO,
                    '--signer-workflow', WORKFLOW, '--source-ref', 'refs/heads/main', '--source-digest', sha,
                    '--signer-digest', sha, '--deny-self-hosted-runners', '--bundle', str(bundle),
                    '--custom-trusted-root', str(ETC/'production-trusted-root.jsonl')],
                   stdout=sys.stderr, check=True, timeout=120)


def unpack(archive, dest):
    # Signature already verified. Never materialize tar permissions, links, devices or arbitrary paths.
    with tarfile.open(archive, 'r:') as tar:
        for index, item in enumerate(tar):
            path = PurePosixPath(item.name)
            require(index < 20010 and item.type in (tarfile.REGTYPE, tarfile.AREGTYPE)
                    and not path.is_absolute() and str(path) == item.name and '..' not in path.parts
                    and (item.name in ('backend.tgz', 'release.json') or path.parts[:1] == ('frontend',)),
                    'Unexpected pair member')
            limit = 2_000_000_000 if item.name == 'backend.tgz' else 64*1024*1024
            require(0 <= item.size <= limit, 'Pair member exceeds bounds')
            if item.name == 'release.json':
                require(item.size <= 4096, 'Oversized metadata')
            target = dest/path
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(item) as source:
                read_exact(source, target, item.size)
    return json.loads((dest/'release.json').read_text())


def receive_pair(stream, tmp, sha, proof_size, size):
    bundle, archive = tmp/'provenance.json', tmp/'pair.tar'
    read_exact(stream, bundle, proof_size)
    digest = hashlib.sha256()
    read_exact(stream, archive, size, digest)
    verify(archive, bundle, sha)
    meta = unpack(archive, tmp)
    meta['pairSha256'] = digest.hexdigest()
    archive.unlink()
    return meta


def public(phase, pair):
    print(json.dumps([phase, *pair]), flush=True)
    require(select.select([sys.stdin.buffer], [], [], 75)[0]
            and sys.stdin.buffer.readline(5) == b'yes\n', 'Independent public check unavailable or rejected')


def activate(ops, old, new, run):
    # The shared deploy.lock stays held until public acceptance or verified recovery.
    # A durable nonterminal record blocks the next invocation after process/host loss.
    def record(phase):
        ops.record(dict(phase=phase, old=list(old), new=list(new), run=run))
    record('switching')
    try:
        ops.switch(new)
        ops.check(new)
        ops.public('candidate', new)
        ops.open(new)
        ops.public('live', new)
        record('committed')
        return 0
    except Exception as error:
        print('Candidate failed:', error, file=sys.stderr)
    try:
        record('restoring')
        ops.restore(old)
        ops.check(old)
        ops.public('restoration', old)
        ops.open(old)
        ops.public('restored-live', old)
        record('restored')
        return 20
    except Exception as error:
        print('Recovery incomplete:', error, file=sys.stderr)
        try:
            ops.hold()
        finally:
            record('needs_attention')
        return 21


class Host:
    public = staticmethod(public)

    def __init__(self, bridge, legacy, adapter, management, engine, check, sha):
        self.bridge, self.adapter, self.checks = bridge, adapter, check
        self.stop_attempted = False
        self.booting = None
        self.http_get = legacy.get
        self.ingress_open = ETC/"ingress-open.json"
        self.saved_open = ETC/"production-saved-open.json"
        self.ops = management.SystemOps(adapter, legacy, preload=PRELOAD)
        self.management, self.engine = management, engine
        self.tx = engine.BackendTransaction(self.ops, management.CONTROL, JOURNAL)
        self.operation = 'release-'+sha
        self.front = ROOT/'frontend'

    def record(self, data):
        self.engine.atomic_json(JOURNAL, dict(data, pairSha256=self.pair_digest, oldMigrations=self.old_migrations, newMigrations=self.migrations))

    def current(self):
        backend = self.adapter.current_target().name
        link = self.front/'current'
        path = os.readlink(link)
        namespace = Path(path).name
        require(link.lstat().st_uid == 0 and self.checks.NAMESPACE.fullmatch(namespace)
                and path == 'releases/'+namespace, 'Unexpected frontend current')
        directory = self.front/path
        self.management.owned(directory, directory=True)
        version = self.management.bounded_json(directory/'version.json')
        require(version.get('frontendRelease') == namespace, 'Current frontend marker differs')
        return backend, namespace

    def preflight(self, sha, meta):
        require(meta['sha'] == sha and type(meta['run']) is int and meta['run'] > 0
                and re.fullmatch('[0-9a-f]{64}', meta['manifest']), 'Signed metadata mismatch')
        review = target_policy(self.management)
        self.review = review
        self.migrations = meta['migrations']
        require(re.fullmatch('[a-f0-9]{40}', self.migrations) and self.migrations in review['compatibleMigrationTrees'],
                'Database compatibility review required')
        old = self.current()
        require(old[0] != sha, 'Release is already selected')
        if os.path.lexists(JOURNAL):
            state = self.management.bounded_json(JOURNAL)
            require(state['phase'] in ('committed', 'restored'), 'Previous deployment is unresolved')
            run = state['run']
            require(type(run) is int and 0 < run < meta['run'], 'Invalid or superseded deployment run')
            require(re.fullmatch('[a-f0-9]{64}', state.get('pairSha256', '')), 'Missing verified pair digest')
            if state['phase'] == 'committed':
                expected_pair, self.old_migrations = state['new'], state['newMigrations']
            else:
                expected_pair, self.old_migrations = state['old'], state['oldMigrations']
            require(list(old) == expected_pair, 'Current pair differs from the previous deployment')
            require(re.fullmatch('[a-f0-9]{40}', self.old_migrations), 'Invalid predecessor migration tree')
        else:
            self.old_migrations = '04386967f003c2d6638558cd89fcdd722134e594'
            require(old == ('7a811b326aa4b344cee08bc5a33c04e44a780fd4', 'release-7a811b326aa4'),
                    'Unexpected initial production pair')
            manifest = self.management.bounded_json(self.front/'releases'/old[1]/'.release/manifest.json', 4*1024*1024)
            require(manifest['sourceSHA'] == old[0], 'Initial frontend source mismatch')
        self.check_database()
        self.pair_digest = meta['pairSha256']
        self.management.owned(self.ingress_open)
        self.open_inode = self.ingress_open.stat()
        require(not any(os.path.lexists(path) for path in (self.saved_open, ETC/'ingress-maintenance.json',
                ETC/'ingress-checking.json', ETC/'frontend-checking.json')), 'Existing ingress maintenance')
        for directory in (self.front/'assets', self.front/'releases'):
            self.management.owned(directory, directory=True)
        self.management.service_launch_preflight(PRELOAD)
        self.adapter.service_check()
        self.adapter.target_check()
        status = self.tx.observed(old[0])
        self.initial_pid = status['pid']
        self.process(old[0], self.initial_pid)
        require(status['admissionMode'] == 'open', 'Service is already in maintenance')
        self.checks.probe(*old, local=True)
        self.public('before', old)
        return old

    def check_database(self):
        review = self.management.bounded_json(ETC/'production-target.json')
        trees = review['compatibleMigrationTrees']
        require(isinstance(trees, list) and review == self.review and self.old_migrations in trees and self.migrations in trees,
                'Database compatibility review changed or excludes retained code')

    @staticmethod
    def process(sha, pid):
        proc = Path('/proc')/str(pid)
        require((proc/'exe').resolve(strict=True) == ROOT/'trusted-toolchain/node-v24.19.0-linux-x64/bin/node'
                and (proc/'cwd').resolve(strict=True) == ROOT/'releases'/sha/'apps/web',
                'Service PID does not run the selected release with dedicated Node')

    def prepare(self, tmp, new, meta):
        sha, namespace = new
        archive = tmp/'backend.tgz'
        self.adapter.prepare_archive(archive, sha, self.bridge.sha_file(archive), meta['manifest'], run_probe=False)
        front = tmp/'frontend'
        candidate = json.loads((front/'.release/candidate.json').read_text())
        require(candidate['sourceIdentity']['sourceSHA'] == sha and candidate['sourceIdentity']['dirty'] is False
                and candidate['allowedBackendReleases'] == [sha] and candidate['namespace'] == namespace
                and json.loads((front/'version.json').read_text()) == dict(schemaVersion=1, frontendRelease=namespace)
                and (front/'index.html').is_file() and (front/'app.html').is_file(), 'Static build mismatch')
        release = self.front/'releases'/namespace
        mapping = self.front/'assets'/namespace
        require(not os.path.lexists(release) and not os.path.lexists(mapping), 'Frontend namespace already retained')
        # Populate the independent framework inspection before disturbing the incumbent.
        self.ops.framework_contract(sha)
        front.rename(release)

    def close(self):
        self.tx.gate(self.operation, 'draining')

    def check_seal(self):
        require(not os.path.lexists(self.ingress_open) and os.path.samestat(self.saved_open.stat(), self.open_inode),
                'Unexpected Nginx admission marker')
        for path in ('/', '/api/health/ready'):
            status, body = self.http_get(self.checks.ORIGIN+path)
            require(status == 503 and json.loads(body).get('code') == 'network', 'Nginx has not sealed ingress')

    def seal(self):
        if not os.path.lexists(self.saved_open):
            require(os.path.samestat(self.ingress_open.stat(), self.open_inode), 'Nginx marker changed')
            self.ingress_open.rename(self.saved_open)
        self.check_seal()

    def unseal(self):
        if os.path.lexists(self.saved_open):
            require(not os.path.lexists(self.ingress_open) and os.path.samestat(self.saved_open.stat(), self.open_inode),
                    'Cannot restore Nginx marker')
            self.saved_open.rename(self.ingress_open)

    def hold(self):
        try:
            self.close()
        finally:
            self.seal()

    def await_boot(self, sha):
        deadline = time.monotonic()+45
        while True:
            try:
                state = self.tx.observed(sha, self.operation)
                self.process(sha, state['pid'])
                require(state['admissionMode'] == 'draining', 'Unexpected initial gate')
                return
            except (ValueError, RuntimeError, OSError, subprocess.SubprocessError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(1)

    def restore(self, pair):
        if self.stop_attempted:
            self.switch(pair)
        else:
            require(self.current() == pair, 'Incumbent changed before stop')
            self.tx.observed(pair[0], self.operation, self.initial_pid)
            self.tx.gate(self.operation, 'checking')
            self.unseal()

    def switch(self, pair):
        sha, namespace = pair
        current = self.adapter.current_target().name
        self.close()
        if not self.ops.service_stopped():
            pid = self.ops.service_pid()
            self.process(current, pid)
            if current == self.booting:
                # A newly launched, fenced process may never create its lifecycle socket.
                self.check_seal()
            else:
                self.tx.drain(current, self.operation, pid)
        self.seal()
        self.stop_attempted = True
        self.ops.stop()  # also cancels an outstanding systemd Restart=on-failure
        self.check_database()
        self.ops.native(sha)
        self.ops.select(sha, current)
        mapping = self.front/'assets'/namespace
        destination = '../releases/'+namespace
        if os.path.lexists(mapping):
            require(mapping.is_symlink() and os.readlink(mapping) == destination, 'Retained asset mapping differs')
        else:
            mapping.symlink_to(destination)
        link = self.front/'current.pending-release'
        link.symlink_to('releases/'+namespace)
        os.replace(link, self.front/'current')
        self.booting = sha
        self.ops.start()
        self.await_boot(sha)
        self.tx.gate(self.operation, 'checking')
        self.booting = None
        self.unseal()

    def check(self, pair):
        deadline = time.monotonic()+50
        while True:
            try:
                require(self.current() == pair, 'Selected pair differs')
                status = self.tx.observed(pair[0], self.operation)
                self.process(pair[0], status['pid'])
                self.checks.probe(*pair, local=True)
                return
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(1)

    def open(self, pair):
        self.check(pair)
        self.check_database()
        self.tx.gate(self.operation, 'open')
        require(self.tx.observed(pair[0])['admissionMode'] == 'open', 'Gate failed to open')
        self.checks.probe(*pair, local=True)


def check_installation():
    """Administrative read-only check. No receipt, cache assembly, lock, restart or release."""
    management = load(BACKEND/'release.py')
    bridge = management.load(LAYERS/'release-three-layer.py', 'production_layers')
    management.load(BACKEND/'transaction.py', 'production_lifecycle')
    bridge.load_tools(strict=True)
    require(callable(getattr(bridge.Adapter, 'prepare_archive', None)), 'Missing layered preparation helper')
    management.owned(Path('/usr/bin/gh'))
    help_text = subprocess.check_output(['/usr/bin/gh', 'attestation', 'verify', '--help'], text=True, timeout=10)
    for flag in ('--repo', '--signer-workflow', '--source-ref', '--source-digest', '--signer-digest',
                 '--deny-self-hosted-runners', '--bundle', '--custom-trusted-root'):
        require(re.search(r'(?<![\w-])'+flag+r'(?![\w-])', help_text), 'Installed gh lacks '+flag)
    trust = ETC/'production-trusted-root.jsonl'
    management.owned(trust)
    require(0 < trust.stat().st_size <= 1024*1024, 'Invalid trusted root size')
    roots = [json.loads(line) for line in trust.read_bytes().splitlines() if line.strip()]
    require(roots and all(isinstance(row, dict) and isinstance(row.get('certificateAuthorities'), list)
                          and row['certificateAuthorities'] for row in roots),
            'Missing Sigstore certificate authorities')
    target_policy(management)
    with bridge.safe_node_environment():
        bridge.enabled_target_check()
        bridge.service_preflight()
        management.service_launch_preflight(PRELOAD)
        ops = management.SystemOps(None, None, preload=PRELOAD)
        state = ops.status()  # Checks the live MainPID and Unix peer UID/PID.
        target = (ROOT/'current').resolve(strict=True)
        require(target.parent == ROOT/'releases' and re.fullmatch('[0-9a-f]{40}', target.name)
                and state.get('backendRelease') == target.name and state.get('admissionMode') == 'open'
                and state.get('controlValid') is True, 'Current release or admission status differs')
        Host.process(target.name, state['pid'])
        node = ROOT/'trusted-toolchain/node-v24.19.0-linux-x64/bin/node'
        inspection = json.loads(subprocess.check_output([str(node), str(PRELOAD), 'inspect',
                                                        str(target/'apps/web/server.js')], timeout=30))
        framework = state['httpAdmission']['frameworkWork']
        require(inspection['release'] == target.name and framework == dict(inspection['contract'], installed=True,
                hook='response-cache-revalidate-v1', controlValid=True), 'Live Next profile differs from installed release')


def main():
    require(os.geteuid() == 0 and sys.flags.isolated and len(sys.argv) == 1, 'Fixed isolated helper required')
    os.umask(0o022)
    management = load(BACKEND/'release.py')
    bridge = management.load(LAYERS/'release-three-layer.py', 'production_layers')
    engine = management.load(BACKEND/'transaction.py', 'production_lifecycle')
    checks = management.load(TOOLS/'check.py', 'production_https')
    management.owned(ETC/'production-trusted-root.jsonl')
    management.owned(ROOT, directory=True)
    target_policy(management)  # Reject a copied installation before accepting archive bytes.
    header = sys.stdin.buffer.readline(128)
    match = re.fullmatch(rb'([a-f0-9]{64}) ([a-f0-9]{40}) ([0-9]{1,7}) ([0-9]{1,10})\n', header)
    require(match, 'Invalid release header')
    require(match[1].decode() == TOOLS.name, 'Merged source requires a different receiver kit')
    sha = match[2].decode()
    proof_size, size = int(match[3]), int(match[4])
    require(0 < proof_size <= 1024*1024 and 0 < size <= MAX_PAIR, 'Transfer exceeds bound')
    with bridge.safe_node_environment(), tempfile.TemporaryDirectory(dir=ROOT) as name:
        layers, legacy = bridge.load_tools(strict=True)
        adapter = bridge.Adapter(ROOT, layers, legacy)
        with adapter.locked():
            tmp = Path(name)
            require(shutil.disk_usage(ROOT).free >= 2*size + proof_size + 64*1024*1024, 'Insufficient transfer space')
            signal.alarm(900)
            meta = receive_pair(sys.stdin.buffer, tmp, sha, proof_size, size)
            signal.alarm(0)
            host = Host(bridge, legacy, adapter, management, engine, checks, sha)
            old = host.preflight(sha, meta)
            new = (sha, 'release-'+sha)
            host.prepare(tmp, new, meta)
            return activate(host, old, new, meta['run'])


if __name__ == '__main__':
    sys.exit('Invoke the versioned kit.py entrypoint to verify the installed closure')
