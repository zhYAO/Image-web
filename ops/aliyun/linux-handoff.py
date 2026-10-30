#!/usr/bin/env python3
"""Offline source handoff and guarded commands for an already authorized Linux builder.

No transfer, SSH, tool installation, Docker creation, Git mutation, or activation.
The current dirty snapshot is inspectable; build requires a clean exact commit.
"""
import argparse
import base64
import datetime
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import time
from urllib.parse import urlsplit

ROOT_FILES = {'.gitignore', '.node-version', '.prettierignore', 'DESIGN.md', 'README.md',
              'eslint.config.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
              'tsconfig.base.json'}
ROOT_DIRS = {'.github', 'apps', 'doc', 'ops', 'packages', 'scripts', 'supabase'}
DENY_PARTS = {'.git', '.aws', '.agents', '.codex', '.ssh', '.design-qa', 'node_modules',
              '.pnpm-store', 'dist', '.prerender', '__pycache__', 'coverage', 'test-results'}
EXTENSIONS = {'.cjs', '.conf', '.css', '.example', '.html', '.inc', '.jpg', '.js', '.json',
              '.lock', '.md', '.mjs', '.mts', '.png', '.py', '.service', '.sh', '.sql',
              '.toml', '.ts', '.tsx', '.txt', '.webp', '.yaml', '.yml', ''}
PUBLIC_KEYS = {'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
               'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'NEXT_PUBLIC_SENTRY_DSN',
               'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'}
FONTS = {
    'NotoSansCJKsc-Bold.otf': 'b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a',
    'NotoSansCJKsc-Regular.otf': '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
    'LICENSE.txt': '88f117575237307bdd86a17ef15e21790fc9a662fe4dfb103ca1ca077f0d9982',
    'README.md': 'f314e6e822b03543d7403eb3f8331208d52356a27fe1391216d23d7599583c58',
}
REVIEWED_TEST_MARKER = {'path': 'ops/aliyun/frontend/test_frontend_release.py',
    'sha256': 'acd3997bde7799ca72bcc7cbf1b906d0c26e9b36362b872c36bd169078305858'}
TARGET = {'schema': 1, 'runtime': {'node': '24.19.0', 'abi': '137', 'platform': 'linux',
          'arch': 'x64', 'libc': 'glibc-2.35'}, 'toolchain': {'packageManager': 'pnpm@11.19.0'},
          'assemblyCacheRoot': '/opt/zimage/layer-cache'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, obj):
    path = Path(path)
    with path.open('x', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, sort_keys=True, indent=2)
        f.write('\n')


def run(args, cwd=None, env=None):
    return subprocess.check_output([str(a) for a in args], cwd=cwd, env=env,
                                   stderr=subprocess.PIPE)


def git(root, *args):
    return run(['git', '-C', root, *args])


def allowed(name):
    p = PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or not p.parts:
        return False
    if any(x in DENY_PARTS or x.startswith('.next') for x in p.parts):
        return False
    if p.name.startswith('.env'):
        return False
    if p.name in {'.npmrc', '.netrc', '.DS_Store'} or p.suffix.lower() not in EXTENSIONS:
        return False
    if p.name.lower() in {'credentials', 'credentials.json', 'secrets.json', 'secrets.yaml',
                          'id_rsa', 'id_ed25519', 'authorized_keys', 'known_hosts'}:
        return False
    return (len(p.parts) == 1 and name in ROOT_FILES) or p.parts[0] in ROOT_DIRS


def scan(name, data):
    """High confidence local check, not a claim of exhaustive secret detection."""
    markers = {
        'private-key': rb'-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED )?PRIVATE KEY-----',
        'supabase-secret': rb'\bsb_secret_[A-Za-z0-9_-]{20,}',
        'aws-access-key': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
        'github-token': rb'\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})',
    }
    for kind, pattern in markers.items():
        if re.search(pattern, data):
            # One reviewed negative-test marker, bound to the complete test file bytes.
            if (kind == 'supabase-secret' and name == REVIEWED_TEST_MARKER['path']
                    and digest(data) == REVIEWED_TEST_MARKER['sha256']
                    and all(m.group() == b'sb_secret_'+b'x'*32 for m in re.finditer(pattern, data))):
                continue
            raise ValueError('Source blocked by high confidence scan: '+name+' ('+kind+')')
    for match in re.finditer(rb'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', data):
        try:
            token = match.group().split(b'.')[1]
            payload = json.loads(base64.urlsafe_b64decode(token+b'='*((-len(token)) % 4)))
        except Exception:
            continue
        if payload.get('role') == 'service_role':
            raise ValueError('Source blocked by server JWT scan: '+name)


