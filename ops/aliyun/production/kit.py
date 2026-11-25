"""Create an exclusive version directory, or verify it before running installed code."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import stat
import sys
import tempfile

VERSIONS = Path('/usr/local/libexec/zimage-production/versions')
FILES = {
    **{name: 'production/'+name for name in ('kit.py', 'receive.py', 'check.py', 'space.py')},
    **{'backend/'+name: 'backend/'+name for name in
       ('release.py', 'transaction.py', 'http-admission.cjs', 'next-source-profiles.json')},
    **{'layers/'+name: name for name in ('release-three-layer.py', 'release.py', 'release-layers.py',
       'three-layer-release.py', 'release-transport.py', 'public-image-contract.py', 'release-public-policy.json')},
}


def identity(contents):
    records = {name: hashlib.sha256(body).hexdigest() for name, body in contents.items()}
    return hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def source_contents():
    root = Path(__file__).resolve().parents[1]
    return {name: (root/source).read_bytes() for name, source in FILES.items()}


def stage(parent, expected, contents):
    if identity(contents) != expected:
        raise ValueError('Receiver kit differs from independently reviewed digest')
    destination = parent/expected
    if parent == VERSIONS:
        for path in (parent, *parent.parents):
            trusted(path, True)
    with tempfile.TemporaryDirectory(dir=parent, prefix='.stage-') as tmp:
        staging = Path(tmp)/'kit'
        staging.mkdir()
        staging.chmod(0o755)
        for sub in ('backend', 'layers'):
            (staging/sub).mkdir()
            (staging/sub).chmod(0o755)
        for name, body in contents.items():
            (staging/name).write_bytes(body)
            (staging/name).chmod(0o644)
        publish = runpy.run_path(str(staging/'layers/release-layers.py'))['no_replace_directory']
        publish(staging, destination)
    return destination


def trusted(path, directory):
    info = path.lstat()
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    if (not expected_type(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022
            or (not directory and info.st_nlink != 1)):
        raise ValueError('Receiver requires a root-managed immutable path: '+str(path))


def verify_tree(root):
    for path in (root, *root.parents):
        trusted(path, True)
    for sub in ('.', 'backend', 'layers'):
        directory = root/sub
        trusted(directory, True)
        allowed = {Path(name).name for name in FILES if Path(name).parent == Path(sub)}
        if sub == '.':
            allowed.update(('backend', 'layers'))
        if {p.name for p in directory.iterdir()} != allowed:
            raise ValueError('Unexpected or missing receiver component in '+str(directory))
    for name in FILES:
        trusted(root/name, False)
    if identity({name: (root/name).read_bytes() for name in FILES}) != root.name:
        raise ValueError('Installed receiver digest differs from its pinned directory')


def main(args):
    if args == ['digest']:
        print(identity(source_contents()))
        return 0
    if len(args) == 3 and args[0] == 'stage':
        print(stage(Path(args[2]), args[1], source_contents()))
        return 0
    root = Path(__file__).absolute().parent
    if (args not in ([], ['check']) or root.parent != VERSIONS or os.geteuid() != 0
            or not sys.flags.isolated or not sys.dont_write_bytecode):
        raise ValueError('Use digest, stage DIGEST EXISTING_PARENT, or an exact installed root entrypoint')
    verify_tree(root)
    receiver = runpy.run_path(str(root/'receive.py'))
    if args == ['check']:
        receiver['check_installation']()
        print('Installed kit, attestation verifier, target, loaded unit and live preload checked: '+root.name)
        return 0
    return receiver['main']()


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
