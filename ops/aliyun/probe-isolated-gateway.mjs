// Run INSIDE a pinned probe container with the same network/config as candidate,
// before launching candidate code. Mount the public CA via NODE_EXTRA_CA_CERTS.
import { lookup } from 'node:dns/promises';
import { access, writeFile, unlink } from 'node:fs/promises';
import net from 'node:net';
import { isIPv4 } from 'node:net';
const [bridge] = process.argv.slice(2);
if (process.argv.length !== 3 || !isIPv4(bridge) || !/^172\.(?:1[6-9]|2[0-9]|3[01])\./.test(bridge) ||
    !process.env.NODE_EXTRA_CA_CERTS || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  throw new Error('Expected pinned isolated gateway and enabled TLS');
}
const addresses = await lookup('zimage-fixture-gateway', { all: true });
if (addresses.length !== 1 || addresses[0].address !== bridge || addresses[0].family !== 4) {
  throw new Error('Gateway name does not resolve to exact isolated bridge address');
}
const request = route => fetch('https://zimage-fixture-gateway:8443' + route, {
  redirect: 'error', signal: AbortSignal.timeout(5000),
});
const denied = await request('/auth/v1/admin/users');
if (denied.status !== 403) throw new Error('Gateway admin path accepted');
await denied.body?.cancel();
function reachable(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}
if (process.env.ZIMAGE_SYNTHETIC_NET_PROBE === '1') {
  const exact = await request('/auth/v1/user');
  if (exact.status !== 200 || (await exact.json()).syntheticBoundary !== true ||
      process.getuid?.() !== 65532 || process.versions.node !== '24.19.0') throw new Error('Wrong trusted fixture result');
  for (const mounted of ['/proof.mjs', '/fixture-ca.pem', '/node']) {
    let denied = false;
    try { await writeFile(mounted, 'unexpected', { flag: 'a' }); }
    catch (error) { if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error; denied = true; }
    if (!denied) throw new Error('Reviewed mount was writable');
  }
  await writeFile('/tmp/probe-scratch', 'local', { flag: 'wx' });
  await unlink('/tmp/probe-scratch');
  if (await access('/var/run/docker.sock').then(() => true, () => false)) throw new Error('Unexpected Docker socket');
}
const forbidden = [[bridge, 54321], [bridge, 54322], [bridge, 55421], [bridge, 55422], [bridge, 2375], [bridge, 2376], [bridge, 22],
  ['169.254.169.254', 80], ['100.100.100.200', 80], ['1.1.1.1', 443]];
const observations = await Promise.all(forbidden.map(([ip, port]) => reachable(ip, port)));
if (observations.some(Boolean)) throw new Error('Unexpected direct network access');
console.log('Pinned TLS and restricted route verified; sampled direct routes unavailable');
