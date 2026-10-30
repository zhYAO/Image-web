'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once, EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createAdmissionController, parseControl, installFrameworkTracking } = require('./http-admission.cjs');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = mode => ({ schemaVersion: 2, operationId: 'operation-1', mode });
async function fixture(t, listener) {
  let control = gate('open');
  const controller = createAdmissionController(() => control);
  const server = controller.createServer(http.createServer, http, [listener]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const request = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, agent: false }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject); req.end();
  });
  return { controller, server, request, setGate: value => { control = value; } };
}

test('schema 2 strictly rejects old, extra and malformed control', () => {
  assert.deepEqual(parseControl(JSON.stringify(gate('draining'))), gate('draining'));
  for (const value of [null, [], {}, { schemaVersion: 1, operationId: 'operation-1', maintenance: true },
    { ...gate('checking'), extra: true }, { ...gate('open'), mode: 'invalid' }, { ...gate('open'), operationId: '../escape' }]) {
    assert.throws(() => parseControl(JSON.stringify(value)));
  }
});

test('zero snapshot remains closed to GET HEAD OPTIONS RSC image and direct application requests', async t => {
  let entered = 0;
  const f = await fixture(t, (_req, res) => { entered++; res.end('ok'); });
  f.setGate(gate('draining'));
  assert.equal(f.controller.snapshot().activeHttpRequests, 0);
  for (const [method, path] of [['GET', '/api/account'], ['HEAD', '/workspace'], ['OPTIONS', '/api/uploads'], ['GET', '/workspace?_rsc=token'], ['GET', '/_next/image?url=x&w=64&q=75'], ['POST', '/api/chat']]) {
    assert.equal(await f.request(path, method), 503);
  }
  assert.equal(entered, 0);
  assert.equal(f.controller.snapshot().activeHttpRequests, 0);
});

