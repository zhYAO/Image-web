"""Read-only preactivation check for a versioned ordinary receiver image."""
import argparse, hashlib, importlib.util, json, os, re, stat
from pathlib import Path

PREFIX = '/usr/local/libexec/zimage-paired-release/'
def exact(condition, why):
    if not condition:
        raise ValueError(why)

def rooted(root, relative, *, directory=False, limit=2097152):
    path = root
    for i, part in enumerate(Path(relative).parts):
        path /= part
        info = path.lstat()
        last = i == len(Path(relative).parts)-1
        exact(not getattr(info, 'st_file_attributes', 0) & 1024 and not stat.S_ISLNK(info.st_mode),
              'link or reparse point: ' + relative)
        if not last or directory:
            exact(stat.S_ISDIR(info.st_mode), 'directory required: ' + relative)
        else:
            exact(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= limit,
                  'bounded single-link regular file required: ' + relative)
    if directory:
        return path
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0) | getattr(os,'O_BINARY',0))
    with os.fdopen(fd,'rb') as f:
        before = os.fstat(f.fileno())
        data = f.read(limit+1)
        after = os.fstat(f.fileno())
    identity = lambda x: (x.st_ino,x.st_dev,x.st_size,x.st_mtime_ns,x.st_ctime_ns,x.st_mode,x.st_nlink)
    current = path.lstat()
    # Windows CRT fstat may omit the NTFS file ID; use it only within each stat family.
    cross = lambda x: (x.st_size, x.st_mtime_ns, x.st_mode)
    exact(len(data)==before.st_size and identity(info)==identity(current) and identity(before)==identity(after)
          and (identity(info)==identity(before) if os.name!='nt' else cross(info)==cross(before)),
          'file changed: ' + relative)
    return data

def preflight(m, image, incumbent, before):
    commit = m['commit']
    exact(re.fullmatch('[0-9a-f]{40}',commit), 'exact commit required')
    exact(image.name == commit and image.parent.name == 'ordinary-versions', 'version directory required')
    exact(image.resolve() == image.absolute() and incumbent.resolve() == incumbent.absolute(), 'linked root')
    exact(image.is_dir() and incumbent.is_dir() and incumbent != image
          and incumbent not in image.parents and image not in incumbent.parents, 'isolated roots required')
    runtime = {p: h for p,h in m['receiver'].items() if p not in m['paired']}
    shared = dict(m['paired'])
    forced = PREFIX + 'ssh-publish'
    shared[forced] = m['files'][forced]['sha256']
    exact(set(runtime).isdisjoint(shared) and set(runtime)|set(shared)==set(m['files']),
          'receiver/shared inventory classification mismatch')
    exact(set(before)==set(m['files']), 'baseline must cover shared paths and all canonical live receiver paths')
    if os.name == 'posix':
        for p in (image.parent,image,incumbent):
            meta=p.lstat()
            exact(meta.st_uid==0 and not meta.st_mode & 0o022,'untrusted POSIX root')
    exact(all(p.startswith(PREFIX) and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',p[len(PREFIX):])
                 and not {'.','..'}.intersection(p[len(PREFIX):].split('/')) for p in runtime),
          'unrecognized staged destination')
    expected = {p[len(PREFIX):]: h for p,h in runtime.items()}
    actual = set()
    for parent, ds, fs in os.walk(image, followlinks=False):
        for d in ds:
            rel = (Path(parent)/d).relative_to(image).as_posix()
            rooted(image,rel,directory=True)
            exact(any(f.startswith(rel+'/') for f in expected),'unexpected staged directory: '+rel)
        actual.update((Path(parent)/f).relative_to(image).as_posix() for f in fs)
    exact(actual==set(expected),'missing or extraneous staged paths')
    for p,h in expected.items():
        exact(hashlib.sha256(rooted(image,p)).hexdigest()==h,'candidate digest mismatch: '+p)
        if os.name == 'posix':
            mode=(image/p).lstat().st_mode
            exact(bool(mode & 0o111)==m['files'][PREFIX+p]['gitExecutable'] and not mode & 0o022 and (image/p).lstat().st_uid == 0,
                  'candidate file mode mismatch: '+p)
    incompatible=[]
    for p in before:
        h=shared.get(p)
        try:
            observed=hashlib.sha256(rooted(incumbent,p.lstrip('/'))).hexdigest()
        except FileNotFoundError:
            observed=None
        exact(observed==before[p], 'incumbent changed during rehearsal: '+p)
        if p in shared and observed!=h:
            incompatible.append(p)
    return dict(commit=commit, stageLayoutVerified=True, staged=len(expected), sharedUnchanged=len(shared),
                canonicalPathsUnchanged=len(before), sharedIncompatible=sorted(incompatible), activated=False, productionReady=False)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('generator','repository','image','incumbent','baseline'):
        parser.add_argument('--'+key,required=True,type=Path)
    parser.add_argument('commit')
    a=parser.parse_args()
    spec=importlib.util.spec_from_file_location('inventory',a.generator)
    g=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)
    m=g.build(g.CommittedTree(a.repository,a.commit))
    print(json.dumps(preflight(m,a.image,a.incumbent,json.loads(a.baseline.read_text())),sort_keys=True))

if __name__=='__main__':
    main()
