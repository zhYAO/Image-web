"""Pinned shadow supervisor invocation. No workflow wiring, signing or upload."""
import hashlib
import json
import re
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import tempfile
import time

from github_hosted_stage_shadow import _require
from github_shadow_measure_report import BASELINE, LEDGER, report

RUNTIME = '119d835f091fe31d0383062f37bebd070c5297ad'
INTAKE = 'bc6a29043434ba62f032be8a312976fd5b9aaa9e'
LIMITS = {'pins.json': 1_000_000, 'config.json': 1_000_000,
          'backend.zip': 100_000_001, 'frontend.zip': 100_000_001}
MAX_STDOUT = 1_000_000


def inspect_admitted(source, dest=None):
    """Independently bound, inspect and optionally copy four owner-only files."""
    _require(set(LIMITS) == {p.name for p in source.iterdir()})
    if dest is not None:
        dest.mkdir(mode=0o700)
    result = {}
    for name, limit in LIMITS.items():
        fd = os.open(source / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as origin:
            info = os.fstat(origin.fileno())
            _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                     and not info.st_mode & 0o077 and info.st_nlink == 1
                     and 0 < info.st_size <= limit)
            digest, total = hashlib.sha256(), 0
            def chunks():
                nonlocal total
                for chunk in iter(lambda: origin.read(128 * 1024), b''):
                    total += len(chunk)
                    _require(total <= limit)
                    digest.update(chunk)
                    yield chunk
            if dest is None:
                for _ in chunks():
                    pass
            else:
                output = os.open(dest/name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(output, 'wb') as target:
                    for chunk in chunks():
                        target.write(chunk)
            after = os.fstat(origin.fileno())
            _require(total == info.st_size == after.st_size and info.st_mtime_ns == after.st_mtime_ns
                     and info.st_ctime_ns == after.st_ctime_ns)
            result[name] = digest.hexdigest()
    return result


def bounded(argv, *, cwd, env, timeout):
    deadline = time.monotonic() + timeout
    with subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True) as child:
        try:
            data = bytearray()
            with selectors.DefaultSelector() as reader:
                reader.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remain = deadline - time.monotonic()
                    _require(remain > 0 and reader.select(remain))
                    chunk = os.read(child.stdout.fileno(), min(65536, MAX_STDOUT + 1 - len(data)))
                    if not chunk:
                        break
                    data.extend(chunk)
                    _require(len(data) <= MAX_STDOUT)
            return subprocess.CompletedProcess(argv, child.wait(timeout=max(0, deadline-time.monotonic())), bytes(data))
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            raise


def private(path):
    info = path.lstat()
    return (path.is_absolute() and path.resolve(strict=True) == path and
            stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077)


WORKFLOW = '.github/workflows/rehearsal-candidates.yml'
REPO = 'zhYAO/Image-web'
BASE_ENV = {
    'GITHUB_REPOSITORY': REPO, 'GITHUB_REPOSITORY_ID': '1329578390',
    'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_REF_PROTECTED': 'true',
    'GITHUB_WORKFLOW_REF': REPO + '/' + WORKFLOW + '@refs/heads/main',
    'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux',
    'ZIMAGE_PAIRED_AUTOMATION': 'false', 'ZIMAGE_PAIRED_PRODUCTION': 'false',
}
DIGEST = re.compile('[a-f0-9]{64}')


def context_from(env, backend, frontend):
    _require(all(env.get(k) == v for k, v in BASE_ENV.items()))
    _require(re.fullmatch('[a-f0-9]{40}', env.get('GITHUB_SHA', ''))
             and all(re.fullmatch('[1-9][0-9]{0,18}', env.get(k, ''))
                     for k in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
             and all(type(d) is str and DIGEST.fullmatch(d) for d in (backend, frontend)))
    return dict(repository=REPO, repositoryId=1329578390, sourceRef=env['GITHUB_REF'],
                event=env['GITHUB_EVENT_NAME'], workflow=WORKFLOW, sourceSHA=env['GITHUB_SHA'],
                runId=int(env['GITHUB_RUN_ID']), attempt=int(env['GITHUB_RUN_ATTEMPT']),
                backendSha256=backend, frontendSha256=frontend, baselineSHA=BASELINE,
                migrationLedgerSha256=LEDGER)


def marker(context, hashes):
    _require(set(hashes) == set(LIMITS) and all(DIGEST.fullmatch(h) for h in hashes.values()))
    _require(context['backendSha256'] == hashes['backend.zip']
             and context['frontendSha256'] == hashes['frontend.zip'])
    return (json.dumps(dict(context=context, hashes=hashes), sort_keys=True, separators=(',', ':')) + '\n').encode()


def freeze(packet, sidecar, env, backend, frontend):
    """Run in trusted intake step only after existing authenticated admission."""
    context = context_from(env, backend, frontend)
    _require(private(packet) and private(sidecar.parent) and sidecar.parent not in packet.parents)
    body = marker(context, inspect_admitted(packet))
    exclusive(sidecar, body)
    return hashlib.sha256(body).hexdigest()


def exclusive(path, body):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o400)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(body)
    except BaseException:
        path.unlink()
        raise


def read_frozen(path, expected_digest, context):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        info = os.fstat(f.fileno())
        _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
                 and stat.S_IMODE(info.st_mode) == 0o400 and 0 < info.st_size <= 8192)
        data = f.read(8193)
    _require(len(data) <= 8192 and hashlib.sha256(data).hexdigest() == expected_digest)
    obj = json.loads(data)
    _require(data == marker(context, obj['hashes']))
    return obj['hashes']


