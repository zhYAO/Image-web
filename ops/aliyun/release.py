#!/usr/bin/python3
"""Root-owned release helper. The deployment account may invoke only this command."""
import fcntl
import hashlib
import html
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path('/opt/zimage')
INCOMING = ROOT / 'incoming'
RELEASES = ROOT / 'releases'
CURRENT = ROOT / 'current'
PREVIOUS = ROOT / 'previous'
FONT_ENV = Path('/etc/zimage/font-assets.env')
NODE = ROOT / 'trusted-toolchain/node-v24.19.0-linux-x64/bin/node'
SAFE_PATH = str(NODE.parent) + ':/usr/sbin:/usr/bin:/sbin:/bin'


class LocalIngressHTTPSConnection(http.client.HTTPSConnection):
    """Connect to this server's Nginx while verifying the real public TLS name."""
    def connect(self):
        sock = socket.create_connection(('127.0.0.1', 443), self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname='www.zimage.store')
        except BaseException:
            sock.close()
            raise


class LocalIngressHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, request):
        origin = urllib.parse.urlsplit(request.full_url)
        if origin.hostname != 'www.zimage.store' or origin.port not in (None, 443):
            raise ValueError('Unexpected local ingress origin')
        return self.do_open(LocalIngressHTTPSConnection, request, context=self._context)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def release_name(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{6,79}', value):
        raise ValueError('Invalid release identifier')
    return value


def require_full_release(target):
    # Presence, including orphan/dangling markers, binds this SHA to the
    # layered protocol. Only its adapter may validate that retained closure.
    if any(os.path.lexists(target / name) for name in ('.three-layer-release.json', '.manifest-sha256')):
        raise ValueError('Immutable release format conflict: layered metadata requires the three-layer helper; use a new SHA for full deployment')


def extract_release(archive, destination):
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 100000 or sum(m.size for m in members) > 2_000_000_000:
            raise ValueError('Release exceeds size budget')
        links = set()
        names = set()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or any(p.startswith('.env') for p in path.parts):
                raise ValueError('Unsafe archive path')
            if str(path) in {'.release-sha', '.archive-sha256', '.runtime-assets.env', '.three-layer-release.json', '.manifest-sha256'}:
                raise ValueError('Reserved release metadata')
            if str(path) in names:
                raise ValueError('Duplicate archive member')
            names.add(str(path))
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError('Only regular files, directories and internal symlinks are allowed')
            if member.issym():
                target = PurePosixPath(member.linkname)
                resolved = (destination / str(path.parent) / member.linkname).resolve()
                if target.is_absolute() or not resolved.is_relative_to(destination.resolve()):
                    raise ValueError('External archive symlink')
                links.add(path)
        for member in members:
            path = PurePosixPath(member.name)
            if any(parent in links for parent in path.parents):
                raise ValueError('Archive member traverses a symlink')
        # Extract files before links. Never restore archive owners or special permission bits.
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                target.chmod(0o755)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
        for member in members:
            if member.issym():
                target = destination / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(member.linkname)
        # Lexical checks alone cannot detect chains such as link -> '.', nested -> link/../outside.
        for link in links:
            try:
                resolved = (destination / str(link)).resolve()
            except (OSError, RuntimeError) as error:
                raise ValueError('Invalid archive symlink chain') from error
            if not resolved.is_relative_to(destination.resolve()):
                raise ValueError('External archive symlink chain')


def get(url):
    request = urllib.request.Request(url, headers={'Host': 'www.zimage.store'})
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect(),
        LocalIngressHTTPSHandler(context=ssl.create_default_context()),
    )
    try:
        with opener.open(request, timeout=12) as response:
            return response.status, response.read(2_000_000).decode('utf-8', errors='replace')
    except urllib.error.HTTPError as error:
        with error:
            return error.code, error.read(16384).decode('utf-8', errors='replace')


