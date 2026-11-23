"""Print committed-source install inventories without installing or authorizing a release."""
import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess


SOURCE = PurePosixPath('ops/aliyun')
PAIRED = SOURCE / 'paired'
BASE = PurePosixPath('/usr/local/libexec/zimage-paired-release')
RUNTIME = BASE / 'ordinary-runtime'
BACKEND = PurePosixPath('/usr/local/libexec/zimage-backend')
LAYERS = PurePosixPath('/usr/local/libexec/zimage-three-layer')
FRONTEND = PurePosixPath('/opt/zimage/frontend-tools')
MAX_BLOB = 2_097_152
COMMIT = re.compile('[a-f0-9]{40}')
PATH = re.compile(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*')


def git(repository, *args):
    return subprocess.run(['git', '--no-replace-objects', '-C', str(repository), *args], stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=15).stdout


class CommittedTree:
    def __init__(self, repository, commit):
        if not COMMIT.fullmatch(commit) or git(repository, 'cat-file', '-t', commit) != b'commit\n':
            raise ValueError('Review an exact Git commit before building inventories')
        self.repository, self.commit = repository, commit
        self.entries, self.cache = {}, {}
        for line in git(repository, 'ls-tree', '-rz', commit, '--', str(SOURCE)).split(b'\0'):
            if line:
                identity, name = line.split(b'\t', 1)
                mode, kind, object_id = identity.decode('ascii').split(' ')
                self.entries[PurePosixPath(name.decode('utf-8'))] = (mode, kind, object_id)

    def blob(self, source, *, executable=False):
        mode, kind, identity = self.entry(source)
        if kind != 'blob' or mode != ('100755' if executable else '100644'):
            raise ValueError('Installed source must be a committed regular file with its reviewed executable bit')
        if identity not in self.cache:
            size = int(git(self.repository, 'cat-file', '-s', identity))
            if not 0 < size <= MAX_BLOB:
                raise ValueError('Installed source exceeds the receiver size bound')
            body = git(self.repository, 'cat-file', 'blob', identity)
            if len(body) != size:
                raise ValueError('Committed source size changed')
            self.cache[identity] = body
        return self.cache[identity]

    def entry(self, source):
        if source not in self.entries:
            raise ValueError('Missing committed install source: ' + str(source))
        return self.entries[source]


def runtime_names(receiver):
    """Read the two declared source lists without running receiver code."""
    declarations = {}
    for node in ast.parse(receiver).body:
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ('MODULES', 'INTAKE_FILES')):
            name = node.targets[0].id
            if name in declarations:
                raise ValueError('Duplicate installed source declaration')
            declarations[name] = ast.literal_eval(node.value)
    names = tuple(name for _, name in declarations['MODULES']) + declarations['INTAKE_FILES']
    if len(names) != len(set(names)) or any(not PATH.fullmatch(name) or {'.', '..'}.intersection(name.split('/')) for name in names):
        raise ValueError('Invalid installed receiver source')
    return names


def paired_sources():
    groups = (
        (BASE, PAIRED, ('cli.py', 'core.py', 'system.py', 'stage.py')),
        (BACKEND, SOURCE / 'backend', ('release.py', 'receipt.py', 'transaction.py', 'first-window.py',
                                      'first_window.py', 'frontend_bootstrap.py', 'http-admission.cjs',
                                      'next-source-profiles.json')),
        (LAYERS, SOURCE, ('release-three-layer.py', 'release.py', 'release-layers.py', 'three-layer-release.py',
                          'release-transport.py', 'release-public-policy.json', 'public-image-contract.py')),
        (FRONTEND, SOURCE / 'frontend', ('release.py', 'manifest.py', 'transport.py')),
    )
    return {directory / name: source / name for directory, source, names in groups for name in names}


def build(tree):
    receiver = PAIRED / 'receive-ordinary-pair'
    receiver_sources = {BASE / receiver.name: receiver, BASE / 'cli.py': PAIRED / 'cli.py'}
    for name in runtime_names(tree.blob(receiver, executable=True)):
        relative = PurePosixPath(name)
        if name == 'ordinary_readonly_transport.py':
            source = SOURCE / 'backend' / relative
        elif PAIRED / relative in tree.entries:
            source = PAIRED / relative
        else:
            source = SOURCE / relative
        receiver_sources[RUNTIME / relative] = source
    shared = paired_sources()
    forced = BASE / 'ssh-publish'
    sources = shared | receiver_sources | {forced: PAIRED / 'ssh-publish'}
    files = {}
    for installed, source in sources.items():
        executable = installed in (BASE / receiver.name, forced) or tree.entry(source)[0] == '100755'
        digest = hashlib.sha256(tree.blob(source, executable=executable)).hexdigest()
        files[str(installed)] = {'source': str(source), 'sha256': digest, 'gitExecutable': executable}

    def pins(paths):
        return {str(path): files[str(path)]['sha256'] for path in paths}

    return {'schemaVersion': 1, 'commit': tree.commit,
            'receiver': pins(receiver_sources), 'paired': pins(shared), 'files': files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('commit', help='Exact reviewed 40-character Git commit')
    parser.add_argument('--section', choices=('receiver', 'paired', 'files'))
    args = parser.parse_args()
    data = build(CommittedTree(Path(__file__).resolve().parents[3], args.commit))
    print(json.dumps(data[args.section] if args.section else data, sort_keys=True, indent=2))


if __name__ == '__main__':
    main()
