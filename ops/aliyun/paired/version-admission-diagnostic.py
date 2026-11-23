"""Replay selector admission only, in separate disposable Linux guests."""
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tarfile

here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('diagnostic',here/'versioned-layout-diagnostic.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

def main():
    d.require(sys.platform=='linux' and len(sys.argv)==2 and sys.argv[1]==d.IMAGE,'exact Linux image required')
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w') as tar:
        for f in ('ordinary-version-admission.py','test-version-admission.py'):
            d.put(tar,f,(here/f).read_bytes())
    docker=('docker','--host','unix:///var/run/docker.sock')
    env={k:v for k,v in os.environ.items() if not k.startswith('DOCKER_')}
    cases=[('0:0','--disposable-root'),('65534:0','--untrusted-uid'),('0:65534','--untrusted-gid')]
    for user,case in cases:
        cid=d.run(*docker,'create','--pull=never','--network=none','--cap-drop=ALL',
                  '--security-opt=no-new-privileges','--pids-limit=64','--memory=128m','--user='+user,
                  '--entrypoint=/usr/local/bin/python3',d.IMAGE,'-I','-B',
                  '/tmp/test-version-admission.py',case,env=env).decode().strip()
        d.require(re.fullmatch('[0-9a-f]{64}',cid),'invalid container ID')
        try:
            result=json.loads(d.run(*docker,'inspect',cid,env=env))[0]
            cfg=result['HostConfig']
            d.require(not result['Mounts'] and not cfg['Privileged'] and cfg['NetworkMode']=='none'
                      and cfg['CapDrop']==['ALL'] and result['Config']['User']==user,'unsafe guest')
            d.run(*docker,'cp','-',cid+':/tmp',input=data.getvalue(),env=env)
            out=d.run(*docker,'start','-a',cid,env=env)
            d.require(out.splitlines().count(('SELECTOR_GUEST_PASSED '+case).encode())==1,'guest evidence missing')
            print(out.decode(),end='')
        finally:
            d.run(*docker,'rm','-f',cid,env=env)

if __name__=='__main__':
    main()