test('checking admits only exact verifier targets and closes synchronously when draining resumes', async t => {
  let entered = 0;
  const f = await fixture(t, (_req, res) => { entered++; res.end('ok'); });
  f.setGate(gate('checking'));
  for (const path of ['/api/health/ready', '/api/meta', '/api/public-config', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing', '/login', '/_next/static/chunks/abcdef.js']) assert.equal(await f.request(path), 200);
  for (const path of ['/api/credits/wallet', '/api/credits/ledger', '/api/account?', '/api/account?x=1', '/api/account/', '/api/%61ccount', '//api/account', '/api/../api/account', 'http://localhost/api/account', '/_next/image', '/login?next=foo', '/_next/static/../image', '/_next/static//chunk.js', '/_next/static/%2e/chunk.js', '/_next/static/chunk.js?x=1']) assert.equal(await f.request(path), 503);
  assert.equal(await f.request('/api/account', 'POST'), 503);
  f.setGate(gate('draining'));
  assert.equal(await f.request('/api/health/ready'), 503);
  assert.equal(entered, 9);
});

test('client abort during async optimizer retains work until the real callback settles', async t => {
  const entered = deferred(), release = deferred(), settled = deferred();
  const f = await fixture(t, async (_req, res) => { entered.resolve(); await release.promise; res.end('image'); settled.resolve(); });
  const req = http.get({ host: '127.0.0.1', port: f.server.address().port, path: '/_next/image?url=x&w=64&q=75', agent: false });
  req.on('error', () => {});
  await entered.promise;
  assert.equal(f.controller.snapshot().activeHttpRequests, 1);
  req.destroy(); await tick(); await tick();
  f.setGate(gate('draining'));
  assert.equal(f.controller.snapshot().activeHttpRequests, 1);
  assert.equal(await f.request('/_next/image?url=x&w=64&q=75'), 503);
  release.resolve(); await settled.promise; await tick();
  assert.equal(f.controller.snapshot().activeHttpRequests, 0);
});

test('response finish does not release the async callback and settled callback does not release an open response', async t => {
  const release = deferred();
  const f = await fixture(t, async (_req, res) => { res.end('ok'); await release.promise; });
  assert.equal(await f.request('/finished'), 200);
  assert.equal(f.controller.snapshot().activeHttpRequests, 1);
  release.resolve(); await tick();
  assert.equal(f.controller.snapshot().activeHttpRequests, 0);
  let response;
  const g = await fixture(t, (_req, res) => { response = res; });
  const request = g.request('/ignored');
  while (!response) await tick();
  assert.equal(g.controller.snapshot().activeHttpRequests, 1);
  response.end(); await request; await tick();
  assert.equal(g.controller.snapshot().activeHttpRequests, 0);
});

test('missing or invalid persistent gate fails closed before the callback', async t => {
  let entered = 0;
  const f = await fixture(t, (_req, res) => { entered++; res.end(); });
  for (const value of [null, gate('bad'), { schemaVersion: 1, maintenance: false, operationId: 'operation-1' }]) {
    f.setGate(value);
    assert.equal(await f.request('/api/meta'), 503);
    assert.equal(f.controller.snapshot().controlValid, false);
  }
  assert.equal(entered, 0);
});

test('maintenance denies upgrade before application upgrade listeners', async t => {
  let entered = 0;
  const f = await fixture(t, (_req, res) => res.end());
  f.server.on('upgrade', (_req, socket) => { entered++; socket.end('HTTP/1.1 101 Switching Protocols\r\n\r\n'); });
  f.setGate(gate('checking'));
  const socket = net.connect(f.server.address().port, '127.0.0.1');
  let body = ''; socket.setEncoding('utf8'); socket.on('data', data => { body += data; });
  await once(socket, 'connect'); socket.end('GET /api/meta HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  await once(socket, 'close');
  assert.match(body, /^HTTP\/1\.1 503/);
  assert.equal(entered, 0);
});

test('sync throws and rejected thenables release only after response termination', async () => {
  for (const listener of [() => { throw new Error('handler failed'); }, () => ({ then(_resolve, reject) { reject(new Error('thenable failed')); } })]) {
    const controller = createAdmissionController(() => gate('open'));
    const server = controller.createServer(http.createServer, http, [listener]);
    const response = new EventEmitter();
    try { server.emit('request', { method: 'GET', url: '/' }, response); } catch (error) { assert.match(error.message, /handler failed/); }
    await tick();
    assert.equal(controller.snapshot().activeHttpRequests, 1);
    response.emit('close'); await tick();
    assert.equal(controller.snapshot().activeHttpRequests, 0);
  }
});

test('registered request listeners, once/off identity and async upgrade after close preserve accounting', async () => {
  const controller = createAdmissionController(() => gate('open'));
  const server = controller.createServer(http.createServer, http, []);
  let removed = 0;
  function removeMe() { removed++; }
  server.on('request', removeMe); assert.deepEqual(server.listeners('request'), [removeMe]);
  server.off('request', removeMe); assert.equal(server.listenerCount('request'), 0);
  server.once('request', removeMe); server.removeListener('request', removeMe); assert.equal(server.listenerCount('request'), 0);
  const release = deferred();
  let entered = 0;
  async function upgraded(_req, socket) { entered++; socket.emit('close'); await release.promise; }
  server.once('upgrade', upgraded);
  assert.deepEqual(server.listeners('upgrade'), [upgraded]);
  const socket = new EventEmitter();
  server.emit('upgrade', { method: 'GET', url: '/' }, socket, Buffer.alloc(0));
  assert.equal(server.listenerCount('upgrade'), 0);
  assert.equal(controller.snapshot().activeHttpRequests, 1);
  release.resolve(); await tick();
  assert.equal(controller.snapshot().activeHttpRequests, 0);
  assert.equal(entered, 1); assert.equal(removed, 0);
});

test('upgrade and CONNECT output finish cannot release an inbound half-open tunnel', async () => {
  for (const event of ['upgrade', 'connect']) {
    const controller = createAdmissionController(() => gate('open'));
    const server = controller.createServer(http.createServer, http, []);
    server.on(event, () => undefined);
    const socket = new EventEmitter();
    server.emit(event, { method: 'GET', url: '/' }, socket, Buffer.alloc(0));
    socket.emit('finish'); await tick();
    assert.equal(controller.snapshot().activeHttpRequests, 1);
    socket.emit('close'); await tick();
    assert.equal(controller.snapshot().activeHttpRequests, 0);
  }
});

test('actual audited Next stale image response stays counted through delayed fetch, native render, and cache write', async t => {
  const nextRequire = createRequire(resolve(__dirname, '../../../apps/web/package.json'));
  const f = await fixture(t, async (_req, res) => { const cached = await operation; res.end(cached.value.buffer); });
  installFrameworkTracking(f.controller, nextRequire);
  assert.throws(() => installFrameworkTracking(f.controller, nextRequire), /repeated Next admission hook/);
  const { default: ResponseCache, CachedRouteKind } = nextRequire('next/dist/server/response-cache');
  const sharp = nextRequire('sharp');
  const value = { kind: CachedRouteKind.IMAGE, buffer: Buffer.from('cached'), etag: 'cached', extension: 'png', upstreamEtag: 'upstream' };
  const previous = { value, cacheControl: { revalidate: 1, expire: undefined }, isStale: true };
  const lookup = deferred(), fetch = deferred(), native = deferred(), write = deferred(), entered = deferred(), writing = deferred();
  const cache = new ResponseCache({ minimalMode: false, route: 'image' });
  const operation = cache.get('delayed-image', async () => {
    entered.resolve(); await fetch.promise;
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer();
    await native.promise;
    return { value: { ...value, buffer }, cacheControl: { revalidate: 1, expire: undefined } };
  }, { incrementalCache: { get: async () => { await lookup.promise; return previous; }, set: async () => { writing.resolve(); await write.promise; } }, isFallback: false });
  assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'cache lookup scheduler must already be counted');
  lookup.resolve();
  assert.equal(await f.request('/_next/image?url=x&w=64&q=75'), 200);
  await entered.promise; await tick();
  f.setGate(gate('draining'));
  assert.equal(f.controller.snapshot().activeHttpRequests, 0, 'stale HTTP response has finished');
  assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'detached fetch is still counted after stale response');
  assert.equal(await f.request('/api/meta'), 503);
  fetch.resolve(); await tick();
  assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'native generation remains counted');
  native.resolve(); await writing.promise;
  assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'cache persistence remains counted');
  write.resolve();
  while (cache.revalidateBatcher.pending.size) await tick();
  await tick();
  assert.equal(f.controller.snapshot().activeFrameworkWork, 0);
  assert.deepEqual(f.controller.snapshot().frameworkWork, { protocolVersion: 1, installed: true, nextVersion: '16.4.1', hook: 'response-cache-revalidate-v1', controlValid: true });

  await t.test('error retention persists the previous cache entry before releasing work', async () => {
    const retained = deferred(), retaining = deferred(), error = new Error('render failed');
    const failedCache = new ResponseCache({ minimalMode: false, route: 'image' });
    const promise = failedCache.get('failure-retention', async () => { throw error; }, {
      incrementalCache: { get: async () => ({ ...previous, isStale: -1 }), set: async () => { retaining.resolve(); await retained.promise; } }, isFallback: false,
    });
    const rejected = assert.rejects(promise, value => value === error);
    await retaining.promise;
    assert.ok(f.controller.snapshot().activeFrameworkWork > 0);
    retained.resolve(); await rejected; await tick();
    assert.equal(f.controller.snapshot().activeFrameworkWork, 0);
  });

  await t.test('keyless, minimal-mode, and prefetch miss branches retain full generator lifetime', async () => {
    for (const variant of ['keyless', 'minimal', 'prefetch']) {
      const release = deferred(), entered = deferred();
      const branch = new ResponseCache({ minimalMode: variant === 'minimal', route: 'image' });
      const promise = branch.get(variant === 'keyless' ? null : variant, async () => {
        entered.resolve(); await release.promise; return { value, cacheControl: { revalidate: 1, expire: undefined } };
      }, { incrementalCache: { get: async () => null, set: async () => {} }, isFallback: false, isPrefetch: variant === 'prefetch' });
      await entered.promise;
      assert.ok(f.controller.snapshot().activeFrameworkWork > 0, variant);
      release.resolve(); await promise; await tick();
      assert.equal(f.controller.snapshot().activeFrameworkWork, 0, variant);
    }
  });

  await t.test('actual disk LRU initialization and detached evictions remain counted', async () => {
    const disk = nextRequire('next/dist/server/lib/disk-lru-cache.external');
    disk.resetDiskLRU();
    const initial = deferred(), initialized = deferred(), evicted = deferred();
    let eviction = deferred(), evictions = 0;
    const initializing = disk.getOrInitDiskLRU('/unused-fixture', 1, async () => {
      initialized.resolve(); await initial.promise;
      return [{ key: 'old', size: 1 }, { key: 'new', size: 1 }];
    }, async () => { evictions++; evicted.resolve(); await eviction.promise; });
    await initialized.promise;
    assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'eager initialization is counted');
    initial.resolve();
    const lru = await initializing; await evicted.promise; await tick();
    assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'initialization settled while detached eviction remains');
    eviction.resolve(); await tick();
    assert.equal(f.controller.snapshot().activeFrameworkWork, 0);
    eviction = deferred();
    lru.set('third', 1);
    assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'later eviction increments synchronously');
    eviction.resolve(); await tick();
    assert.equal(f.controller.snapshot().activeFrameworkWork, 0);
    assert.equal(evictions, 2);
    disk.resetDiskLRU();
    const failure = new Error('disk initialization failed');
    await assert.rejects(disk.getOrInitDiskLRU('/unused-fixture', 1, async () => { throw failure; }, async () => {}), value => value === failure);
    await tick();
    assert.equal(f.controller.snapshot().activeFrameworkWork, 0);
    disk.resetDiskLRU();
  });

  await t.test('invalid image queries do not hide eager image-cache initialization', async () => {
    const disk = nextRequire('next/dist/server/lib/disk-lru-cache.external');
    disk.resetDiskLRU();
    const { ImageOptimizerCache } = nextRequire('next/dist/server/image-optimizer');
    const directory = mkdtempSync(resolve(tmpdir(), 'zimage-admission-'));
    const nextConfig = { images: { maximumDiskCacheSize: 1024, minimumCacheTTL: 1 }, experimental: { isrFlushToDisk: true } };
    try {
      const cache = new ImageOptimizerCache({ distDir: directory, nextConfig });
      const invalid = ImageOptimizerCache.validateParams({ headers: {} }, {}, nextConfig, false);
      assert.equal(typeof invalid.errorMessage, 'string');
      assert.ok(f.controller.snapshot().activeFrameworkWork > 0, 'constructor work is tracked despite early invalid-query response');
      await cache.cacheDiskLRU; await tick();
      assert.equal(f.controller.snapshot().activeFrameworkWork, 0);
    } finally { disk.resetDiskLRU(); rmSync(directory, { recursive: true, force: true }); }
  });

  await t.test('replacing a hooked module record closes intake and invalidates control', async () => {
    const responsePath = nextRequire.resolve('next/dist/server/response-cache');
    const originalModule = require.cache[responsePath];
    assert.equal(Object.getOwnPropertyDescriptor(originalModule, 'exports').writable, false);
    assert.equal(Object.getOwnPropertyDescriptor(ResponseCache.prototype, 'revalidate').writable, false);
    f.setGate(gate('open'));
    try {
      require.cache[responsePath] = { exports: { default: class UntrackedCache {} } };
      assert.equal(f.controller.snapshot().controlValid, false);
      assert.equal(f.controller.snapshot().frameworkWork.controlValid, false);
      assert.equal(await f.request('/api/meta'), 503);
    } finally { require.cache[responsePath] = originalModule; }
    assert.equal(f.controller.snapshot().controlValid, true);
    assert.equal(await f.request('/api/meta'), 200);
  });
});

test('framework pins reject version and source drift before installing hooks', () => {
  const nextRequire = createRequire(resolve(__dirname, '../../../apps/web/package.json'));
  const wrongVersion = () => ({ version: '16.4.2' });
  assert.throws(() => installFrameworkTracking(createAdmissionController(() => gate('open')), wrongVersion), /audited Next/);
  const wrongSource = name => nextRequire(name);
  wrongSource.resolve = () => __filename;
  assert.throws(() => installFrameworkTracking(createAdmissionController(() => gate('open')), wrongSource), /Unaudited Next admission source/);
});

test('framework startup rejects a disk module imported before the preload', () => {
  const script = `
    const {createRequire}=require('node:module');
    const nextRequire=createRequire(${JSON.stringify(resolve(__dirname, '../../../apps/web/package.json'))});
    nextRequire('next/dist/server/lib/disk-lru-cache.external');
    const {createAdmissionController,installFrameworkTracking}=require(${JSON.stringify(resolve(__dirname, 'http-admission.cjs'))});
    require('node:assert/strict').throws(()=>installFrameworkTracking(createAdmissionController(),nextRequire),/disk cache loaded before/);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
