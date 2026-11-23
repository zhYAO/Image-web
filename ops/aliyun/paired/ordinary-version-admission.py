"""Admission only: select one pinned dormant receiver image; never execute it."""
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import PurePosixPath
import re
import stat
from types import MappingProxyType

SELECTOR = '/etc/zimage/ordinary-active-version.json'
PINS = '/etc/zimage/ordinary-version-pins.json'
ROOT = '/usr/local/libexec/zimage-ordinary-versions'
ENTRY = 'receive-ordinary-pair'
COMMIT = re.compile('[a-f0-9]{40}')
DIGEST = re.compile('[a-f0-9]{64}')
PART = re.compile('[A-Za-z0-9_-][A-Za-z0-9_.-]*')
MAX_FILE = 2097152
MAX_TOTAL = 32 * MAX_FILE

def require(ok, why):
    if not ok:
        raise ValueError(why)

def parts(path, *, absolute):
    require(type(path) is str and path.startswith('/')==absolute, 'unexpected path kind')
    items = path[1:].split('/') if absolute else path.split('/')
    require(0<len(items)<=24 and all(PART.fullmatch(x) for x in items), 'noncanonical path')
    return items

def unique(items):
    result=dict(items)
    require(len(result)==len(items),'duplicate JSON key')
    return result

def document(body):
    return json.loads(body.decode('utf-8'),object_pairs_hook=unique,
                      parse_constant=lambda x: require(False,'non-finite JSON'))

def directory(fd):
    s=os.fstat(fd)
    require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not s.st_mode & 0o022,
            'untrusted receiver directory')

@contextmanager
def open_tree():
    require(os.name=='posix' and os.geteuid()==0,'receiver needs isolated POSIX root')
    flags=os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW|os.O_DIRECTORY
    root=os.open('/',flags)
    try:
        directory(root)
        def read(path,limit,*,private=False):
            names=parts(path,absolute=True)
            opened=[]
            current=root
            try:
                for name in names[:-1]:
                    current=os.open(name,flags,dir_fd=current)
                    opened.append(current)
                    directory(current)
                fd=os.open(names[-1], os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=current)
                with os.fdopen(fd,'rb') as stream:
                    before=os.fstat(stream.fileno())
                    require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_gid==0 and before.st_nlink==1
                            and not before.st_mode & (0o022|stat.S_ISUID|stat.S_ISGID)
                            and 0<before.st_size<=limit,'untrusted receiver file')
                    require(not private or not before.st_mode & 0o077,'selector and pins must be owner-only')
                    body=stream.read(limit+1)
                    identity=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_nlink,s.st_size,
                                       s.st_mtime_ns,s.st_ctime_ns)
                    require(len(body)==before.st_size and identity(before)==identity(os.fstat(stream.fileno()))
                            ==identity(os.stat(names[-1],dir_fd=current,follow_symlinks=False)),
                            'receiver file changed')
                    return body
            finally:
                for fd in reversed(opened):
                    os.close(fd)
        yield read
    finally:
        os.close(root)

def admit(read, expected_relative):
    # expected_relative is defined in the already authenticated canonical program, never in the selector.
    expected=frozenset(expected_relative)
    require(2<=len(expected)<=64 and ENTRY in expected,'invalid compiled receiver inventory')
    for path in expected:
        parts(path,absolute=False)
    selector_bytes=read(SELECTOR,4096,private=True)
    selected=document(selector_bytes)
    require(type(selected) is dict and set(selected)=={'schemaVersion','version'}
            and type(selected['schemaVersion']) is int and selected['schemaVersion']==1
            and type(selected['version']) is str and COMMIT.fullmatch(selected['version']),
            'invalid receiver selector')
    version=selected['version']
    policy_bytes=read(PINS,65536,private=True)
    policy=document(policy_bytes)
    require(type(policy) is dict and set(policy)=={'schemaVersion','approved'}
            and type(policy['schemaVersion']) is int and policy['schemaVersion']==1
            and type(policy['approved']) is dict and set(policy['approved'])=={version},
            'selected receiver version not exactly approved')
    pins=policy['approved'][version]
    require(type(pins) is dict and set(pins)==expected and all(type(h) is str and DIGEST.fullmatch(h)
            for h in pins.values()),'independent inventory does not match required receiver files')
    admitted={}
    total=0
    for rel in sorted(expected):
        body=read(ROOT+'/'+version+'/'+rel,MAX_FILE)
        total+=len(body)
        require(total<=MAX_TOTAL and hmac.compare_digest(hashlib.sha256(body).hexdigest(),pins[rel]),
                'receiver bytes rejected: '+rel)
        admitted[rel]=body
    require(read(SELECTOR,4096,private=True)==selector_bytes and read(PINS,65536,private=True)==policy_bytes,
            'receiver policy changed during admission')
    return version, MappingProxyType(admitted)

def admit_installed(expected_relative):
    with open_tree() as read:
        return admit(read,expected_relative)
