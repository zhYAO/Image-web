"""Pure independent-artifact cache checks; no fcntl, process, real filesystem or Linux needed."""
import ast
import json
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest import mock

FILE = Path(__file__).with_name('release.py').resolve()
PROFILE = json.loads(FILE.with_name('next-source-profiles.json').read_text())['candidateProfile']


class ContractCacheTests(unittest.TestCase):
    def setup_ops(self):
        tree = ast.parse(FILE.read_text(encoding='utf-8'))
        cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'SystemOps')
        root = Path('C:/isolated-fixture') if __import__('os').name == 'nt' else Path('/isolated-fixture')
        sha = 'a' * 40
        target = root / 'releases' / sha
        helper = FILE.with_name('http-admission.cjs')
        names = [str(target / ('file-' + str(i))) for i in range(13)] + [str(helper), str(helper.with_name('next-source-profiles.json'))]
        signature = ['1'] * 7
        value = dict(release=sha, contract=dict(protocolVersion=2, nextVersion='16.4.5', sourceProfile=PROFILE),
                     files=[dict(path=name, identity=signature) for name in names])
        events = []
        def inspect(argv):
            events.append('inspect')
            self.assertEqual(argv[0], '/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node')
            self.assertEqual(argv[2:], ['inspect', str(target / 'apps/web/server.js')])
            return json.dumps(value).encode()
        scope = dict(__file__=str(FILE), ROOT=root, Path=Path, HEX40=re.compile('[a-f0-9]{40}'),
                     owned=lambda *_: None, json=json, subprocess=SimpleNamespace(check_output=inspect))
        exec(compile(ast.Module(body=[cls], type_ignores=[]), str(FILE), 'exec'), scope)
        adapter = SimpleNamespace(verify_retained_layered=lambda *_, **kwargs: events.append(('closure',kwargs.get('run_probe'))))
        return scope['SystemOps'](adapter, None), sha, events

    def test_expectation_is_independent_cached_and_immutable(self):
        ops, sha, events = self.setup_ops()
        info = SimpleNamespace(st_dev=1, st_ino=1, st_size=1, st_mtime_ns=1, st_ctime_ns=1, st_mode=1, st_uid=1)
        with mock.patch.object(Path, 'stat', return_value=info):
            self.assertEqual(ops.framework_contract(sha)['sourceProfile'], PROFILE)
            self.assertEqual(events, [('closure',False), 'inspect'])
            ops.framework_contract(sha)
            self.assertEqual(events, [('closure',False), 'inspect'])
            info.st_ctime_ns = 2
            with self.assertRaisesRegex(ValueError, 'changed after inspection'):
                ops.framework_contract(sha)
            self.assertEqual(events, [('closure',False), 'inspect'], 'must not relearn changed live files')

    def test_invalid_release_never_reaches_inspection(self):
        ops, _, events = self.setup_ops()
        with self.assertRaises(ValueError):
            ops.framework_contract('../other')
        self.assertEqual(events, [])


if __name__ == '__main__':
    unittest.main()
