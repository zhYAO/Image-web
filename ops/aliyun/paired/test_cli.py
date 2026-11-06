import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
import tempfile
import py_compile
import hashlib

spec=importlib.util.spec_from_file_location('paired_cli',Path(__file__).with_name('cli.py'))
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)


class CliTests(unittest.TestCase):
    def test_parser_has_only_fixed_steps_and_digest_inputs(self):
        for command in ['begin','status','challenge','seal','start-candidate']:
            self.assertEqual(cli.parser().parse_args([command]).command,command)
        for args in [['open','--url','https://elsewhere.test'],['stage','/tmp/archive'],['exec','sh'],['begin','--root','/tmp']]:
            with self.subTest(args=args),self.assertRaises(SystemExit):cli.parser().parse_args(args)

    def test_root_preflight_refuses_checkout_even_if_run_as_root(self):
        with self.assertRaises(ValueError):cli.preflight_location(Path(__file__),uid=0,isolated=True)

    def test_root_preflight_refuses_nonisolated_or_nonroot(self):
        path=Path('/usr/local/libexec/zimage-paired-release/cli.py')
        for uid,isolated in [(501,True),(0,False)]:
            with self.subTest(uid=uid,isolated=isolated),self.assertRaises(ValueError):cli.preflight_location(path,uid=uid,isolated=isolated)

    def test_help_does_not_import_or_touch_production_helpers(self):
        r=subprocess.run([sys.executable,'-I',str(Path(__file__).with_name('cli.py')),'--help'],capture_output=True,text=True)
        self.assertEqual(r.returncode,0);self.assertIn('authorize-migration',r.stdout)

    def test_unapproved_code_is_not_executed_before_hash_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sentinel=root/'executed';source=root/'core.py';mapping=root/'tools.json'
            source.write_text('from pathlib import Path\nPath('+repr(str(sentinel))+').touch()\n')
            mapping.write_text(__import__('json').dumps({str(source):'0'*64}))
            with patch.object(cli,'HERE',root),patch.object(cli,'TOOLS',mapping),patch.object(cli,'tool_paths',return_value=[source]),patch.object(cli,'trusted',lambda *args,**kw:None):
                try:cli.authenticate()
                except Exception:pass
            self.assertFalse(sentinel.exists(),'Code hash must be checked BEFORE loading core')

    def test_review_valid_unchecked_pyc_cannot_replace_reviewed_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'child.py'
            source.write_text("RESULT='cached-unreviewed'\n")
            py_compile.compile(str(source),invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
            source.write_text("RESULT='reviewed-source'\n")
            with patch.object(cli,'trusted',lambda *args,**kw:None):
                loaded=cli.load(source,'untrusted_bytecode_fixture')
            self.assertEqual(loaded.RESULT,'reviewed-source')

    def test_review_nested_existing_loaders_execute_only_approved_source_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);child=root/'child.py';parent=root/'parent.py'
            child.write_text("RESULT='cached-unreviewed'\n")
            py_compile.compile(str(child),invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
            child.write_text("RESULT='reviewed-source'\n")
            parent.write_text("import importlib.util\ns=importlib.util.spec_from_file_location('nested_child',"+repr(str(child))+")\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nRESULT=m.RESULT\n")
            mapping={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (child,parent)}
            with patch.object(cli,'trusted',lambda *args,**kw:None),cli.source_only(mapping):
                loaded=cli.load(parent,'nested_parent')
            self.assertEqual(loaded.RESULT,'reviewed-source')

    def test_root_artifact_checks_cannot_inherit_node_loader_environment(self):
        poison={'PATH':'/tmp/untrusted-bin','NODE_OPTIONS':'--require=/tmp/payload','NODE_PATH':'/tmp/modules','LD_PRELOAD':'/tmp/preload','LD_LIBRARY_PATH':'/tmp/libraries'}
        with patch.dict(os.environ,poison,clear=True):
            with cli.safe_environment():
                self.assertEqual(os.environ['PATH'],'/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin:/usr/sbin:/usr/bin:/sbin:/bin')
                for name in poison.keys()-{'PATH'}:self.assertNotIn(name,os.environ)
                result=subprocess.run(['/usr/bin/printenv'],capture_output=True,text=True,check=True)
                self.assertNotIn('/tmp/',result.stdout)
            self.assertEqual(dict(os.environ),poison)


if __name__=='__main__':unittest.main()