def run(*, packet, trusted_root, scratch, cache, env, backend, frontend, sidecar,
        sidecar_sha256, runtime_identity, corepack_home):
    """Measurement is token-free and derives GitHub identity only from real env."""
    context = context_from(env, backend, frontend)
    _require(not any(env.get(k) for k in ('GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN',
                                           'ACTIONS_ID_TOKEN_REQUEST_TOKEN')))
    _require(all(private(p) for p in (packet, scratch, cache, sidecar.parent)) and not any(cache.iterdir()))
    _require(scratch not in packet.parents and packet not in scratch.parents and packet != scratch)
    hashes = read_frozen(sidecar, sidecar_sha256, context)
    intake, runtime = trusted_root/'trusted-intake', trusted_root/'trusted-runtime'
    _require(runtime_identity(intake, INTAKE) is True and runtime_identity(runtime, RUNTIME) is True)
    handoff = scratch / 'stage-report.json'
    _require(not os.path.lexists(handoff))
    with tempfile.TemporaryDirectory(prefix='measure-', dir=scratch) as td:
        work = Path(td)
        home = work/'home'
        home.mkdir(mode=0o700)
        stage = work/'inputs'
        _require(inspect_admitted(packet, stage) == hashes)
        clean = {k: env[k] for k in BASE_ENV | {'GITHUB_SHA':'', 'GITHUB_RUN_ID':'', 'GITHUB_RUN_ATTEMPT':''}}
        clean.update(PATH='/opt/hostedtoolcache/node/24.19.0/x64/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                     HOME=str(home), TMPDIR=str(work), RUNNER_TEMP=str(scratch),
                     COREPACK_HOME=str(corepack_home), LANG='C.UTF-8', NEXT_TELEMETRY_DISABLED='1')
        prepared = work/'prepared'
        pack = ['/usr/bin/python3','-I','-B',str(intake/'ops/aliyun/prepare-hosted-shadow-pair.py'),
                str(stage),str(prepared),str(cache),'--commit',context['sourceSHA'],
                '--run-id',str(context['runId']),'--attempt',str(context['attempt']),
                '--backend-sha256',hashes['backend.zip'],'--frontend-sha256',hashes['frontend.zip']]
        _require(bounded(pack, cwd=intake, env=clean, timeout=180).returncode == 0)
        argv = ['/bin/bash',str(runtime/'ops/aliyun/github-protected-stage-netproof.sh'),
                '--prepared-protected-shadow',str(prepared),context['sourceSHA'],RUNTIME]
        result = bounded(argv, cwd=runtime, env=clean, timeout=1500)
        body = report(result, argv=argv, context=context)
    exclusive(handoff, body)
    return handoff


def git_identity(directory, expected, *, bare=False):
    args = ['/usr/bin/git', '--no-optional-locks', '-C', str(directory)]
    env = {'PATH':'/usr/bin:/bin', 'LANG':'C', 'GIT_CONFIG_NOSYSTEM':'1',
           'GIT_CONFIG_GLOBAL':'/dev/null', 'GIT_CONFIG_COUNT':'0'}
    def check(*tail):
        result = bounded(args+list(tail), cwd=directory, env=env, timeout=10)
        _require(result.returncode == 0)
        return result.stdout
    _require(directory.is_absolute() and directory.resolve(strict=True) == directory)
    if bare:
        _require(check('rev-parse', '--is-bare-repository') == b'true\n'
                 and check('rev-parse', 'FETCH_HEAD^{commit}') == expected.encode()+b'\n')
    else:
        _require(check('rev-parse', '--show-toplevel') == os.fsencode(directory)+b'\n'
                 and check('rev-parse', 'HEAD') == expected.encode()+b'\n'
                 and check('status', '--porcelain') == b'')
    return True


if __name__ == '__main__':
    import sys
    try:
        _require(len(sys.argv) == 2 and sys.argv[1] in ('freeze', 'measure'))
        backend, frontend = os.environ['BACKEND_DIGEST'], os.environ['FRONTEND_DIGEST']
        context = context_from(os.environ, backend, frontend)
        temp = Path(os.environ['RUNNER_TEMP'])
        workspace = Path(os.environ['GITHUB_WORKSPACE'])
        _require(temp.is_absolute() and temp.resolve(strict=True) == temp)
        git_identity(temp/'zimage-candidate.git', context['sourceSHA'], bare=True)
        packet, scratch = (temp / n for n in ('zimage-hosted-shadow','zimage-report-handoff'))
        sidecar = scratch/'admitted.json'
        if sys.argv[1] == 'freeze':
            git_identity(workspace/'trusted-intake', INTAKE)
            scratch.mkdir(mode=0o700)
            # A trusted workflow step captures this digest into its explicit
            # GH step output; never transports the marker via candidate artifact.
            print(freeze(packet, sidecar, os.environ, backend, frontend))
        else:
            run(packet=packet, trusted_root=workspace, scratch=scratch, cache=Path('/opt/zimage/layer-cache'),
                env=os.environ, backend=backend, frontend=frontend, sidecar=sidecar,
                sidecar_sha256=os.environ['ADMITTED_MARKER_SHA256'], runtime_identity=git_identity,
                corepack_home=temp/'zimage-corepack')
    except Exception:
        sys.exit('Protected measurement handoff refused')
