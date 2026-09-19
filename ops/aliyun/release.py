#!/usr/bin/python3
"""Root-owned release helper. The deployment account may invoke only this command."""
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/zimage')
INCOMING = ROOT / 'incoming'
RELEASES = ROOT / 'releases'
CURRENT = ROOT / 'current'
PREVIOUS = ROOT / 'previous'


def release_name(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{6,79}', value):
        raise ValueError('Invalid release identifier')
    return value


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
            if str(path) in {'.release-sha', '.archive-sha256'}:
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
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            return response.status, response.read(2_000_000).decode('utf-8', errors='replace')
    except urllib.error.HTTPError as error:
        return error.code, ''


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
    if get(base + '/api/account')[0] != 401:
        raise RuntimeError('Unauthenticated account route must return 401')


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
                raise RuntimeError('Release failed local/public health checks') from error
            time.sleep(2)


def activate(target):
    old = CURRENT.resolve(strict=True)
    try:
        switch(target)
        wait_healthy(target)
    except Exception:
        if old != target:
            switch(old)
            wait_healthy(old)
            print('Rollback verified:', old.name, flush=True)
        raise
    if old != target:
        temp = ROOT / 'previous.next'
        temp.unlink(missing_ok=True)
        temp.symlink_to(old)
        temp.replace(PREVIOUS)
    print('Published and verified:', target.name, flush=True)


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
            activate(target)
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
        # Copy into a root-owned directory before verification to avoid staging-file races.
        with tempfile.TemporaryDirectory(prefix='release-', dir=ROOT) as temp:
            archive = Path(temp) / 'release.tgz'
            descriptor = os.open(INCOMING / (sha + '.tgz'), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
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