def verify(base, expected=None):
    if expected:
        status, body = get(base + '/api/health/ready')
        if status != 200 or json.loads(body).get('version') != expected:
            raise RuntimeError('Release version health check failed')
    status, page = get(base + '/login')
    if status != 200:
        raise RuntimeError('Login page health check failed')
    assets = re.findall(r'(?:src|href)="([^" ]*/_next/static/[^" ]+)"', page)
    if not assets:
        raise RuntimeError('No built static assets found')
    for asset in assets[:3]:
        if not asset.startswith('/_next/static/') or get(base + html.unescape(asset))[0] != 200:
            raise RuntimeError('Static asset health check failed')
    for path in ('/api/account', '/api/auth/session'):
        status, body = get(base + path)
        if status != 401:
            raise RuntimeError(f'{path}: unauthenticated route must return 401')
        try:
            error = json.loads(body)
        except (ValueError, UnicodeError):
            error = None
        if not isinstance(error, dict) or error.get('code') != 'unauthorized':
            raise RuntimeError(f'{path}: requires unauthorized error')


NATIVE_PROBE = r"""(async()=>{const sharp=require('sharp'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');let codecs=0;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),dir=process.env.ZIMAGE_SHARED_FONT_DIR,sha=process.env.ZIMAGE_STATIC_ASSET_SHA256;
if(!path.isAbsolute(dir)||!/^[a-f0-9]{64}$/.test(sha)||path.basename(dir)!=='fonts'||path.basename(path.dirname(dir))!==sha)throw Error('font version');
const version=path.dirname(path.resolve(dir)),root=fs.realpathSync(version),fonts=fs.realpathSync(dir);
if(root!==path.join(fs.realpathSync(path.dirname(version)),sha)||fonts!==path.join(root,'fonts'))throw Error('font directory alias');
const contained=(base,file)=>{const real=fs.realpathSync(file),relative=path.relative(base,real);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!fs.statSync(real).isFile())throw Error('font path escape');return real;};
const body=fs.readFileSync(contained(root,path.join(version,'asset-manifest.json')));if(hash(body)!==sha)throw Error('manifest hash');
const manifest=JSON.parse(body);if(manifest.schema!==1||!Array.isArray(manifest.files))throw Error('manifest schema');
const seen=new Set();for(const entry of manifest.files){if(!entry||typeof entry.path!=='string'||!entry.path||entry.path.includes('\\')||path.posix.isAbsolute(entry.path)||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(entry.path)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('unsafe manifest entry');seen.add(entry.path);}
for(const [name,expected] of Object.entries({
'NotoSansCJKsc-Regular.otf':'2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
'NotoSansCJKsc-Bold.otf':'b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a',
'LICENSE.txt':'88f117575237307bdd86a17ef15e21790fc9a662fe4dfb103ca1ca077f0d9982',
'README.md':'f314e6e822b03543d7403eb3f8331208d52356a27fe1391216d23d7599583c58'})){
const bytes=fs.readFileSync(contained(fonts,path.join(dir,name))),entries=manifest.files.filter(e=>e.path==='fonts/'+name);
if(entries.length!==1||entries[0].sha256!==expected||entries[0].bytes!==bytes.length||hash(bytes)!==expected)throw Error('font/license hash');
}
for(const [file,font] of [['NotoSansCJKsc-Regular.otf','Noto Sans CJK SC 24'],['NotoSansCJKsc-Bold.otf','Noto Sans CJK SC Bold 24']]){
const buffer=await sharp({text:{text:'中文 Aa 123',font,fontfile:path.join(process.env.ZIMAGE_SHARED_FONT_DIR,file),rgba:true,dpi:72}}).png().toBuffer();
const source=await sharp(buffer).metadata();if(source.format!=='png'||!source.width||!source.height)throw Error('native');
for(const codec of ['jpeg','webp','avif']){
const encoded=await sharp(buffer).toFormat(codec).toBuffer();const metadata=await sharp(encoded).metadata();
if(metadata.width!==source.width||metadata.height!==source.height||metadata.format!==({jpeg:'jpeg',webp:'webp',avif:'heif'})[codec]||(codec==='avif'&&metadata.compression!=='av1'))throw Error('codec');codecs++;}}
if(codecs!==6)throw Error('codec count');console.log(JSON.stringify({native:true,fonts:2,codecs}));
})().catch(()=>{console.error('Native/font verification failed');process.exit(1)})"""


