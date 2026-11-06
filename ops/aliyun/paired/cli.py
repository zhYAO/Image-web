#!/usr/bin/python3 -I
"""Stepwise paired release. Root installation is a separately approved action.

No arbitrary path/URL/command, DDL credentials, provider call, enablement, retry,
financial operation or database downgrade is offered by this CLI.
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import importlib.machinery
import json
import os
from pathlib import Path
import stat
import sys
import types

HERE=Path('/usr/local/libexec/zimage-paired-release')
ROOT=Path('/opt/zimage')
ETC=Path('/etc/zimage')
BACKEND=Path('/usr/local/libexec/zimage-backend')
LAYERS=Path('/usr/local/libexec/zimage-three-layer')
FRONTEND=Path('/opt/zimage/frontend-tools')
POLICY=ETC/'paired-release-policy.json'
TOOLS=ETC/'paired-release-tools.json'


def parser():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='command',required=True)
    for command in ('begin','status','challenge','seal','start-candidate'):sub.add_parser(command)
    stage=sub.add_parser('stage-backend');stage.add_argument('outer_sha256')
    reconcile=sub.add_parser('reconcile-candidate');reconcile.add_argument('database_sha256');reconcile.add_argument('snapshot_sha256')
    for command in ('accept-auth','authorize-migration','accept-database','select-frontend','cancel-before-migration'):
        item=sub.add_parser(command);item.add_argument('expected_sha256')
    for command in ('open','open-recovered'):
        item=sub.add_parser(command);item.add_argument('database_sha256');item.add_argument('acceptance_sha256')
    return p


def preflight_location(path,*,uid,isolated):
    if uid!=0 or not isolated or Path(path).absolute()!=HERE/'cli.py':raise ValueError('Requires root, isolated Python and the exact reviewed installation')


def trusted(path,directory=False):
    for item in (path,*path.parents):
        info=item.lstat();is_dir=directory if item==path else True
        if info.st_uid!=0 or info.st_mode&0o022 or not (stat.S_ISDIR(info.st_mode) if is_dir else stat.S_ISREG(info.st_mode) and info.st_nlink==1):raise ValueError('Untrusted installed code/configuration')


def signature(info):
    return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_mode,info.st_uid,info.st_gid,info.st_nlink)


def raw(path,limit=262144):
    trusted(path)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        body=os.read(fd,limit+1)
        if not 0<len(body)<=limit or len(body)!=before.st_size or signature(before)!=signature(os.fstat(fd)) or signature(before)!=signature(path.lstat()):raise ValueError('Installed file changed or exceeds bound')
        return body
    finally:os.close(fd)


def load(path,alias):
    trusted(path)
    spec=importlib.util.spec_from_file_location(alias,path)
    value=importlib.util.module_from_spec(spec)
    # Never let an otherwise well-owned unchecked-hash .pyc substitute code for
    # the reviewed source. Nested existing loaders are handled by source_only.
    exec(compile(raw(path,2097152),str(path),'exec',dont_inherit=True),value.__dict__)
    return value


@contextmanager
def source_only(mapping):
    """Pin nested existing SourceFileLoaders to the same reviewed source bytes.

    Python -I and trusted installed stdlib remain required. Only fixed tool
    directories are governed here; no arbitrary Python import capability is
    granted. The command is single-threaded and restores the loader on exit.
    """
    previous=importlib.machinery.SourceFileLoader.get_code
    parents={str(Path(path).parent) for path in mapping}
    def code(loader,fullname):
        path=Path(loader.path).absolute();name=str(path)
        if str(path.parent) in parents:
            if name not in mapping:raise ValueError('Nested tool absent from approved closure')
            body=raw(path,2097152)
            if hashlib.sha256(body).hexdigest()!=mapping[name]:raise ValueError('Nested tool changed from approved source')
            return compile(body,name,'exec',dont_inherit=True)
        return previous(loader,fullname)
    importlib.machinery.SourceFileLoader.get_code=code
    try:yield
    finally:importlib.machinery.SourceFileLoader.get_code=previous


@contextmanager
def safe_environment():
    # Retained-layer validation may invoke `node` to inspect ABI/libc. Apply
    # the same fixed runtime/loader sanitation to EVERY command, including
    # begin's pre-maintenance validation, not only stage/start.
    names=('PATH','NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH')
    previous={name:os.environ.get(name) for name in names}
    try:
        for name in names:os.environ.pop(name,None)
        os.environ['PATH']='/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        yield
    finally:
        for name,value in previous.items():
            if value is None:os.environ.pop(name,None)
            else:os.environ[name]=value


def tool_paths():
    return ([HERE/name for name in ('cli.py','core.py','system.py','stage.py')]+
            [BACKEND/name for name in ('release.py','receipt.py','transaction.py','first-window.py','first_window.py','frontend_bootstrap.py','http-admission.cjs')]+
            [LAYERS/name for name in ('release-three-layer.py','release.py','release-layers.py','three-layer-release.py','release-transport.py','release-public-policy.json')]+
            [FRONTEND/name for name in ('release.py','manifest.py','transport.py')])


def authenticate():
    # Strict duplicate/nonfinite parser is loaded only after its code ancestors
    # are authenticated. No user or repository code is executed as root.
    for path in tool_paths():trusted(path)
    def pairs(items):
        out={}
        for key,value in items:
            if key in out:raise ValueError('Duplicate tool identity')
            out[key]=value
        return out
    mapping=json.loads(raw(TOOLS),object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Nonfinite tool identity')))
    if type(mapping) is not dict or set(mapping)!={str(path) for path in tool_paths()}:raise ValueError('Exact approved code closure required')
    for path in tool_paths():
        if type(mapping[str(path)]) is not str or not __import__('re').fullmatch('[a-f0-9]{64}',mapping[str(path)]):raise ValueError('Exact tool digest required')
        if hashlib.sha256(raw(path,2097152)).hexdigest()!=mapping[str(path)]:raise ValueError('Installed code closure differs from reviewed digests')
    # SourceFileLoader may read bytecode even when writes are disabled.
    for parent in {path.parent for path in tool_paths()}:
        cache=parent/'__pycache__'
        if os.path.lexists(cache):
            trusted(cache,True)
            for path in cache.iterdir():trusted(path)
    return load(HERE/'core.py','paired_release_core'),mapping


@contextmanager
def locked():
    path=ROOT/'deploy.lock';trusted(path)
    fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        if signature(path.lstat())!=signature(os.fstat(fd)):raise ValueError('Common deploy lock changed')
        fcntl.flock(fd,fcntl.LOCK_EX);yield
    finally:os.close(fd)


def make_modules():
    b=load(BACKEND/'release.py','paired_backend_release')
    engine=load(BACKEND/'transaction.py','paired_backend_transaction')
    first=load(BACKEND/'first-window.py','paired_first_window')
    bridge=load(LAYERS/'release-three-layer.py','paired_layer_bridge')
    frontend=load(FRONTEND/'release.py','paired_frontend_release')
    layers,legacy=bridge.load_tools(strict=True)
    bridge.service_preflight();b.service_launch_preflight();frontend.production_preflight()
    adapter=bridge.Adapter(ROOT,layers,legacy) # actual native probe, never a no-op
    backend=b.SystemOps(adapter,legacy)
    first_ops=first.FirstOps(adapter,legacy)
    pub=frontend.Publisher(ROOT,probe=frontend.production_probe,meta=frontend.production_meta,approval=frontend.production_approval)
    return types.SimpleNamespace(backend=backend,first=first_ops,engine=engine,transaction=engine,adapter=adapter,
                                 legacy=legacy,publisher=pub,frontend=frontend,bridge=bridge)


def accepted_root_document(c,path,expected):
    c.hexid(expected);body=raw(path)
    if hashlib.sha256(body).hexdigest()!=expected:raise ValueError('Root attestation differs from independently approved digest')
    return c.parse(body)


def main(argv=None):
    args=parser().parse_args(argv)
    preflight_location(Path(__file__),uid=os.geteuid(),isolated=sys.flags.isolated)
    sys.dont_write_bytecode=True
    c,mapping=authenticate();policy=c.parse(raw(POLICY));c.validate_policy(policy,__import__('time').time())
    system=load(HERE/'system.py','paired_system')
    receipt=load(BACKEND/'receipt.py','paired_receipt')
    with source_only(mapping),locked(),safe_environment():
        # Existing directories are mandatory; status cannot provision them.
        for path in (ROOT,ROOT/'frontend',ROOT/'frontend/releases',ROOT/'frontend/assets',ROOT/'frontend/objects',ROOT/'frontend/.stage',ROOT/'frontend/journal',ROOT/'paired-operations'):trusted(path,True)
        modules=make_modules();ops=system.SystemOps(policy,c,modules)
        operation=ROOT/'paired-operations'/policy['operationId']
        if args.command=='stage-backend':
            if os.path.lexists(operation):raise ValueError('Stage before begin only; retained operations cannot be replayed')
            stage=load(HERE/'stage.py','paired_stage')
            with modules.bridge.safe_node_environment():
                result=stage.prepare(modules.bridge,modules.adapter,policy['newBackend'],args.outer_sha256,policy['backendManifestSha256'])
        elif args.command=='status':
            result={'live':ops.snapshot(),'journal':c.Journal(operation).load() if os.path.lexists(operation) else None,'actionPerformed':False}
        else:
            if args.command=='begin':
                if os.path.lexists(operation):raise ValueError('Retained operation already exists')
                operation.mkdir(mode=0o700);c.sync(operation.parent)
            trusted(operation,True)
            journal=c.Journal(operation);co=c.Coordinator(policy,ops,journal,receipt_validator=receipt.validate_receipt)
            if args.command=='begin':result=co.begin()
            elif args.command=='challenge':result=co.challenge()
            elif args.command=='seal':result=co.seal()
            elif args.command=='start-candidate':
                with modules.bridge.safe_node_environment():result=co.start_candidate()
            elif args.command=='accept-auth':
                c.hexid(args.expected_sha256);r=co.state('baseline_pending','candidate_auth_pending','recovery_auth_pending','pair_auth_pending');request=r.get('challenge')
                if not request:raise ValueError('Challenge missing')
                stage=operation/'receipt-stage'
                if not stage.exists():stage.mkdir(mode=0o700);c.sync(operation)
                trusted(stage,True)
                incoming=os.open(ROOT/'incoming',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:
                    def valid_journal(value,**kw):
                        if value!=r or value!=journal.load():raise ValueError('Paired receipt context drift')
                    body=receipt.accept_incoming(incoming,stage,request=request,journal=journal.load,
                        operation=policy['operationId'],release=request['backendRelease'],pid=request['pid'],
                        current_release=modules.backend.current,live_pid=modules.backend.service_pid,
                        expected_sha256=args.expected_sha256,journal_validator=valid_journal)
                finally:os.close(incoming)
                result=co.accept_auth(body)
            elif args.command in ('authorize-migration','accept-database','cancel-before-migration'):
                proof=accepted_root_document(c,ETC/'paired-database-attestation.json',args.expected_sha256)
                action={'authorize-migration':co.authorize_migration,'accept-database':co.accept_database,'cancel-before-migration':co.cancel}[args.command]
                with modules.bridge.safe_node_environment():result=action(proof)
            elif args.command=='reconcile-candidate':
                proof=accepted_root_document(c,ETC/'paired-database-attestation.json',args.database_sha256)
                result=co.reconcile_candidate(proof,args.snapshot_sha256)
            elif args.command=='select-frontend':
                approval=accepted_root_document(c,ETC/'paired-frontend-approval.json',args.expected_sha256)
                result=co.select_frontend(approval)
            else:
                proof=accepted_root_document(c,ETC/'paired-database-attestation.json',args.database_sha256)
                acceptance=accepted_root_document(c,ETC/'paired-final-approval.json',args.acceptance_sha256)
                report=raw(ETC/'paired-acceptance-report.json')
                if hashlib.sha256(report).hexdigest()!=acceptance.get('acceptanceSha256'):raise ValueError('Actual operator acceptance report missing')
                result=(co.open if args.command=='open' else co.open_recovered)(proof,acceptance)
        print(json.dumps(result,sort_keys=True,allow_nan=False))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Paired release rejected: '+type(error).__name__,file=sys.stderr);sys.exit(1)
