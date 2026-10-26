// HTTP contract against the actual standalone build, without browser automation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const dist = path.resolve(process.argv[2] ?? 'apps/web/.next');
const entry = path.join(dist, 'standalone/apps/web/server.js');
await access(entry);
const reservation = net.createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const { port } = reservation.address();
await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, [entry], {
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const exited = once(child, 'exit');
const base = `http://127.0.0.1:${port}`;
const request = (route, options = {}) => fetch(base + route, {
  redirect: 'manual', signal: AbortSignal.timeout(10000), ...options,
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(child.exitCode, null, 'standalone server exited during startup');
    try {
      const response = await request('/api/health/ready');
      await response.body?.cancel();
      if (response.status === 200) { ready = true; break; }
    } catch { /* Only wait for this child to start; route assertions never retry. */ }
    await delay(250);
  }
  assert.ok(ready, 'standalone readiness did not return HTTP 200');
  const cases = [
    ['GET', '/create/batch', 'application/json', 'Mozilla/5.0', 404],
    ['GET', '/create/batch', 'text/html', 'Mozilla/5.0', 404],
    ['GET', '/create/batch', 'text/html', 'Googlebot', 404],
    ['HEAD', '/create/batch', 'text/html', 'Mozilla/5.0', 404],
    ['GET', '/create/batch?scene=detail', 'text/html', 'Mozilla/5.0', 404],
    ['GET', '/home', 'text/html', 'Mozilla/5.0', 200],
    ['GET', '/create/product-set', 'text/html', 'Mozilla/5.0', 200],
  ];
  const failures = [];
  for (const [method, route, accept, userAgent, expected] of cases) {
    const response = await request(route, { method, headers: { Accept: accept, 'User-Agent': userAgent } });
    const body = await response.text();
    const result = { method, route, accept, userAgent, expected, actual: response.status,
      noindex: /name="robots" content="noindex"/.test(body) };
    console.log(JSON.stringify(result));
    if (response.status !== expected) failures.push(result);
  }
  assert.deepEqual(failures, [], 'built HTTP route contract failed');
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), delay(3000, false)]);
  if (!stopped) { child.kill('SIGKILL'); await exited; }
}
