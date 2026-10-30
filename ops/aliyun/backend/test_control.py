import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import stat
import struct
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('backend_release_control', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ControlTests(unittest.TestCase):
    def test_stopped_status_never_connects_or_starts_any_service(self):
        ops = release.SystemOps(None, None)
        with patch.object(release.subprocess, 'check_output', return_value='MainPID=0\nActiveState=inactive\n') as query, patch.object(release.socket, 'socket') as socket:
            with self.assertRaises(RuntimeError): ops.status()
            socket.assert_not_called()
            self.assertEqual(query.call_args.args[0][1:3], ['show', 'zimage.service'])

    def fixture(self, peer_pid=101, second_pid=101):
        directory = Mock()
        directory.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=1001)
        socket = Mock()
        socket.__enter__ = Mock(return_value=socket)
        socket.__exit__ = Mock(return_value=False)
        socket.getsockopt.return_value = struct.pack('3i', peer_pid, 1001, 1001)
        socket.recv.return_value = (json.dumps({'pid': 101, 'maintenance': True}) + '\n').encode()
        patches = [patch.object(release.subprocess, 'check_output', side_effect=['MainPID=101\nActiveState=active\n', f'MainPID={second_pid}\nActiveState=active\n']),
                   patch.object(release.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1001)), patch.object(release, 'owned'),
                   patch.object(release, 'SOCKET_DIRECTORY', directory), patch.object(release.os, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600, st_uid=1001)),
                   patch.object(release.socket, 'socket', return_value=socket), patch.object(release.socket, 'SO_PEERCRED', 17, create=True)]
        return socket, patches

    def run_fixture(self, peer_pid=101, second_pid=101):
        socket, patches = self.fixture(peer_pid, second_pid)
        for item in patches: item.start()
        try: return release.SystemOps(None, None).status(), socket
        finally:
            for item in reversed(patches): item.stop()

    def test_kernel_peer_and_response_pid_bind_to_same_live_mainpid(self):
        result, socket = self.run_fixture()
        self.assertEqual(result['pid'], 101)
        socket.sendall.assert_called_once_with(b'{"command":"status"}\n')

    def test_socket_replacement_or_pid_change_fails_closed(self):
        for peer_pid, second_pid in ((999, 101), (101, 999)):
            with self.subTest(peer_pid=peer_pid, second_pid=second_pid):
                with self.assertRaises(RuntimeError): self.run_fixture(peer_pid, second_pid)


class LaunchPreflightTests(unittest.TestCase):
    def test_loaded_service_must_bind_exact_trusted_preload(self):
        command = '/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node --require /usr/local/libexec/zimage-backend/http-admission.cjs server.js'
        with patch.object(release, 'owned'), patch.object(release.subprocess, 'check_output', return_value='{ argv[]=' + command + ' ; }'):
            release.service_launch_preflight()
        for bad in (command.replace('--require /usr/local/libexec/zimage-backend/http-admission.cjs ', ''), command + ' extra', command.replace('node-v24.19.0', 'node-v22.0.0')):
            with patch.object(release, 'owned'), patch.object(release.subprocess, 'check_output', return_value='{ argv[]=' + bad + ' ; }'), self.assertRaises(ValueError):
                release.service_launch_preflight()


if __name__ == '__main__': unittest.main()
