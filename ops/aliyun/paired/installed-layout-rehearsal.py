#!/usr/bin/env python3
"""Isolated installed-layout admission rehearsal; never production deploy."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

SHA = "8a2ff1f0749eb7270ac28290b96feb02ffc5f67a"
BASE = "/usr/local/libexec/zimage-paired-release"
RECEIVER = BASE + "/receive-ordinary-pair"
PREFIXES = (BASE + "/", "/usr/local/libexec/zimage-backend/",
            "/usr/local/libexec/zimage-three-layer/", "/opt/zimage/frontend-tools/")
REFUSAL = b"ZImage ordinary pair receiver refused or requires read-only reconciliation"

def run(*argv, **kwargs):
    return subprocess.check_output(argv, timeout=60, **kwargs)

def put(archive, name, data, mode=0o600):
    entry = tarfile.TarInfo(name)
    entry.size, entry.mode = len(data), mode
    archive.addfile(entry, io.BytesIO(data))

def bundle(repo):
    script = run("git", "-C", repo, "show", SHA + ":ops/aliyun/paired/ordinary_install_inventory.py")
    # Execute the reviewed inventory builder from committed bytes; the checkout is never changed.
    ns = {"__name__": "reviewed_inventory"}
    exec(compile(script, "<reviewed-inventory>", "exec"), ns)
    plan = ns["build"](ns["CommittedTree"](Path(repo), SHA))
    assert plan["commit"] == SHA and len(plan["files"]) == 50
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as archive:
        for dest, item in plan["files"].items():
            rel = PurePosixPath(dest)
            assert rel.is_absolute() and ".." not in rel.parts and dest.startswith(PREFIXES)
            blob = run("git", "-C", repo, "show", SHA + ":" + item["source"])
            assert hashlib.sha256(blob).hexdigest() == item["sha256"]
            put(archive, "zimage-layout/" + dest.lstrip("/"), blob,
                0o755 if item["gitExecutable"] else 0o644)
        for section, name in (("receiver", "ordinary-receiver-tools.json"),
                              ("paired", "paired-release-tools.json")):
            put(archive, "zimage-layout/etc/zimage/" + name,
                json.dumps(plan[section], sort_keys=True).encode())
        put(archive, "zimage-layout/guest.py", GUEST.encode())
    return data.getvalue()

GUEST = r"""
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys

if sys.flags.optimize:
    raise RuntimeError('assertions are required')
assert os.geteuid() == 0 and Path('/.dockerenv').is_file()
assert all(not Path(p).exists() for p in (
    '/usr/local/libexec/zimage-paired-release',
    '/usr/local/libexec/zimage-backend',
    '/usr/local/libexec/zimage-three-layer', '/etc/zimage', '/opt/zimage',
))
actual_python = Path('/usr/local/bin/python3')
fixed_shebang = Path('/usr/bin/python3')
assert actual_python.is_file() and os.access(actual_python, os.X_OK)
if not os.path.lexists(fixed_shebang):
    fixed_shebang.symlink_to(actual_python)
assert fixed_shebang.is_file() and os.access(fixed_shebang, os.X_OK)
source = Path('/tmp/zimage-layout')
for folder in ('usr/local/libexec', 'opt', 'etc'):
    target = Path('/') / folder
    target.mkdir(parents=True, exist_ok=True)
    for item in (source / folder).iterdir():
        dest = target / item.name
        assert not dest.exists()
        shutil.copytree(item, dest)
spool = Path('/opt/zimage/ordinary-requests')
spool.mkdir(mode=0o700)
for sub in ('releases', 'assets', 'objects', '.stage', 'journal'):
    (spool.parent / 'frontend' / sub).mkdir(parents=True, mode=0o700)
exe = '/usr/local/libexec/zimage-paired-release/receive-ordinary-pair'
spec = importlib.util.spec_from_loader('installed_receiver',
    importlib.machinery.SourceFileLoader('installed_receiver', exe))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)
