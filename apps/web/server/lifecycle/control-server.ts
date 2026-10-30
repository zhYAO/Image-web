import { createServer, type Server } from 'node:net';
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { getDrainState, readHttpAdmission } from './request-lifecycle';

export const CONTROL_DIRECTORY = '/run/zimage-lifecycle';
export const CONTROL_SOCKET = CONTROL_DIRECTORY + '/control.sock';
// systemd's fixed RuntimeDirectory is private to the service UID/root. This is
// an ordinary Unix socket: reading status can never socket-activate the API.
// The root helper also binds its peer credentials to systemd's exact MainPID.
export function startLifecycleControl(): Promise<void> {
  if (process.env.ZIMAGE_LIFECYCLE_ENABLED !== '1') return Promise.resolve();
  // An enabled management socket must never claim drain without the earlier
  // Node preload observing Next's actual asynchronous HTTP callbacks.
  readHttpAdmission();
  const shared = globalThis as typeof globalThis & { __zimageLifecycleSocket?: Server };
  if (shared.__zimageLifecycleSocket) return Promise.resolve();
  const runtime = lstatSync('/run');
  if (!runtime.isDirectory() || runtime.uid !== 0 || (runtime.mode & 0o022)) throw new Error('Untrusted runtime parent');
  const directory = lstatSync(CONTROL_DIRECTORY);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077)) throw new Error('Lifecycle control requires the private systemd runtime directory');
  if (existsSync(CONTROL_SOCKET)) {
    const stale = lstatSync(CONTROL_SOCKET);
    if (!stale.isSocket() || stale.uid !== directory.uid) throw new Error('Untrusted lifecycle socket path');
    unlinkSync(CONTROL_SOCKET);
  }
  const server = createServer(socket => {
    socket.setTimeout(2000, () => socket.destroy());
    let request = '';
    socket.on('data', data => {
      request += data.toString('utf8');
      if (request.length > 64) { socket.destroy(); return; }
      if (!request.includes('\n')) return;
      if (request !== '{"command":"status"}\n') { socket.destroy(); return; }
      socket.end(JSON.stringify(getDrainState()) + '\n');
    });
    socket.on('error', () => { /* disconnected management reader */ });
  });
  shared.__zimageLifecycleSocket = server;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(CONTROL_SOCKET, () => { chmodSync(CONTROL_SOCKET, 0o600); server.removeListener('error', reject); server.unref(); resolve(); });
  });
}
