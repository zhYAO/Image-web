"""Disposable validation of a dormant versioned receiver, not a launch test."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

SHA = 'c12a59405905ce05ba3a3ca39070f1e8c7382cc0'
IMAGE = 'docker.io/library/python@sha256:e8c69d86735f6df3efa06b324694fe51f0422785f83a3bd463052636c2421944'
HERE = Path(__file__).resolve().parent
PREFIXES = ('/usr/local/libexec/zimage-paired-release/', '/usr/local/libexec/zimage-backend/',
            '/usr/local/libexec/zimage-three-layer/', '/opt/zimage/frontend-tools/')

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

def require(ok, msg):
    if not ok:
        raise RuntimeError(msg)

def put(tar, name, data, mode=0o644):
    file = tarfile.TarInfo(name)
    file.size, file.mode = len(data), mode
    tar.addfile(file, io.BytesIO(data))

def bundle(repo):
    g = load(HERE/'ordinary_install_inventory.py','inventory')
    tree = g.CommittedTree(repo,SHA)
    manifest = g.build(tree)
    runtime = set(manifest['receiver']) - set(manifest['paired'])
    require(manifest['commit']==SHA and len(runtime)==27 and len(manifest['files'])==50,
            'wrong candidate or source inventory size')
    data = io.BytesIO()
    with tarfile.open(fileobj=data,mode='w') as tar:
        for dst, entry in sorted(manifest['files'].items()):
            require(dst.startswith(PREFIXES) and '..' not in PurePosixPath(dst).parts, 'escaped canonical layout')
            body = tree.blob(PurePosixPath(entry['source']),executable=entry['gitExecutable'])
            require(hashlib.sha256(body).hexdigest()==entry['sha256'], 'source differs')
            put(tar,'zimage-version-fixture/files'+dst,body,0o755 if entry['gitExecutable'] else 0o644)
        put(tar,'zimage-version-fixture/manifest.json',json.dumps(manifest).encode())
        for f in ('versioned-install-preflight.py','test-versioned-preflight.py'):
            put(tar,'zimage-version-fixture/'+f,(HERE/f).read_bytes())
    return data.getvalue()

def run(*argv, **kwargs):
    return subprocess.run(argv,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90,**kwargs).stdout

def main():
    require(sys.platform=='linux' and len(sys.argv)==3 and sys.argv[2]==IMAGE, 'exact isolated Linux image required')
    payload = bundle(Path(sys.argv[1]))
    docker = ('docker','--host','unix:///var/run/docker.sock')
    env = {k:v for k,v in os.environ.items() if not k.startswith('DOCKER_')}
    for user, case, expected in [('0:0',[],b'VERSIONED_ROOT_TESTS_PASSED'),
                                 ('65534:65534',['Tests.test_posix_version_root_owner'],b'VERSIONED_UID_REJECTION_PASSED')]:
        cid = run(*docker,'create','--pull=never','--network=none','--cap-drop=ALL',
                  '--security-opt=no-new-privileges','--pids-limit=64','--memory=384m','--user='+user,
                  '--entrypoint=/usr/local/bin/python3',IMAGE,'-I','-B',
                  '/tmp/zimage-version-fixture/test-versioned-preflight.py','--isolated-fixture',*case,env=env).decode().strip()
        require(re.fullmatch('[0-9a-f]{64}',cid),'unexpected container identity')
        try:
            result=json.loads(run(*docker,'inspect',cid,env=env))[0]
            cfg=result['HostConfig']
            require(not result['Mounts'] and not cfg['Privileged'] and cfg['NetworkMode']=='none'
                    and cfg['CapDrop']==['ALL'] and result['Config']['User']==user,'unexpected isolation policy')
            run(*docker,'cp','-',cid+':/tmp',input=payload,env=env)
            out=run(*docker,'start','-a',cid,env=env)
            require(out.splitlines().count(expected)==1,'missing exact version fixture assertion')
            print(out.decode(),end='')
        finally:
            run(*docker,'rm','-f',cid,env=env)

if __name__=='__main__':
    main()