receiver.invocation([exe], script=exe, uid=os.geteuid(), isolated=sys.flags.isolated)
pins, bodies = receiver.authenticate(receiver.read_installed)
cli_path = Path(exe).parent / 'cli.py'
cli = receiver.source('ordinary_installed_cli', cli_path, bodies[cli_path])
core, paired = cli.authenticate()
assert all(pins[x] == paired[x] for x in pins.keys() & paired.keys())
with cli.source_only(paired | pins), cli.safe_environment():
    for name, filename in receiver.MODULES:
        receiver.source(name, receiver.RUNTIME / filename, bodies[receiver.RUNTIME / filename])
    # Do not invoke native service preflights in the source-admission lane.
    cli.load(Path(exe).parent / 'stage.py', 'isolated_installed_stage')
    cli.load(Path(exe).parent / 'system.py', 'ordinary_installed_system')
print('INSTALLED_COMMITTED_RUNTIME_AUTHENTICATED', flush=True)

def refuse_unread():
    # Leave stdin open and empty. A healthy refusal must not wait for the wire.
    with subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE) as process:
        try:
            assert process.wait(timeout=8) == 1
            assert process.stdout.read() == b''
            assert b'ZImage ordinary pair receiver refused' in process.stderr.read()
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise
refuse_unread()  # No real authority, token, or TLS configuration is installed.
runtime = receiver.RUNTIME / 'github_protected_merge_observe.py'
before = runtime.read_bytes()
runtime.write_bytes(before + b'\n# changed in this disposable guest\n')
try:
    receiver.authenticate(receiver.read_installed)
except ValueError as exc:
    assert 'approved inventory' in str(exc)
else:
    raise AssertionError('altered reviewed source was accepted')
refuse_unread()
runtime.unlink()
try:
    receiver.authenticate(receiver.read_installed)
except FileNotFoundError:
    pass
else:
    raise AssertionError('missing reviewed source was accepted')
refuse_unread()
print('MISSING_AND_TAMPERED_RUNTIME_REFUSED_BEFORE_STDIN', flush=True)
print('NO_AUTHORITY_NO_NETWORK_NO_PUBLISH_NO_ROLLBACK', flush=True)
"""

def main():
    if sys.flags.optimize:
        raise RuntimeError('assertions are required')
    if len(sys.argv) != 3 or sys.platform != "linux":
        raise SystemExit("usage on disposable Linux runner: rehearsal.py CHECKOUT IMAGE@sha256:DIGEST")
    repo, image = sys.argv[1:]
    if not re.fullmatch(r"[a-z0-9./:_-]+@sha256:[a-f0-9]{64}", image):
        raise SystemExit("reviewed digest-pinned local Linux image required")
    # Use the local Docker socket only. Never inherit a remote context or attach a host path.
    docker = ("docker", "--host", "unix:///var/run/docker.sock")
    env = {k: v for k, v in os.environ.items() if not k.startswith("DOCKER_")}
    payload = bundle(repo)
    cid = run(*docker, "create", "--pull=never", "--network=none", "--cap-drop=ALL",
              "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=384m",
              "--user=0:0", "--entrypoint=/usr/local/bin/python3", image, "-I",
              "/tmp/zimage-layout/guest.py", env=env).decode().strip()
    if not re.fullmatch(r"[a-f0-9]{64}", cid):
        raise RuntimeError("unexpected container identity")
    try:
        inspected = json.loads(run(*docker, "inspect", cid, env=env))[0]
        assert not inspected["Mounts"] and inspected["HostConfig"]["NetworkMode"] == "none"
        assert not inspected["HostConfig"]["Privileged"]
        run(*docker, "cp", "-", cid + ":/tmp", input=payload, env=env)
        output = run(*docker, "start", "-a", cid, env=env)
        for marker in (b"INSTALLED_COMMITTED_RUNTIME_AUTHENTICATED",
                       b"MISSING_AND_TAMPERED_RUNTIME_REFUSED_BEFORE_STDIN",
                       b"NO_AUTHORITY_NO_NETWORK_NO_PUBLISH_NO_ROLLBACK"):
            assert output.splitlines().count(marker) == 1
        print(output.decode(), end="")
    finally:
        run(*docker, "rm", "-f", cid, env=env)

if __name__ == "__main__":
    main()