def source_files(root):
    names = sorted(set(x.decode('utf-8') for x in git(
        root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0') if x))
    # The current index omits staged git-rm and rename-source paths; obtain their
    # deletion names directly against HEAD, without opening any deleted content.
    deletion_names = [x.decode('utf-8') for x in git(root, 'diff', '--no-renames',
                      '--diff-filter=D', '--name-only', '-z', 'HEAD').split(b'\0') if x]
    for name in deletion_names:
        if not allowed(name): raise ValueError('Deleted path outside source allowlist: '+name)
    files, deleted = [], list(deletion_names)
    for name in names:
        # Omit credential configuration by name without opening or hashing its bytes.
        if PurePosixPath(name).name.startswith('.env') or PurePosixPath(name).name in {'.npmrc', '.netrc'}:
            continue
        if not allowed(name):
            raise ValueError('File outside source allowlist; explicit review required: '+name)
        p = root/name
        if not p.exists():
            deleted.append(name)
            continue
        if p.is_symlink() or not p.is_file() or any(a.is_symlink() for a in p.parents if a != root.parent):
            raise ValueError('Source must contain regular files without symlink ancestors: '+name)
        data = p.read_bytes()
        scan(name, data)
        files.append({'path': name, 'bytes': len(data), 'sha256': digest(data),
                      'mode': 0o755 if p.stat().st_mode & 0o111 else 0o644})
    return files, sorted(set(deleted))


def fingerprint(files):
    return digest(''.join(f"{x['path']}\0{x['sha256']}\0{x['bytes']}\0{x['mode']}\n"
                          for x in files).encode())


def tar_write(path, members):
    with Path(path).open('xb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as tf:
                for name, data, mode in members:
                    info = tarfile.TarInfo(name)
                    info.size, info.mode, info.mtime = len(data), mode, 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    tf.addfile(info, io.BytesIO(data))


def snapshot(args):
    root, output = args.source.resolve(), args.output.resolve()
    if output == root or root in output.parents:
        raise ValueError('Snapshot output must be outside source')
    output.mkdir(mode=0o700)
    before = git(root, 'status', '--porcelain=v1', '--untracked-files=all')
    files, deleted = source_files(root)
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    manifest = {'schema': 1, 'purpose': 'exact-source-handoff; not a release artifact',
                'baseCommit': head, 'branch': git(root, 'branch', '--show-current').decode().strip(),
                'sourceState': 'dirty' if before else 'clean', 'formalBuildEligible': not bool(before),
                'productionReady': False, 'fileCount': len(files), 'files': files,
                'deletedTrackedPaths': deleted, 'fingerprintSha256': fingerprint(files),
                'gitTree': git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                'gitStatus': before.decode().splitlines(),
                'excludedByDesign': ['Git internals', 'ignored QA/build outputs', 'all node_modules',
                    'actual environment files', 'npm/SSH/cloud credentials', 'external fonts'],
                'scanScope': 'explicit path allowlist and high confidence byte markers only'}
    manifest['reviewedNegativeTestMarker'] = REVIEWED_TEST_MARKER
    manifest['excludedCredentialPathsWithoutRead'] = [n.decode() for n in git(
        root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0') if n
        and (PurePosixPath(n.decode()).name.startswith('.env') or PurePosixPath(n.decode()).name in {'.npmrc', '.netrc'})]
    changed = set(x.decode() for x in git(root, 'diff', '--no-renames', '--name-only', '-z', 'HEAD').split(b'\0') if x)
    changed.update(x.decode() for x in git(root, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0') if x)
    if any(PurePosixPath(n).name.startswith('.env') or PurePosixPath(n).name in {'.npmrc', '.netrc'} for n in changed):
        raise ValueError('Dirty credential paths cannot be silently omitted; review metadata separately')
    if changed.intersection(manifest['excludedCredentialPathsWithoutRead']):
        raise ValueError('Dirty credential paths cannot be silently omitted; review metadata separately')
    def members(selected=files):
        for x in selected:
            data = (root/x['path']).read_bytes()
            if len(data) != x['bytes'] or digest(data) != x['sha256']:
                raise ValueError('Source changed during snapshot: '+x['path'])
            yield x['path'], data, x['mode']
    tar_write(output/'source.tar.gz', members())
    after_files, after_deleted = source_files(root)
    if files != after_files or deleted != after_deleted or before != git(root, 'status', '--porcelain=v1', '--untracked-files=all'):
        raise ValueError('Source drift: snapshot is incomplete and must not be used')
    save(output/'source-manifest.json', manifest)
    delta_files = [x for x in files if x['path'] in changed]
    tar_write(output/'source-delta.tar.gz', members(delta_files))
    delta = {'schema': 1, 'purpose': 'exact overlay on an independently verified base; not a release',
             'requiresBaseCommit': head, 'requiresBaseGitTree': manifest['gitTree'],
             'sourceState': manifest['sourceState'], 'formalBuildEligible': manifest['formalBuildEligible'],
             'productionReady': False, 'fileCount': len(delta_files), 'files': delta_files,
             'deletedTrackedPaths': deleted, 'fingerprintSha256': fingerprint(delta_files),
             'expectedFullSourceFingerprintSha256': manifest['fingerprintSha256']}
    save(output/'source-delta-manifest.json', delta)
    # Recheck after delta reads as well; another agent may have edited during handoff.
    final_files, final_deleted = source_files(root)
    if final_files != files or final_deleted != deleted:
        raise ValueError('Source drift during delta creation; discard this handoff directory')
    receipt = {'schema': 1, 'productionReady': False, 'sourceState': manifest['sourceState'],
               'baseCommit': head, 'fileCount': len(files), 'sourceBytes': sum(x['bytes'] for x in files),
               'fingerprintSha256': manifest['fingerprintSha256'], 'artifacts': {}}
    for name in ['source.tar.gz', 'source-manifest.json', 'source-delta.tar.gz', 'source-delta-manifest.json']:
        data = (output/name).read_bytes()
        receipt['artifacts'][name] = {'bytes': len(data), 'sha256': digest(data)}
    save(output/'source-receipt.json', receipt)
    print(json.dumps(receipt, sort_keys=True))


def verify_archive(args):
    manifest = json.loads(args.manifest.read_text())
    by_name = {x['path']: x for x in manifest['files']}
    if len(by_name) != len(manifest['files']) or fingerprint(manifest['files']) != manifest['fingerprintSha256']:
        raise ValueError('Invalid manifest or fingerprint')
    seen = set()
    with tarfile.open(args.archive, 'r:gz') as tf:
        for member in tf:
            if not member.isfile() or not allowed(member.name) or member.name in seen:
                raise ValueError('Unsafe archive member')
            seen.add(member.name)
            expected = by_name.get(member.name)
            if not expected or member.size != expected['bytes'] or member.mode != expected['mode']:
                raise ValueError('Archive metadata mismatch: '+member.name)
            data = tf.extractfile(member).read()
            if digest(data) != expected['sha256']:
                raise ValueError('Archive byte mismatch: '+member.name)
            scan(member.name, data)
    if seen != set(by_name):
        raise ValueError('Archive closure mismatch')
    print(json.dumps({'verifiedFiles': len(seen), 'fingerprintSha256': manifest['fingerprintSha256'],
                      'formalBuildEligible': manifest['formalBuildEligible'], 'productionReady': False}))


def clean_env(corepack_home=None):
    result = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C.UTF-8',
              'LC_ALL': 'C.UTF-8', 'COREPACK_ENABLE_NETWORK': '0',
              'COREPACK_ENABLE_DOWNLOAD_PROMPT': '0', 'COREPACK_ENABLE_AUTO_PIN': '0'}
    if corepack_home is not None:
        if not corepack_home.is_dir(): raise ValueError('Existing reviewed Corepack cache directory required')
        result['COREPACK_HOME'] = str(corepack_home.resolve())
    return result


def measure(root, pnpm_executable=None, corepack_home=None):
    env = clean_env(corepack_home)
    node = shutil.which('node')
    pnpm = str(pnpm_executable.resolve()) if pnpm_executable else shutil.which('pnpm')
    if not node or not pnpm:
        raise ValueError('Existing node and pnpm required; no installation is performed')
    script = "const r=process.report.getReport(),h=r.header; console.log(JSON.stringify({node:process.versions.node,abi:process.versions.modules,napi:process.versions.napi,platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime?'glibc-'+h.glibcVersionRuntime:null,loadedLibstdcpp:r.sharedObjects.filter(x=>x.includes('libstdc++'))}))"
    actual = json.loads(run([node, '-e', script], env=env))
    pm = run([pnpm, '--version'], env=env).decode().strip()
    tar_version = run(['tar', '--version'], env=env).decode().splitlines()[0]
    memory = {}
    for p in [Path('/proc/meminfo'), Path('/proc/self/cgroup'), Path('/proc/loadavg')]:
        if p.is_file():
            memory[str(p)] = p.read_text()[:12000]
    # Read the process' resolved cgroup, not only host-level free(1).
    group = Path('/sys/fs/cgroup')
    p = Path('/proc/self/cgroup')
    if p.is_file():
        for line in p.read_text().splitlines():
            fields = line.split(':', 2)
            if len(fields) == 3 and fields[0] == '0':
                candidate = Path('/sys/fs/cgroup')/fields[2].lstrip('/')
                if candidate.is_dir():
                    group = candidate
    # Resolve v1 memory controller membership against its actual mount root.
    v1_group = None
    mountinfo = Path('/proc/self/mountinfo')
    if p.is_file() and mountinfo.is_file():
        memberships = [line.split(':', 2) for line in p.read_text().splitlines()]
        memory_members = [x[2] for x in memberships if len(x) == 3 and 'memory' in x[1].split(',')]
        for line in mountinfo.read_text().splitlines():
            left, sep, right = line.partition(' - ')
            if not sep: continue
            fields, fs = left.split(), right.split()
            if len(fields) < 5 or len(fs) < 3 or fs[0] != 'cgroup' or 'memory' not in fs[2].split(','):
                continue
            memory['memoryControllerMount'] = line
            mountroot, mountpoint = PurePosixPath(fields[3]), Path(fields[4])
            for member in memory_members:
                try: relative = PurePosixPath(member).relative_to(mountroot)
                except ValueError: relative = PurePosixPath(member.lstrip('/'))
                candidate = mountpoint/str(relative)
                if (candidate/'memory.limit_in_bytes').is_file(): v1_group = candidate
    for name in ['memory.max', 'memory.current', 'memory.swap.max', 'memory.swap.current',
                 'cpu.max', 'memory/memory.limit_in_bytes', 'memory/memory.usage_in_bytes']:
        p = group/name
        if p.is_file():
            memory[str(p)] = p.read_text().strip()
    if v1_group:
        for name in ['memory.limit_in_bytes', 'memory.usage_in_bytes', 'memory.memsw.limit_in_bytes',
                     'memory.memsw.usage_in_bytes', 'memory.stat']:
            p = v1_group/name
            if p.is_file(): memory[str(p)] = p.read_text()[:12000].strip()
    memory['visibilityNote'] = 'Resolved process cgroup in current mount namespace; hidden host ancestor quotas still require operator verification.'
    disk = shutil.disk_usage(root)
    elf = {'node': {}, 'loadedLibstdcpp': []}
    for label, paths in [('node', [node]), ('loadedLibstdcpp', actual.get('loadedLibstdcpp', []))]:
        for name in paths:
            p = Path(name).resolve()
            if not p.is_file(): continue
            data = p.read_bytes()
            versions = {}
            for kind in ['GLIBC', 'GLIBCXX', 'CXXABI']:
                found = sorted(set(re.findall((kind+r'_[0-9]+(?:\.[0-9]+)*').encode(), data)))
                versions[kind] = [x.decode() for x in found]
            record = {'path': str(p), 'bytes': len(data), 'sha256': digest(data),
                      'elfMagic': data[:4] == b'\x7fELF', 'versionSymbols': versions}
            if label == 'node': elf['node'] = record
            else: elf['loadedLibstdcpp'].append(record)
    errors = [k+' mismatch' for k, v in TARGET['runtime'].items() if actual.get(k) != v]
    if actual.get('napi') != '10': errors.append('napi mismatch')
    if pm != '11.19.0': errors.append('pnpm mismatch')
    if 'GNU tar' not in tar_version: errors.append('GNU tar required')
    if sys.version_info < (3, 10): errors.append('Python >=3.10 required')
    pm_path = Path(pnpm).resolve()
    if 'corepack' in str(pm_path).lower() and corepack_home is None:
        errors.append('Corepack shim requires an explicit existing reviewed --corepack-home or standalone --pnpm-executable')
    return {'schema': 1, 'measuredAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'runtime': actual, 'pnpm': pm, 'python': platform.python_version(), 'tar': tar_version,
            'toolPaths': {'node': node, 'pnpm': pnpm}, 'pnpmProgram': {'realpath': str(pm_path),
                'sha256': digest(pm_path.read_bytes()), 'corepackHomeExplicit': corepack_home is not None},
            'memoryAndCgroup': memory,
            'elfEvidence': elf,
            'disk': {'total': disk.total, 'used': disk.used, 'free': disk.free},
            'errors': errors, 'platformMatches': not errors, 'productionReady': False,
            'resourceNote': 'No minimum RAM/disk guarantee. Review actual quota/load before build.'}


def preflight(args):
    report = measure(args.source.resolve(), args.pnpm_executable, args.corepack_home)
    save(args.report, report)
    print(json.dumps({'platformMatches': report['platformMatches'], 'errors': report['errors'],
                      'report': str(args.report), 'productionReady': False}))
    if report['errors']: raise SystemExit(2)


def public_config(path, expected):
    if path.is_symlink() or not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise ValueError('Approved public JSON must be a regular 0600 file')
    raw = path.read_bytes()
    if digest(raw) != expected: raise ValueError('Approved public JSON SHA mismatch')
    def unique(pairs):
        d = {}
        for k, v in pairs:
            if k in d: raise ValueError('Duplicate public key')
            d[k] = v
        return d
    obj = json.loads(raw, object_pairs_hook=unique)
    if set(obj) != PUBLIC_KEYS or not all(isinstance(v, str) for v in obj.values()):
        raise ValueError('Exactly five public string keys required')
    url = urlsplit(obj['NEXT_PUBLIC_SUPABASE_URL'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password:
        raise ValueError('Invalid public Supabase URL')
    key = obj['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
    if key.startswith('sb_publishable_') and len(key) > len('sb_publishable_'):
        pass
    elif key.count('.') == 2:
        mid = key.split('.')[1]
        payload = json.loads(base64.urlsafe_b64decode(mid+'='*((-len(mid)) % 4)))
        if payload.get('role') != 'anon': raise ValueError('Non-anon credential rejected')
    else: raise ValueError('Non-public Supabase credential rejected')
    if not obj['NEXT_PUBLIC_TURNSTILE_SITE_KEY'].strip(): raise ValueError('Missing public sitekey')
    if obj['NEXT_PUBLIC_SENTRY_DSN']:
        u = urlsplit(obj['NEXT_PUBLIC_SENTRY_DSN'])
        if u.scheme != 'https' or not u.hostname or not u.username or u.password:
            raise ValueError('Invalid public Sentry DSN')
    rate = obj['NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE']
    if rate and not 0 <= float(rate) <= 1: raise ValueError('Invalid sample rate')
    return obj


def build(args):
    root = args.source.resolve()
    manifest = json.loads(args.manifest.read_text())
    # Reject dirty preview BEFORE reading config, installing dependencies, or writing output.
    if not manifest.get('formalBuildEligible') or manifest.get('sourceState') != 'clean':
        raise ValueError('Dirty snapshot cannot become a formal release. Freeze a real commit and regenerate source manifest.')
    sha = git(root, 'rev-parse', 'HEAD').decode().strip()
    if not re.fullmatch('[0-9a-f]{40}', args.commit) or sha != args.commit or manifest['baseCommit'] != sha:
        raise ValueError('Exact real commit does not match manifest and Git checkout')
    if git(root, 'status', '--porcelain=v1', '--untracked-files=all'):
        raise ValueError('Build checkout must be clean')
    files, deleted = source_files(root)
    if files != manifest['files'] or deleted != manifest['deletedTrackedPaths']:
        raise ValueError('Build checkout differs from source manifest')
    for d in [root, root/'apps/web']:
        if any(p.name != '.env.example' for p in d.glob('.env*')):
            raise ValueError('Actual environment file in build source is forbidden')
    if any(root.rglob('node_modules')) or (root/'apps/web/.next').exists():
        raise ValueError('Fresh source required; do not reuse Mac node_modules or old build output')
    if root in args.output.resolve().parents or args.output.resolve() == root:
        raise ValueError('Build output must be outside source')
    if not args.pnpm_store.is_dir(): raise ValueError('Existing trusted Linux pnpm store required')
    config = public_config(args.public_config, args.public_sha256)
    if root in args.public_config.resolve().parents: raise ValueError('Public config must remain outside source')
    for name, expected in FONTS.items():
        p = args.font_source/name
        if p.is_symlink() or not p.is_file() or digest(p.read_bytes()) != expected:
            raise ValueError('Original font/license/provenance mismatch: '+name)
    out = args.output.resolve()
    out.mkdir(mode=0o700)
    report = measure(root, args.pnpm_executable, args.corepack_home)
    save(out/'platform-preflight.json', report)
    if report['errors']: raise ValueError('Platform mismatch; see platform-preflight.json')
    save(out/'target.json', TARGET)
    shutil.copyfile(args.manifest, out/'source-manifest.json')
    env = clean_env(args.corepack_home)
    (out/'isolated-home').mkdir(mode=0o700)
    env['HOME'] = str(out/'isolated-home')
    (out/'empty-npmrc').touch(mode=0o600)
    env['npm_config_userconfig'] = str(out/'empty-npmrc')
    env['npm_config_globalconfig'] = str(out/'empty-npmrc')
    timings = []
    def step(name, argv, environment):
        start = time.monotonic()
        with (out/(name+'.log')).open('xb') as log:
            result = subprocess.run([str(x) for x in argv], cwd=root, env=environment,
                                    stdout=log, stderr=subprocess.STDOUT)
        timings.append({'step': name, 'exitCode': result.returncode, 'seconds': round(time.monotonic()-start, 3)})
        save(out/(name+'-result.json'), timings[-1])
        if result.returncode: raise ValueError('Step failed: '+name+'; private log retained without echo')
    node, pnpm = report['toolPaths']['node'], report['toolPaths']['pnpm']
    step('target-check', [node, 'ops/aliyun/package-release.mjs', '--check-target', '--target', out/'target.json'], env)
    lock = digest((root/'pnpm-lock.yaml').read_bytes())
    step('install', [pnpm, 'install', '--frozen-lockfile', '--offline', '--store-dir', args.pnpm_store], env)
    if digest((root/'pnpm-lock.yaml').read_bytes()) != lock: raise ValueError('Lockfile changed')
    step('complete-assets', [node, 'ops/aliyun/package-static-assets.mjs', '--font-source', args.font_source,
                            '--output', out/'assets'], env)
    assets = json.loads((out/'complete-assets.log').read_text())
    build_env = dict(env, **config)
    build_env.update({'NODE_ENV': 'production', 'NODE_OPTIONS': '--max-old-space-size=4096',
        'NEXT_PUBLIC_DATA_MODE': 'http', 'NEXT_PUBLIC_PHASE2_AUTH': 'true',
        'ZIMAGE_DEPLOYMENT_ENV': 'production', 'ZIMAGE_BUILD_SHA': sha, 'ZIMAGE_BUILD_SLIM': '1',
        'NEXT_PUBLIC_STATIC_ASSET_BASE_URL': '', 'ZIMAGE_BUILD_CPUS': '1',
        'ZIMAGE_SHARED_FONT_DIR': assets['versionDirectory']+'/fonts',
        'ZIMAGE_STATIC_ASSET_SHA256': assets['manifestSha256']})
    # NEXT_DIST_DIR / VERCEL_ENV / all server secrets are absent from this allowlisted env.
    step('next-build', [pnpm, '--filter', '@zimage/web', 'exec', 'next', 'build', '--webpack'], build_env)
    if (root/'apps/web/.next/BUILD_ID').read_text().strip() != sha: raise ValueError('BUILD_ID mismatch')
    if git(root, 'status', '--porcelain=v1', '--untracked-files=all'):
        raise ValueError('Source changed during build')
    after, deleted_after = source_files(root)
    if after != files or deleted_after != deleted: raise ValueError('Source bytes drifted during build')
    step('package', [node, 'ops/aliyun/package-release.mjs', 'apps/web/.next', out/'release',
        '--assets', assets['versionDirectory'], '--release-id', sha, '--target', out/'target.json'], build_env)
    save(out/'build-result.json', {'schema': 1, 'commit': sha, 'sourceFingerprintSha256': fingerprint(files),
        'lockSha256': lock, 'publicConfigSha256': args.public_sha256, 'timings': timings,
        'secretsInjected': False, 'network': 'offline dependency install; build network depends on existing sandbox policy',
        'productionReady': False})
    print(json.dumps({'commit': sha, 'buildRoot': str(out), 'productionReady': False, 'transferPerformed': False}))


def return_bundle(args):
    root, destination = args.build_root.resolve(), args.output.resolve()
    source = json.loads((root/'source-manifest.json').read_text())
    built = json.loads((root/'build-result.json').read_text())
    release = json.loads((root/'release/release-result.json').read_text())
    if (source.get('sourceState') != 'clean' or not source.get('formalBuildEligible')
            or not re.fullmatch('[0-9a-f]{40}', built.get('commit', ''))
            or source.get('baseCommit') != built['commit']
            or release.get('releaseSha') != built['commit']):
        raise ValueError('Return bundle requires one clean real source commit bound to the release')
    selected = {'transport.tgz': root/'release/transport.tgz',
                'release-result.json': root/'release/release-result.json',
                'build-result.json': root/'build-result.json',
                'platform-preflight.json': root/'platform-preflight.json',
                'source-manifest.json': root/'source-manifest.json'}
    records = {}
    for name, p in selected.items():
        if p.is_symlink() or not p.is_file(): raise ValueError('Missing regular return member: '+name)
        data = p.read_bytes()
        if name.endswith('.json'): scan(name, data)
        records[name] = {'bytes': len(data), 'sha256': digest(data)}
    index = json.dumps({'schema': 1, 'productionReady': False, 'files': records,
        'excluded': ['public config', 'all environment files', 'home', 'logs', 'source maps',
                     'debug-maps.tgz', 'build-traces.tgz', 'source checkout', 'font-source inputs']},
        sort_keys=True, indent=2).encode()+b'\n'
    tar_write(destination, [(name, p.read_bytes(), 0o644) for name, p in selected.items()]+
              [('return-index.json', index, 0o644)])
    body = destination.read_bytes()
    save(destination.with_suffix(destination.suffix+'.receipt.json'),
         {'bytes': len(body), 'sha256': digest(body), 'productionReady': False, 'transferPerformed': False})
    print(json.dumps({'returnBundle': str(destination), 'bytes': len(body), 'sha256': digest(body),
                      'transferPerformed': False, 'productionReady': False}))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    a = sub.add_parser('snapshot'); a.add_argument('--source', type=Path, required=True); a.add_argument('--output', type=Path, required=True); a.set_defaults(fn=snapshot)
    a = sub.add_parser('verify-archive'); a.add_argument('--archive', type=Path, required=True); a.add_argument('--manifest', type=Path, required=True); a.set_defaults(fn=verify_archive)
    a = sub.add_parser('preflight'); a.add_argument('--source', type=Path, required=True); a.add_argument('--report', type=Path, required=True); a.add_argument('--pnpm-executable', type=Path); a.add_argument('--corepack-home', type=Path); a.set_defaults(fn=preflight)
    a = sub.add_parser('build')
    for name in ['source', 'manifest', 'output', 'public-config', 'font-source', 'pnpm-store']: a.add_argument('--'+name, type=Path, required=True)
    a.add_argument('--commit', required=True); a.add_argument('--public-sha256', required=True); a.set_defaults(fn=build)
    a.add_argument('--pnpm-executable', type=Path); a.add_argument('--corepack-home', type=Path)
    a = sub.add_parser('return'); a.add_argument('--build-root', type=Path, required=True); a.add_argument('--output', type=Path, required=True); a.set_defaults(fn=return_bundle)
    args = p.parse_args()
    try: args.fn(args)
    except Exception as exc:
        # Never echo subprocess stderr or arbitrary config parsing details.
        safe = str(exc) if isinstance(exc, ValueError) else type(exc).__name__+'; inspect the retained local step report'
        print('handoff stopped: '+safe, file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
