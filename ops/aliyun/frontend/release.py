#!/usr/bin/python3 -I
"""Fixed-root frontend helper. Install/production execution requires separate review.

CLI accepts identifiers and trusted digests only, never paths, commands or URLs.
Publisher dependency injection is solely for offline, unprivileged fixtures.
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

# Validate every dependency before a privileged dynamic import. Checking after
# exec_module would execute an attacker-controlled sibling before rejection.
if os.geteuid() == 0:
    _tool_parent = Path(__file__).absolute().parent
    for _path in [*reversed(_tool_parent.parents), _tool_parent, *(_tool_parent / name for name in ['release.py', 'manifest.py', 'transport.py'])]:
        _info = _path.lstat()
        _is_tool = _path.name in {'release.py', 'manifest.py', 'transport.py'} and _path.parent == _tool_parent
        if _info.st_uid != 0 or _info.st_mode & 0o022 or not (stat.S_ISREG(_info.st_mode) and _info.st_nlink == 1 if _is_tool else stat.S_ISDIR(_info.st_mode)):
            raise ValueError('Untrusted privileged frontend tool')

_spec = importlib.util.spec_from_file_location('frontend_manifest', Path(__file__).with_name('manifest.py'))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)
_transport_spec = importlib.util.spec_from_file_location('frontend_release_transport', Path(__file__).with_name('transport.py'))
transport = importlib.util.module_from_spec(_transport_spec)
_transport_spec.loader.exec_module(transport)

ROOT = Path('/opt/zimage')
ORIGIN = 'https://www.zimage.store'
CONFIG = Path('/etc/zimage/frontend-release.json')
TERMINAL = {'committed', 'recovered', 'needs_attention'}


def owned(path, uid=0, directory=False):
    info = Path(path).lstat()
    if info.st_uid != uid or info.st_mode & 0o022 or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or (not directory and info.st_nlink != 1):
        raise ValueError('Untrusted managed path')
    return info


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


class Publisher:
    def __init__(self, root, owner_uid=0, probe=None, meta=None, approval=None, reserve_bytes=64 * 1024 * 1024):
        self.root = m.safe_directory(root)
        self.uid, self.probe, self.meta = owner_uid, probe, meta
        self.approval = approval
        owned(self.root, self.uid, directory=True)
        self.base = self.root / 'frontend'
        for name in ['', 'releases', 'assets', 'objects', '.stage', 'journal']:
            path = self.base / name
            if not path.exists(): path.mkdir(mode=0o700 if name in {'.stage', 'journal'} else 0o755)
            self.managed(path, directory=True)
        self.reserve_bytes = reserve_bytes
        self.free_bytes = lambda: shutil.disk_usage(self.base).free
        self.after_incoming_open = lambda: None
        self.checkpoint = lambda phase: None

    def managed(self, path, directory=False):
        path = Path(path)
        if self.root not in path.parents and path != self.root: raise ValueError('Managed path escapes root')
        for parent in reversed(path.parents):
            if parent == self.root or self.root in parent.parents:
                owned(parent, self.uid, directory=True)
        return owned(path, self.uid, directory)

    @contextmanager
    def locked(self):
        path = self.root / 'deploy.lock'  # same lock as existing backend helpers
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        with os.fdopen(fd, 'a') as lock:
            self.managed(path)
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def pointer(self, name):
        if name not in {'current', 'previous'}: raise ValueError('Invalid pointer name')
        path = self.base / name
        if not os.path.lexists(path): return None
        info = path.lstat()
        if not stat.S_ISLNK(info.st_mode) or info.st_uid != self.uid: raise ValueError('Untrusted frontend pointer')
        target = os.readlink(path)
        parts = target.split('/')
        if len(parts) != 2 or parts[0] != 'releases': raise ValueError('Invalid exact frontend pointer')
        namespace = m.identifier(parts[1])
        self.managed(self.base / target, directory=True)
        return namespace

    def current(self):
        return self.pointer('current')

    def atomic_pointer(self, name, namespace):
        if name not in {'current', 'previous'}: raise ValueError('Invalid pointer name')
        if namespace is None:
            (self.base / name).unlink(missing_ok=True)
        else:
            m.identifier(namespace)
            self.sealed(namespace)
            temporary = self.base / ('.' + name + '-' + secrets.token_hex(12))
            try:
                os.symlink('releases/' + namespace, temporary)
                os.replace(temporary, self.base / name)
            finally: temporary.unlink(missing_ok=True)
        sync_directory(self.base)

    def json_write(self, path, value):
        self.managed(path.parent, directory=True)
        temporary = path.parent / ('.write-' + secrets.token_hex(12))
        try:
            with temporary.open('xb') as out:
                os.chmod(temporary, 0o600)
                out.write(m.canonical(value))
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, path)
            sync_directory(path.parent)
        finally: temporary.unlink(missing_ok=True)

    def read_json(self, path):
        self.managed(path)
        return m.parse(m.read_regular(path, m.MAX_JSON))

    def persist(self, record, state):
        record.update(state=state, updatedAt=int(time.time()), actualCurrent=self.current())
        self.json_write(self.base / 'journal' / (record['operationId'] + '.json'), record)

    def start(self, operation, request, expected):
        m.identifier(operation)
        if expected is not None: m.identifier(expected)
        path = self.base / 'journal' / (operation + '.json')
        if os.path.lexists(path):
            record = self.read_json(path)
            if record.get('request') != request or record.get('oldFrontend') != expected:
                raise ValueError('Operation ID already bound to different request')
            if record['state'] not in TERMINAL and self.read_json(self.base / 'sequence.json')['sequence'] != record['sequence']:
                # Namespace equality is insufficient after B -> C -> B (ABA).
                # A stale transaction cannot restore over a later generation.
                self.persist(record, 'needs_attention')
            return record
        if self.current() != expected: raise ValueError('Expected current differs from exact current')
        seq_path = self.base / 'sequence.json'
        sequence = self.read_json(seq_path)['sequence'] + 1 if seq_path.exists() else 1
        self.json_write(seq_path, {'sequence': sequence})
        record = {'schemaVersion': 1, 'operationId': operation, 'sequence': sequence, 'request': request,
                  'oldFrontend': expected, 'newFrontend': request['namespace'], 'rollbackTarget': expected,
                  'success': False, 'recoveryAttempted': False, 'createdAt': int(time.time())}
        self.persist(record, 'preparing')
        return record

    def copy_incoming(self, operation, archive_sha, destination):
        m.identifier(operation)
        m.checksum(archive_sha)
        # The uploader controls incoming, so anchor every lookup with directory
        # FDs. It cannot redirect root's private destination or the opened inode.
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            incoming_fd = os.open('incoming', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
            try:
                fd = os.open('frontend-' + operation + '.tgz', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=incoming_fd)
            finally: os.close(incoming_fd)
        finally: os.close(root_fd)
        with os.fdopen(fd, 'rb') as source, destination.open('xb') as out:
            os.chmod(destination, 0o600)
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= m.MAX_ARCHIVE:
                raise ValueError('Incoming must be bounded single-link regular file')
            if self.free_bytes() < before.st_size + m.MAX_BYTES * 2 + self.reserve_bytes:
                raise ValueError('Insufficient disk space for bounded extraction')
            self.after_incoming_open()
            total, digest = 0, hashlib.sha256()
            for block in iter(lambda: source.read(1024 * 1024), b''):
                total += len(block)
                if total > before.st_size: raise ValueError('Incoming grew during copy')
                digest.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
            if total != before.st_size or m.signature(before) != m.signature(os.fstat(source.fileno())) or digest.hexdigest() != archive_sha:
                raise ValueError('Incoming changed or archive checksum mismatch')

    def sealed(self, namespace, manifest_sha=None):
        m.identifier(namespace)
        path = self.base / 'releases' / namespace
        self.managed(path, directory=True)
        for root, dirs, files in os.walk(path):
            self.managed(Path(root), directory=True)
            if Path(root).lstat().st_mode & 0o222: raise ValueError('Sealed directory is mutable')
            for name in dirs:
                self.managed(Path(root) / name, directory=True)
            for name in files:
                info = self.managed(Path(root) / name)
                if info.st_mode & 0o222: raise ValueError('Sealed file is mutable')
        manifest = m.verify(path, manifest_sha)
        if manifest['assetNamespace'] != namespace: raise ValueError('Sealed namespace mismatch')
        return manifest

    def freeze(self, path):
        for root, dirs, files in os.walk(path, topdown=False):
            for name in files:
                target = Path(root) / name
                self.managed(target)
                os.chmod(target, 0o444)
            # macOS requires source-directory write permission for rename;
            # keep its private top directory owner-only until the rename.
            os.chmod(root, 0o700 if Path(root) == path else 0o555)
            sync_directory(root)

    def asset_mapping(self, namespace):
        target = self.base / 'assets' / namespace
        expected = '../releases/' + namespace
        if os.path.lexists(target):
            if not target.is_symlink() or target.lstat().st_uid != self.uid or os.readlink(target) != expected:
                raise ValueError('Immutable asset namespace mapping conflict')
        else:
            os.symlink(expected, target)
            sync_directory(target.parent)

    def cached_object(self, item):
        m.checksum(item['sha256'])
        path = self.base / 'objects' / item['sha256']
        try:
            info = self.managed(path)
            if info.st_mode & 0o222 or m.hash_regular(path) != (item['bytes'], item['sha256']):
                raise ValueError('Corrupted trusted object')
        except (OSError, ValueError) as exc:
            raise ValueError('Missing or invalid sealed object') from exc
        return path

    def inventory(self, request):
        transport.validate_request(request)
        with self.locked():
            found = []
            for item in request['objects']:
                try: self.cached_object(item)
                except ValueError: continue
                found.append(item)
            return dict(request, found=found)

    def cache_sealed_objects(self, namespace):
        root = self.base / 'releases' / namespace
        index = m.parse(m.read_regular(root / '.release/file-index.json', m.MAX_JSON))
        for entry in index['files']:
            item = {'sha256': entry['sha256'], 'bytes': entry['bytes']}
            target = self.base / 'objects' / item['sha256']
            if os.path.lexists(target):
                # A damaged cache is a miss. Keep it untouched for inspection;
                # the independently verified release remains publishable using
                # the valid uploaded bytes, never the damaged shared object.
                try: self.cached_object(item)
                except ValueError: pass
                continue
            temporary = self.base / 'objects' / ('.object-' + secrets.token_hex(12))
            try:
                transport.copy_object(root / entry['path'], temporary, item)
                os.chmod(temporary, 0o444)
                os.rename(temporary, target)
                sync_directory(target.parent)
            finally: temporary.unlink(missing_ok=True)

    def seal(self, operation, namespace, archive_sha, manifest_sha):
        path = self.base / 'releases' / namespace
        if os.path.lexists(path):
            try: value = self.sealed(namespace, manifest_sha)
            except ValueError as exc: raise ValueError('Immutable namespace already sealed with different bytes') from exc
            self.cache_sealed_objects(namespace)
            return value
        stage = Path(tempfile.mkdtemp(prefix=operation + '-', dir=self.base / '.stage'))
        try:
            archive = stage / 'input.tgz'
            self.copy_incoming(operation, archive_sha, archive)
            value = transport.assemble(archive, stage / 'dist', manifest_sha, self.cached_object)
            if value['assetNamespace'] != namespace: raise ValueError('Uploaded namespace differs from request')
            # No uploader path is read after this point. All validation is over
            # root-private copied bytes, never a checked-but-writable incoming.
            self.freeze(stage / 'dist')
            os.rename(stage / 'dist', path)
            os.chmod(path, 0o555)
            sync_directory(path)
            sync_directory(path.parent)
            self.cache_sealed_objects(namespace)
            self.checkpoint('sealed')
            return self.sealed(namespace, manifest_sha)
        finally:
            shutil.rmtree(stage)

    def checked_meta(self, value):
        if self.meta is None: raise ValueError('Missing trusted meta reader')
        manifest_sha = m.digest(m.read_regular(self.base / 'releases' / value['assetNamespace'] / '.release/manifest.json', m.MAX_JSON))
        if self.approval is None or self.approval(value, manifest_sha) is not True:
            raise ValueError('Missing trusted acceptance approval')
        meta = self.meta()
        backend = m.compatibility(value, meta)
        return backend

    def check(self, namespace, backend):
        if self.probe is None: raise ValueError('Missing independent HTTP acceptance probe')
        try: return self.probe(namespace, backend) is True
        except Exception: return False

    def activate(self, record, value):
        namespace, old = record['newFrontend'], record['oldFrontend']
        backend = self.checked_meta(value)
        if record['state'] in {'switching', 'checking', 'recovering'} and record.get('backendRelease') != backend:
            self.persist(record, 'needs_attention')
            return record
        record['backendRelease'] = backend
        if record['state'] == 'recovering': return self.recover(record)
        if record['state'] not in {'switching', 'checking'}:
            if self.current() != old: raise ValueError('Expected current changed before activation')
            if old is not None: self.checked_meta(self.sealed(old))
            if not self.check(old, backend): raise ValueError('Independent HTTP baseline failed')
            self.persist(record, 'verified')
            # This namespace is itself public same-origin content. Do not map
            # it merely because uploaded bytes passed integrity validation:
            # root approval, compatibility and baseline must authorize first.
            self.checkpoint('before_mapping')
            self.asset_mapping(namespace)
            self.persist(record, 'switching')
            self.checkpoint('before_switch')
        else:
            # Resuming a sealed transaction also passed fresh approval/meta
            # above; a private retained directory never implies publication.
            self.checkpoint('before_mapping')
            self.asset_mapping(namespace)
        actual = self.current()
        if actual == old:
            self.atomic_pointer('current', namespace)
        elif actual != namespace:
            self.persist(record, 'needs_attention')
            return record
        self.persist(record, 'checking')
        self.checkpoint('after_switch')
        try:
            valid = self.checked_meta(value) == backend and self.check(namespace, backend)
        except Exception:
            valid = False
        if valid and self.current() == namespace:
            self.atomic_pointer('previous', old)
            record['success'] = True
            self.persist(record, 'committed')
            return record
        return self.recover(record)

    def recover(self, record):
        old, new = record['oldFrontend'], record['newFrontend']
        if record.get('recoveryAttempted'):
            # A crash may occur after restore rename but before its journal
            # write. Observe actual current; never attempt another restore.
            if self.current() == old and self.check(old, record['backendRelease']):
                self.persist(record, 'recovered')
            else: self.persist(record, 'needs_attention')
            return record
        if self.current() != new:
            self.persist(record, 'needs_attention')
            return record
        record['recoveryAttempted'] = True
        self.persist(record, 'recovering')
        try:
            if old is not None:
                if self.checked_meta(self.sealed(old)) != record['backendRelease']:
                    raise ValueError('Backend changed before recovery')
            self.atomic_pointer('current', old)
            if not self.check(old, record['backendRelease']): raise ValueError('Recovery check failed')
        except Exception:
            self.persist(record, 'needs_attention')
            return record
        self.persist(record, 'recovered')
        return record

    def deploy(self, operation, namespace, archive_sha, manifest_sha, expected_current):
        m.identifier(namespace)
        if namespace == 'none': raise ValueError('Reserved empty-current namespace')
        m.checksum(archive_sha)
        m.checksum(manifest_sha)
        with self.locked():
            record = self.start(operation, {'kind': 'deploy', 'namespace': namespace, 'archiveSha256': archive_sha, 'manifestSha256': manifest_sha}, expected_current)
            if record['state'] in TERMINAL: return record
            value = self.seal(operation, namespace, archive_sha, manifest_sha)
            record.update(artifactId=value['artifactId'], sourceSHA=value['sourceSHA'], publicConfigFingerprint=value['build']['publicConfigFingerprint'])
            return self.activate(record, value)

    def rollback(self, operation, expected_current, target):
        m.identifier(target)
        if target == 'none': raise ValueError('Reserved empty-current namespace')
        with self.locked():
            record = self.start(operation, {'kind': 'rollback', 'namespace': target}, expected_current)
            if record['state'] in TERMINAL: return record
            return self.activate(record, self.sealed(target))

    def status(self):
        with self.locked():
            current = self.current()
            value = self.sealed(current) if current else None
            backend = self.checked_meta(value) if value else None
            return {'schemaVersion': 1, 'current': current, 'previous': self.pointer('previous'),
                    'artifactId': value['artifactId'] if value else None, 'backendRelease': backend,
                    'httpVerified': self.check(current, backend) if backend else False,
                    'operations': sorted(x.stem for x in (self.base / 'journal').glob('*.json'))}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Probe redirect rejected')


class LocalIngressHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        # Verify this host's ingress without relying on public-IP hairpin routing.
        # The real public hostname remains the TLS SNI and certificate identity.
        sock = socket.create_connection(('127.0.0.1', 443), self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname='www.zimage.store')
        except BaseException:
            sock.close()
            raise


class LocalIngressHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, request):
        origin = urllib.parse.urlsplit(request.full_url)
        if (origin.scheme != 'https' or origin.hostname != 'www.zimage.store'
                or origin.port not in (None, 443) or origin.username is not None or origin.password is not None):
            raise ValueError('Probe origin rejected')
        return self.do_open(LocalIngressHTTPSConnection, request, context=self._context)


def http_read(url, limit=1024 * 1024, method='GET'):
    request = urllib.request.Request(url, headers={'User-Agent': 'ZImageFrontendRelease/1', 'Cache-Control': 'no-cache'}, method=method)
    # Ignore proxy environment inherited from sudo/deploy. TLS verification
    # remains on, and redirects cannot silently change the trusted origin.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                       LocalIngressHTTPSHandler(context=ssl.create_default_context()))
    with opener.open(request, timeout=15) as response:
        body = response.read(limit + 1)
        if response.status != 200 or len(body) > limit: raise ValueError('HTTP acceptance bound/status failed')
        return body, response.headers


def production_meta():
    body, headers = http_read('http://127.0.0.1:3100/api/meta', m.MAX_JSON)
    if headers.get_content_type() != 'application/json': raise ValueError('API meta MIME rejected')
    meta = m.validate_api_meta(m.parse(body))
    config_body, config_headers = http_read('http://127.0.0.1:3100/api/public-config', m.MAX_JSON)
    if config_headers.get_content_type() != 'application/json': raise ValueError('Public config MIME rejected')
    m.require_static_rollout_config(m.parse(config_body))
    return meta


def production_approval(manifest, manifest_sha):
    path = Path('/etc/zimage/frontend-acceptances') / (manifest['artifactId'] + '.json')
    for directory in [*reversed(path.parent.parents), path.parent]: owned(directory, directory=True)
    owned(path)
    approval = m.parse(m.read_regular(path, m.MAX_JSON))
    m.keys(approval, ['schemaVersion', 'artifactId', 'manifestSha256', 'payloadIndexSha256', 'publicConfigFingerprint', 'candidateSha256', 'backendReleases'])
    subject = {'schemaVersion': 1, 'artifactId': manifest['artifactId'], 'manifestSha256': manifest_sha,
               'payloadIndexSha256': manifest['fileIndex']['sha256'], 'publicConfigFingerprint': manifest['build']['publicConfigFingerprint']}
    if any(approval[k] != v for k, v in subject.items()): return False
    m.checksum(approval['candidateSha256'])
    evidence_subject = {k: approval[k] for k in ['schemaVersion', 'candidateSha256', 'payloadIndexSha256', 'publicConfigFingerprint']}
    evidence = dict(evidence_subject, backendReleases=approval['backendReleases'])
    m.acceptance_evidence(evidence, evidence_subject, manifest['verifiedBackendReleases'])
    return True


def production_probe(namespace, backend):
    public_meta, headers = http_read(ORIGIN + '/api/meta')
    value = m.parse(public_meta)
    m.validate_api_meta(value)
    if headers.get_content_type() != 'application/json' or value.get('backendRelease') != backend:
        return False
    html, headers = http_read(ORIGIN + '/')
    if headers.get_content_type() != 'text/html' or 'no-store' not in headers.get('Cache-Control', '').lower() or not html:
        return False
    if namespace is not None:
        body, headers = http_read(ORIGIN + '/version.json')
        if m.parse(body) != {'schemaVersion': 1, 'frontendRelease': namespace} or headers.get_content_type() != 'application/json' or 'no-store' not in headers.get('Cache-Control', '').lower(): return False
        manifest = m.verify(ROOT / 'frontend/releases' / namespace)
        files = m.parse(m.read_regular(ROOT / 'frontend/releases' / namespace / '.release/file-index.json'))['files']
        for extension, types in [('.js', {'text/javascript', 'application/javascript'}), ('.css', {'text/css'})]:
            selected = next((x for x in files if x['path'].endswith(extension)), None)
            if selected:
                data, resource_headers = http_read(ORIGIN + '/frontend-assets/' + namespace + '/' + selected['path'], m.MAX_FILE)
                if m.digest(data) != selected['sha256'] or resource_headers.get_content_type() not in types or 'immutable' not in resource_headers.get('Cache-Control', ''): return False
        try:
            http_read(ORIGIN + '/frontend-assets/' + namespace + '/assets/missing-' + secrets.token_hex(12) + '.js')
            return False
        except urllib.error.HTTPError as error:
            if error.code != 404 or 'immutable' in error.headers.get('Cache-Control', ''): return False
    return True


def production_bootstrap_probe(namespace, backend):
    if namespace is not None: return production_probe(namespace, backend)
    # Dedicated first-window caller proves current=None and sealed API writes.
    # No F0 homepage exists after installing the reviewed split ingress.
    body, headers = http_read(ORIGIN + '/api/meta')
    value = m.validate_api_meta(m.parse(body))
    return headers.get_content_type() == 'application/json' and value['backendRelease'] == backend


def require_no_active_bootstrap():
    path = ROOT / 'backend-operations/first-window-current.json'
    marker = Path('/etc/zimage/frontend-checking.json')
    if os.path.lexists(marker): raise ValueError('Dedicated first-window coordinator owns static checking')
    if not os.path.lexists(path): return
    for directory in [*reversed(path.parent.parents), path.parent]: owned(directory, directory=True)
    owned(path)
    record = m.parse(m.read_regular(path, m.MAX_JSON))
    if record.get('phase') != 'committed' or record.get('writesOpened') is not True:
        raise ValueError('Dedicated first-window coordinator owns unfinished bootstrap')


def production_preflight():
    if os.geteuid() != 0: raise ValueError('Fixed helper requires root; local packaging must remain unprivileged')
    parent = Path(__file__).absolute().parent
    for directory in [*reversed(parent.parents), parent]: owned(directory, directory=True)
    for name in ['release.py', 'manifest.py', 'transport.py']: owned(parent / name)
    for directory in [*reversed(CONFIG.parent.parents), CONFIG.parent]: owned(directory, directory=True)
    owned(CONFIG)
    config = m.parse(m.read_regular(CONFIG, 16384))
    if config != {'schemaVersion': 1, 'enabled': True, 'origin': ORIGIN, 'root': str(ROOT)}:
        raise ValueError('Administrator must enable exact reviewed frontend configuration')
    for directory in [*reversed(ROOT.parents), ROOT]: owned(directory, directory=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    deploy = sub.add_parser('deploy')
    for field in ['operation', 'namespace', 'archive_sha256', 'manifest_sha256', 'expected_current']: deploy.add_argument(field)
    rollback = sub.add_parser('rollback')
    for field in ['operation', 'expected_current', 'target']: rollback.add_argument(field)
    sub.add_parser('status')
    inventory = sub.add_parser('inventory')
    inventory.add_argument('operation')
    args = parser.parse_args()
    production_preflight()
    publisher = Publisher(ROOT, probe=production_probe, meta=production_meta, approval=production_approval)
    if args.command in ('deploy', 'rollback'):
        original_locked = publisher.locked
        @contextmanager
        def ordinary_locked():
            with original_locked():
                require_no_active_bootstrap()
                yield
        publisher.locked = ordinary_locked
    expected = None if getattr(args, 'expected_current', None) == 'none' else getattr(args, 'expected_current', None)
    if args.command == 'deploy': result = publisher.deploy(args.operation, args.namespace, args.archive_sha256, args.manifest_sha256, expected)
    elif args.command == 'rollback': result = publisher.rollback(args.operation, expected, args.target)
    elif args.command == 'inventory':
        m.identifier(args.operation)
        body = sys.stdin.buffer.read(m.MAX_JSON + 1)
        if len(body) > m.MAX_JSON: raise ValueError('Inventory request exceeds bounded stdin')
        result = publisher.inventory(m.parse(body))
    else: result = publisher.status()
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get('success', args.command in {'status', 'inventory'}) else 1


activateFrontend = Publisher.deploy
rollbackFrontend = Publisher.rollback

if __name__ == '__main__':
    try: sys.exit(main())
    except Exception as error:
        # No raw response/environment/upload values enter privileged logs.
        print('Frontend release rejected: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
