"""Offline font activation gates. No deployment, service or network operations."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

# Windows has no fcntl. These tests never call locking or CLI main; a bare
# import placeholder permits testing pure gates without pretending flock works.
try:
    import fcntl
except ModuleNotFoundError:
    sys.modules['fcntl'] = types.ModuleType('fcntl')
spec = importlib.util.spec_from_file_location('font_gate_release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class FontPreflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / 'candidate'
        self.target.mkdir()
        self.config = self.root / 'font-assets.env'
        self.env = {'ZIMAGE_SHARED_FONT_DIR': str(self.root / ('a' * 64) / 'fonts'),
                    'ZIMAGE_STATIC_ASSET_SHA256': 'a' * 64}
        self.patch = patch.object(release, 'FONT_ENV', self.config, create=True)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def put(self, values=None, target=None):
        file = target or self.config
        file.write_text(''.join(k + '=' + v + '\n' for k, v in (values or self.env).items()))
        file.chmod(0o600)
        return file

    def test_missing_config_fails_before_probe_or_switch(self):
        with patch.object(release, 'native_probe', create=True) as probe, patch.object(release, 'switch') as switch:
            with self.assertRaisesRegex(ValueError, 'font-assets|字体|font'):
                release.font_preflight(self.target)
            probe.assert_not_called()
            switch.assert_not_called()

    def test_partial_duplicate_unknown_and_relative_configuration_fail(self):
        invalid = [
            'ZIMAGE_SHARED_FONT_DIR=/tmp/fonts\n',
            'ZIMAGE_STATIC_ASSET_SHA256=' + 'a' * 64 + '\n',
            'ZIMAGE_SHARED_FONT_DIR=relative/fonts\nZIMAGE_STATIC_ASSET_SHA256=' + 'a' * 64 + '\n',
            'ZIMAGE_SHARED_FONT_DIR=/tmp/fonts\nZIMAGE_SHARED_FONT_DIR=/tmp/fonts\n',
            'OTHER_SECRET=not-supported\n',
        ]
        for body in invalid:
            with self.subTest(body=body):
                self.config.write_text(body)
                self.config.chmod(0o600)
                with self.assertRaises(ValueError):
                    release.font_preflight(self.target)

    def test_probe_failure_does_not_write_runtime_binding(self):
        self.put()
        with patch.object(release, 'service_font_preflight', create=True), \
             patch.object(release, 'native_probe', side_effect=RuntimeError('font digest'), create=True):
            with self.assertRaisesRegex(RuntimeError, 'font digest'):
                release.font_preflight(self.target)
        self.assertFalse((self.target / '.runtime-assets.env').exists())

    def test_bad_retained_binding_never_falls_back_to_global_config(self):
        self.put()
        (self.target / '.runtime-assets.env').write_text('ZIMAGE_STATIC_ASSET_SHA256=bad\n')
        with patch.object(release, 'native_probe') as probe:
            with self.assertRaises(ValueError):
                release.font_preflight(self.target)
            probe.assert_not_called()

    def test_three_layer_wrapper_reuses_full_package_native_probe(self):
        adapter_spec = importlib.util.spec_from_file_location('font_gate_adapter', Path(__file__).with_name('release-three-layer.py'))
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
        runner = Mock(return_value=types.SimpleNamespace(returncode=0, stdout='{"native":true,"fonts":2,"codecs":6}'))
        adapter.native_probe(self.target, self.env, runner=runner)
        command = runner.call_args.args[0]
        self.assertEqual(command[:4], ['/usr/sbin/runuser', '--user', 'zimage', '--'])
        self.assertEqual(command[-1], release.NATIVE_PROBE)
        self.assertEqual(runner.call_args.kwargs['env'], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'})

    def test_full_and_layered_probes_execute_only_the_fixed_trusted_node(self):
        spec = importlib.util.spec_from_file_location('trusted_node_adapter', Path(__file__).with_name('release-three-layer.py'))
        adapter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(adapter)
        expected = Path('/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node')
        for module in (release, adapter):
            with self.subTest(module=module.__name__):
                self.assertEqual(module.NODE, expected)
                runner = Mock(return_value=types.SimpleNamespace(returncode=0, stdout='{"native":true,"fonts":2,"codecs":6}'))
                module.native_probe(self.target, self.env, runner=runner)
                command = runner.call_args.args[0]
                self.assertEqual(command[-3:], [str(expected), '-e', release.NATIVE_PROBE])
                self.assertIn('PATH=' + str(expected.parent) + ':/usr/sbin:/usr/bin:/sbin:/bin', command)

    def test_service_template_matches_the_fixed_trusted_probe_node(self):
        source = Path(__file__).with_name('zimage.service').read_text()
        self.assertIn('ExecStart=/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node server.js\n', source)
        self.assertNotIn('ExecStart=/opt/zimage/toolchain/', source)

    def test_success_pins_pair_only_after_checks_and_rechecks_retained_pair(self):
        self.put()
        events = []
        with patch.object(release, 'service_font_preflight', side_effect=lambda: events.append('service'), create=True), \
             patch.object(release, 'native_probe', side_effect=lambda *args: events.append('native'), create=True) as probe:
            release.font_preflight(self.target)
            self.assertEqual(events, ['service', 'native'])
            self.assertEqual(probe.call_args.args, (self.target, self.env))
            self.assertEqual((self.target / '.runtime-assets.env').read_text(), self.config.read_text())
            self.config.unlink()
            release.font_preflight(self.target)
            self.assertEqual(probe.call_count, 2)

    def test_activation_failure_does_not_touch_current_previous_or_service(self):
        with patch.object(release, 'font_preflight', side_effect=ValueError('missing font'), create=True), \
             patch.object(release, 'switch') as switch, patch.object(release, 'wait_healthy') as health, \
             patch.object(release, 'CURRENT') as current, patch.object(release, 'PREVIOUS') as previous:
            with self.assertRaisesRegex(ValueError, 'missing font'):
                release.activate(self.target)
            switch.assert_not_called()
            health.assert_not_called()
            current.resolve.assert_not_called()
            previous.assert_not_called()

    def test_service_requires_assets_env_last_and_correct_identity(self):
        good = '/etc/zimage/environment (ignore_errors=no) /opt/zimage/current/.runtime-assets.env (ignore_errors=yes)'
        for values, valid in [(['zimage', 'zimage', good], True),
                              (['root', 'zimage', good], False),
                              (['zimage', 'zimage', '/etc/zimage/environment (ignore_errors=no)'], False),
                              (['zimage', 'zimage', good + ' /etc/override.env (ignore_errors=no)'], False)]:
            with self.subTest(values=values), patch.object(release.subprocess, 'check_output', side_effect=values):
                if valid:
                    release.service_font_preflight()
                else:
                    with self.assertRaises(ValueError):
                        release.service_font_preflight()


if __name__ == '__main__':
    unittest.main()
