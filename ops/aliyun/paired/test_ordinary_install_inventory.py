import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import sys
import unittest
from unittest.mock import patch

import ordinary_install_inventory as inventory
from test_ordinary_receiver import receiver


class InstallationInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        repository = Path(__file__).resolve().parents[3]
        commit = inventory.git(repository, 'rev-parse', 'HEAD').decode().strip()
        cls.tree = inventory.CommittedTree(repository, commit)
        cls.plan = inventory.build(cls.tree)

    def authenticate_receiver(self):
        self.assertEqual(set(self.plan['receiver']), {path.as_posix() for path in receiver.FILES})
        installed_pins = {str(path): self.plan['receiver'][path.as_posix()] for path in receiver.FILES}

        def read(path, limit):
            if path == receiver.INVENTORY:
                body = json.dumps(installed_pins).encode()
            else:
                entry = self.plan['files'][path.as_posix()]
                body = self.tree.blob(PurePosixPath(entry['source']), executable=entry['gitExecutable'])
            self.assertLessEqual(len(body), limit)
            return body

        pins, bodies = receiver.authenticate(read)
        self.assertEqual(pins, installed_pins)
        return bodies

    def test_receiver_authenticates_exact_committed_closure(self):
        self.authenticate_receiver()
        self.assertTrue(self.plan['files'][str(inventory.BASE / 'ssh-publish')]['gitExecutable'])

    @unittest.skipUnless(os.name == 'posix', 'Requires POSIX runtime imports')
    def test_receiver_loads_exact_committed_runtime_in_order(self):
        bodies = self.authenticate_receiver()
        with patch.dict(sys.modules):
            for name, filename in receiver.MODULES:
                path = receiver.RUNTIME / filename
                receiver.source(name, path, bodies[path])
            self.assertTrue(callable(sys.modules['github_protected_merge_observe'].observe))

    @unittest.skipUnless(os.name == 'posix', 'Requires the native paired CLI module')
    def test_paired_file_pins_match_legacy_cli_inventory(self):
        path = Path(__file__).with_name('cli.py')
        spec = importlib.util.spec_from_file_location('test_paired_cli_inventory', path)
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        self.assertEqual(set(self.plan['paired']), {str(path) for path in cli.tool_paths()})
        for path in self.plan['receiver'].keys() & self.plan['paired'].keys():
            self.assertEqual(self.plan['receiver'][path], self.plan['paired'][path])