def native_probe(candidate, environment, runner=subprocess.run):
    command = ['/usr/sbin/runuser', '--user', 'zimage', '--', '/usr/bin/env', '-i', 'PATH=' + SAFE_PATH, 'NODE_ENV=production']
    command += [key + '=' + environment[key] for key in ('ZIMAGE_SHARED_FONT_DIR', 'ZIMAGE_STATIC_ASSET_SHA256')]
    command += [str(NODE), '-e', NATIVE_PROBE]
    result = runner(command, cwd=candidate / 'apps/web', check=True, capture_output=True, text=True, timeout=90,
                    env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'})
    if result.returncode or json.loads(result.stdout) != {'native': True, 'fonts': 2, 'codecs': 6}:
        raise RuntimeError('Non-root native/font candidate verification failed')


def service_font_preflight():
    """Query service metadata only; never read its credential environment."""
    user = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=User', '--value'], text=True).strip()
    group = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=Group', '--value'], text=True).strip()
    files = subprocess.check_output(['/usr/bin/systemctl', 'show', 'zimage', '--property=EnvironmentFiles', '--value'], text=True)
    paths = re.findall(r'(/[^\s]+)', files)
    if user != 'zimage' or group != 'zimage' or not paths or paths[-1] != (ROOT / 'current/.runtime-assets.env').as_posix():
        raise ValueError('Service must use User/Group=zimage and load per-release .runtime-assets.env LAST; update reviewed systemd template')


def read_font_environment(file):
    try:
        if file.is_symlink() or any(parent.is_symlink() for parent in file.parents):
            raise ValueError('External font environment must not traverse symlinks')
        descriptor = os.open(file, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(descriptor, 'r') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
                raise ValueError('Invalid external font environment file')
            if os.name == 'posix' and (info.st_uid != os.geteuid() or info.st_mode & 0o022):
                raise ValueError('External font environment must be root-owned and not group/world writable')
            body = stream.read(8193)
            after = os.fstat(stream.fileno())
            if (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError('External font environment changed during preflight')
    except OSError as error:
        raise ValueError('Missing/unreadable external font environment: prepare /etc/zimage/font-assets.env or retained .runtime-assets.env; see FONTS.md') from error
    values = {}
    for line in body.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key not in ('ZIMAGE_SHARED_FONT_DIR', 'ZIMAGE_STATIC_ASSET_SHA256') or key in values:
            raise ValueError('Font environment accepts exactly one of each ZIMAGE_SHARED_FONT_DIR / ZIMAGE_STATIC_ASSET_SHA256; no other values')
        values[key] = value
    directory, sha = values.get('ZIMAGE_SHARED_FONT_DIR', ''), values.get('ZIMAGE_STATIC_ASSET_SHA256', '')
    if (len(values) != 2 or not re.fullmatch('[a-f0-9]{64}', sha) or not Path(directory).is_absolute()
            or Path(directory).name != 'fonts' or Path(directory).parent.name != sha
            or any(char in directory for char in '\r\n\x00\"\'')):
        raise ValueError('External font environment requires an absolute <manifestSHA>/fonts directory and matching SHA pair')
    return values


def font_preflight(target):
    """Pin checked, non-secret resources before any current/restart mutation."""
    binding = target / '.runtime-assets.env'
    retained = os.path.lexists(binding)
    environment = read_font_environment(binding if retained else FONT_ENV)
    service_font_preflight()
    native_probe(target, environment)
    if not retained:
        descriptor = os.open(binding, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        with os.fdopen(descriptor, 'w') as output:
            output.write(''.join(key + '=' + environment[key] + '\n' for key in ('ZIMAGE_SHARED_FONT_DIR', 'ZIMAGE_STATIC_ASSET_SHA256')))
            output.flush()
            os.fsync(output.fileno())
    return environment


def switch(target):
    temporary = ROOT / 'current.next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(CURRENT)
    subprocess.run(['/usr/bin/systemctl', 'restart', 'zimage'], check=True)


def wait_healthy(target):
    marker = target / '.release-sha'
    expected = marker.read_text().strip() if marker.exists() else None
    for attempt in range(12):
        try:
            verify('http://127.0.0.1:3100', expected)
            verify('https://www.zimage.store', expected)
            return
        except (OSError, ValueError, RuntimeError) as error:
            if attempt == 11:
                raise RuntimeError('Release failed application/local TLS health checks') from error
            time.sleep(2)


def activate(target, restore_previous_on_failure=True):
    font_preflight(target)
    old = CURRENT.resolve(strict=True)
    try:
        switch(target)
        wait_healthy(target)
    except Exception:
        if old != target and restore_previous_on_failure:
            font_preflight(old)
            switch(old)
            wait_healthy(old)
            print('Rollback verified:', old.name, flush=True)
        raise
    if old != target:
        temp = ROOT / 'previous.next'
        temp.unlink(missing_ok=True)
        temp.symlink_to(old)
        temp.replace(PREVIOUS)
    print('Activated and locally verified; external verification still required:', target.name, flush=True)


def activate_initial(target, runner=subprocess.run):
    """Only the explicit layered empty-install path calls this; no old target exists."""
    if os.path.lexists(CURRENT) or os.path.lexists(PREVIOUS):
        raise ValueError('Initial activation requires absent current and previous')
    font_preflight(target)
    try:
        switch(target)
        wait_healthy(target)
    except Exception:
        try:
            runner(['/usr/bin/systemctl', 'stop', 'zimage'], check=True)
        finally:
            # A failed restart may have installed current already. Never delete
            # a concurrent/replaced pointer, and never invent a rollback point.
            if CURRENT.is_symlink() and CURRENT.resolve(strict=False) == target:
                CURRENT.unlink()
        raise
    print('Initial release locally verified; external verification still required:', target.name, flush=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Use the restricted sudo release command')
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    with (ROOT / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if mode == 'rollback' and len(sys.argv) == 3:
            name = sys.argv[2]
            target = PREVIOUS.resolve(strict=True) if name == 'previous' else RELEASES / release_name(name)
            if target.parent != RELEASES or not target.is_dir() or target.is_symlink():
                raise ValueError('Rollback target is not a retained release')
            require_full_release(target)
            # A failed recovery must not reactivate the release just rejected
            # by the external gate. Leave the exact requested original selected
            # and report its failed verification for administrator follow-up.
            activate(target, restore_previous_on_failure=False)
            return
        if mode != 'deploy' or len(sys.argv) != 5:
            raise ValueError('Usage: deploy SHA SHA256 RUN_NUMBER | rollback RELEASE_OR_previous')
        sha, digest, run = sys.argv[2:]
        if not re.fullmatch('[a-f0-9]{40}', sha) or not re.fullmatch('[a-f0-9]{64}', digest) or not run.isdigit():
            raise ValueError('Invalid deployment arguments')
        sequence = ROOT / 'last-deployment-run'
        if sequence.exists() and int(run) < int(sequence.read_text()):
            raise ValueError('Refusing an older workflow run')
        target = RELEASES / sha
        require_full_release(target)
        # Copy into a root-owned directory before verification to avoid staging-file races.
        with tempfile.TemporaryDirectory(prefix='release-', dir=ROOT) as temp:
            archive = Path(temp) / 'release.tgz'
            descriptor = os.open(INCOMING / (sha + '.tgz'), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
            with os.fdopen(descriptor, 'rb') as source, archive.open('wb') as out:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise ValueError('Incoming release must be a regular file')
                shutil.copyfileobj(source, out)
            checksum = hashlib.sha256()
            with archive.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    checksum.update(chunk)
            if checksum.hexdigest() != digest:
                raise ValueError('Release checksum mismatch')
            if not target.exists():
                unpacked = Path(temp) / 'unpacked'
                extract_release(archive, unpacked)
                require_full_release(unpacked)
                server = unpacked / 'apps/web/server.js'
                if not server.is_file() or server.is_symlink():
                    raise ValueError('Missing standalone server')
                for path in ['apps', 'apps/web', 'apps/web/.next']:
                    if (unpacked / path).is_symlink():
                        raise ValueError('Application root cannot be a symlink')
                with (unpacked / '.release-sha').open('x') as marker:
                    marker.write(sha + '\n')
                with (unpacked / '.archive-sha256').open('x') as marker:
                    marker.write(digest + '\n')
                cache = unpacked / 'apps/web/.next/cache'
                if cache.is_symlink():
                    cache.unlink()
                elif cache.exists():
                    shutil.rmtree(cache)
                cache.symlink_to(ROOT / 'cache')
                unpacked.rename(target)
            elif (target / '.release-sha').read_text().strip() != sha:
                raise ValueError('Existing release identity is invalid')
            else:
                print('Reusing verified immutable release:', sha, flush=True)
        activate(target)
        sequence.write_text(run + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Deployment failed:', str(error), file=sys.stderr)
        sys.exit(1)
