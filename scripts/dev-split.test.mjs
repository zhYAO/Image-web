import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSupervisor, parseSplitOptions } from './dev-split.mjs';
import { descriptorFromMeta, devProxyOptions, localBackendOrigin, readDevRuntime } from '../apps/frontend/build/dev-runtime.mjs';

const sha = 'a'.repeat(40);
const meta = { schemaVersion: 1, backendRelease: sha, api: { major: 1, minor: 0 }, capabilities: ['runtime.meta.v1', 'runtime.public-config.v1'] };
const config = { schemaVersion: 1, formalAuth: true, dataMode: 'http', captchaSiteKey: null, approvedLegalVersion: null, registrationEnabled: false };

test('defaults to two separate loopback listeners without using a remote backend', () => {
  assert.deepEqual(parseSplitOptions([]), { external: false, frontendPort: 5173, backendPort: 7788, backendOrigin: 'http://127.0.0.1:7788', expectedSHA: undefined, frontendOrigin: 'http://127.0.0.1:5173' });
  assert.throws(() => parseSplitOptions(['--frontend-port', '7788']), /不同端口/);
  assert.throws(() => parseSplitOptions(['--frontend-port', '0']), /1024/);
});
test('an existing backend needs an explicit exact SHA and never claims a spawned backend', () => {
  assert.throws(() => parseSplitOptions(['--backend-origin', 'http://localhost:7788']), /backend-sha/);
  assert.throws(() => parseSplitOptions(['--backend-sha', sha]), /Git HEAD/);
  const options = parseSplitOptions(['--backend-origin', 'http://localhost:7788', '--backend-sha', sha]);
  assert.equal(options.external, true); assert.equal(options.expectedSHA, sha);
});
test('rejects remote, ambiguous, credential-bearing and path-bearing proxy targets', () => {
  for (const origin of ['https://zimage.store', 'http://example.test:7788', 'http://127.0.0.1.evil.test:7788', 'http://user@localhost:7788', 'http://localhost:7788/api', 'http://127.1:7788', 'http://2130706433:7788', 'http://localhost:7788?token=private', 'http://0.0.0.0:7788']) assert.throws(() => localBackendOrigin(origin));
  assert.equal(localBackendOrigin('http://[::1]:7788/'), 'http://[::1]:7788');
});
test('derives candidate requirements from actual metadata and rejects mismatched or fabricated identities', () => {
  assert.deepEqual(descriptorFromMeta(meta, sha), { apiRequirements: { major: 1, minMinor: 0, capabilities: meta.capabilities }, allowedBackendReleases: [sha] });
  for (const invalid of [{ ...meta, backendRelease: 'b'.repeat(40) }, { ...meta, api: { major: 2, minor: 0 } }, { ...meta, capabilities: ['runtime.meta.v1'] }, { ...meta, verified: true }]) assert.throws(() => descriptorFromMeta(invalid, sha));
});
test('waits only through startup 503s, then returns a verified descriptor using safe GETs', async () => {
  const calls = [];
  const descriptor = await readDevRuntime('http://127.0.0.1:7788', sha, {
    pollMs: 1, timeoutMs: 1000,
    request: async (url, options) => {
      calls.push([url, options]);
      return calls.length <= 2 ? new Response(null, { status: 503 }) : Response.json(url.endsWith('/meta') ? meta : config);
    },
  });
  assert.deepEqual(descriptor.allowedBackendReleases, [sha]); assert.equal(calls.length, 4);
  for (const [url, options] of calls) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:7788\/api\/(meta|public-config)$/);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.headers, { accept: 'application/json' });
  }
});
test('fails rather than substituting Mock, anonymous configuration or a wrong backend SHA', async () => {
  for (const invalid of [{ ...config, dataMode: 'mock' }, { ...config, formalAuth: false }]) {
    await assert.rejects(readDevRuntime('http://localhost:7788', sha, { request: async url => Response.json(url.endsWith('/meta') ? meta : invalid) }), /真实 HTTP/);
  }
  await assert.rejects(readDevRuntime('http://localhost:7788', 'b'.repeat(40), { request: async url => Response.json(url.endsWith('/meta') ? meta : config) }), /身份或 API/);
  await assert.rejects(readDevRuntime('http://localhost:7788', sha, { request: async () => new Response(null, { status: 404 }) }), /运行时接口不可用/);
});
test('startup deadline and cancellation remain bounded', async () => {
  await assert.rejects(readDevRuntime('http://localhost:7788', sha, { timeoutMs: 10, pollMs: 1, request: async () => new Response(null, { status: 503 }) }), /未就绪/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readDevRuntime('http://localhost:7788', sha, { signal: controller.signal, request: async () => { throw new Error('must not fetch'); } }), { name: 'AbortError' });
});
test('proxy keeps Host and Origin unchanged and does not set a streaming deadline', () => {
  const proxy = devProxyOptions('http://127.0.0.1:7788')['^/api(?:/|$)'];
  assert.equal(proxy.changeOrigin, false); assert.equal(proxy.xfwd, false);
  assert.equal(proxy.timeout, 0); assert.equal(proxy.proxyTimeout, 0);
  assert.equal(proxy.selfHandleResponse, undefined); assert.equal(proxy.headers, undefined);
});
function supervisorFixture() {
  const signals = new EventEmitter(), living = new Set(), calls = [];
  const supervisor = createSupervisor({ signals, alive: child => living.has(child), terminate: (child, signal) => { calls.push([child.pid, signal]); living.delete(child); }, graceMs: 5 });
  const child = pid => { const value = new EventEmitter(); value.pid = pid; living.add(value); return value; };
  return { signals, living, calls, supervisor, child };
}
test('unexpected exit cleans both owned children, never an untracked backend or an occupied port', async () => {
  const f = supervisorFixture(), backend = f.child(101), frontend = f.child(102), external = f.child(999);
  f.supervisor.track(backend); f.supervisor.track(frontend); frontend.emit('exit', 0);
  assert.equal(await f.supervisor.done, 1);
  assert.deepEqual(f.calls, [[101, 'SIGTERM'], [102, 'SIGTERM']]); assert.equal(f.living.has(external), true);
  assert.equal(f.signals.listenerCount('SIGINT'), 0);
});
test('SIGINT and SIGTERM abort startup and stop each owned group once', async () => {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const f = supervisorFixture(); f.supervisor.track(f.child(101));
    f.signals.emit(signal); f.signals.emit(signal);
    assert.equal(await f.supervisor.done, code); assert.equal(f.supervisor.signal.aborted, true);
    assert.deepEqual(f.calls, [[101, 'SIGTERM']]);
  }
});
test('spawn errors terminate the already-started sibling and a stubborn owned group is escalated', async () => {
  const signals = new EventEmitter(), calls = [];
  const supervisor = createSupervisor({ signals, alive: () => true, terminate: (child, signal) => calls.push([child.pid, signal]), graceMs: 1 });
  const child = new EventEmitter(); child.pid = 101; supervisor.track(child); child.emit('error', new Error('spawn failed'));
  assert.equal(await supervisor.done, 1); assert.deepEqual(calls, [[101, 'SIGTERM'], [101, 'SIGKILL']]);
});
