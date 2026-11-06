import test from 'node:test';
import assert from 'node:assert/strict';

import * as implementation from './browser-readonly-verifier.mjs';
const { browserReadonlyKernel } = implementation;
const ORIGIN = 'https://www.zimage.store';
const RELEASE = 'a'.repeat(40);
const ID = '00000000-0000-4000-8000-000000000001';
const PATHS = ['/api/health/ready', '/api/meta', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing'];
const FAILURE = 'Read-only verification failed; no receipt generated.';
const request = (changes = {}) => ({ schemaVersion: 1, operationId: 'operation-1', backendRelease: RELEASE,
  pid: 101, nonce: 'b'.repeat(64), createdAt: 1000, expiresAt: 1120, ...changes });
const config = { operationId: 'operation-1', allowedReleases: [RELEASE, 'c'.repeat(40)] };
const catalog = () => ({ version: 'fixture-token-v1', enabled: false, prices: [{ operation: 'chat', provider: 'doubao', model: 'doubao',
  resolution: '', unitMinor: 1, label: 'Chat', rateVersion: 'fixture-token-v1', billingMode: 'usage_capped', tokenTariff: {
    inputPerMillionNano: '600000000', cachedInputPerMillionNano: '600000000', outputPerMillionNano: '3600000000',
    maxInputTokens: 1024, maxOutputTokens: 512 } }] });
function bodies() {
  return {
    '/api/health/ready': { status: 'ok', version: RELEASE },
    '/api/meta': { schemaVersion: 1, backendRelease: RELEASE, api: { major: 1, minor: 0 }, capabilities: ['runtime.meta.v1'] },
    '/api/auth/session': { id: ID },
    '/api/account': { id: ID, status: 'active', displayName: null, email: 'private@example.test' },
    '/api/sessions': { sessions: [{ id: ID, status: 'active', title: 'PRIVATE SESSION TITLE',
      createdAt: '2026-11-06T12:00:00Z', updatedAt: '2026-11-06T12:01:00+00:00', activityTypes: ['chat'] }] },
    '/api/credits/pricing': catalog(),
  };
}
function fixture(change = () => {}) {
  const calls = []; const state = { wall: 1001, mono: 0 };
  const env = {
    location: { origin: ORIGIN }, performance: { now: () => state.mono }, Date: { now: () => state.wall * 1000 },
    crypto: globalThis.crypto, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout,
    async fetch(url, options) {
      calls.push({ url, options });
      const path = new URL(url).pathname;
      const data = { status: 200, headers: { 'cache-control': 'private, no-store' }, body: bodies()[path] };
      if (path === PATHS[5]) data.headers['x-zimage-readonly-probe'] = 'catalog-v1';
      await change(data, path, calls, state);
      if (data.response) return data.response;
      return new Response(JSON.stringify(data.body), { status: data.status, headers: data.headers });
    },
  };
  env.top = env; env.self = env;
  const api = browserReadonlyKernel(env);
  return { api, env, calls, state, verifier: () => api.createVerifier(config) };
}

// Catches accidental omission/expansion of the route suite, a marker on other GETs,
// credential export and receipt identity leaks at the observable fetch/output boundary.
test('runs seven fixed same-origin GETs and emits only the v2 redacted receipt', async () => {
  const f = fixture();
  const receipt = await f.verifier().verify(JSON.stringify(request()));
  assert.deepEqual(f.calls.map(c => c.url), [...PATHS, '/api/meta'].map(p => ORIGIN + p));
  for (const [index, call] of f.calls.entries()) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.mode, 'same-origin');
    assert.equal(call.options.body, undefined);
    assert.deepEqual(call.options.headers, index === 5
      ? { Accept: 'application/json', 'x-zimage-readonly-probe': 'catalog-v1' } : { Accept: 'application/json' });
  }
  assert.deepEqual(receipt, {
    schemaVersion: 1, verifierProtocol: 'zimage-backend-readonly-v2', operationId: 'operation-1', backendRelease: RELEASE,
    pid: 101, nonce: 'b'.repeat(64), requestSha256: '9dd76dd2fea7459d9ec7342913e0bf524cedf6fdb7a607392e52e67186907114', checkedAt: 1001,
    checks: PATHS.map((path, i) => ({ path, status: 200, noStore: true, authenticated: i >= 2 })),
    authenticatedReadOnly: true, independentPublic: true, catalogReady: true,
  });
  assert.doesNotMatch(JSON.stringify(receipt), /private@example|PRIVATE SESSION|00000000|tokenTariff/);
});

test('request digest agrees with Python canonical integers and fractional timestamp serialization', async () => {
  const { api } = fixture();
  const text = JSON.stringify(request()).replace('"createdAt":1000', '"createdAt":1000.0');
  assert.equal(await api.requestDigest(api.parseRequest(text)), '9dd76dd2fea7459d9ec7342913e0bf524cedf6fdb7a607392e52e67186907114');
  const small = request({ createdAt: 0.00001, expiresAt: 119.00001 });
  assert.equal(await api.requestDigest(api.parseRequest(JSON.stringify(small))), '9c2cc13284f54446918ad9bc66535767b159b23f85ccaf4d2f9e46b6ef107377');
});

test('rejects malformed, duplicate, oversized, unexpected-key, mistyped and unsafe request fields before fetching', async () => {
  const candidates = [ '', '{', '[]', 'null', '{}', 'x'.repeat(4097),
    JSON.stringify(request()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    JSON.stringify(request()).replace('"nonce":', '"n\\u006fnce":"a","nonce":'),
    JSON.stringify(request()).replace('"pid":101', '"pid":101.0'),
    JSON.stringify(request()).replace('"schemaVersion":1', '"schemaVersion":1e0'),
    JSON.stringify(request()).replace('"createdAt":1000', '"createdAt":1e999'),
    ...[
      { schemaVersion: true }, { pid: true }, { pid: 0 }, { pid: 2147483648 }, { pid: 1.5 },
      { createdAt: 1002 }, { createdAt: -1 }, { expiresAt: 1000 }, { expiresAt: 1121 },
      { createdAt: '1000' }, { operationId: 'wrong-operation' }, { operationId: '../bad' },
      { backendRelease: 'd'.repeat(40) }, { backendRelease: RELEASE.toUpperCase() }, { nonce: 'x'.repeat(64) },
      { url: 'https://attacker.test' }, { __proto__: null, extra: 'private' },
    ].map(changes => JSON.stringify(request(changes))) ];
  for (const input of candidates) {
    const f = fixture();
    await assert.rejects(() => f.verifier().verify(input), { message: FAILURE });
    assert.equal(f.calls.length, 0, input.slice(0, 100));
  }
});

test('rejects a wrong origin, embedded frame or untrusted configuration', () => {
  for (const change of [f => { f.env.location.origin = 'http://www.zimage.store'; },
    f => { f.env.location.origin = 'https://attacker.test'; }, f => { f.env.top = {}; }]) {
    const f = fixture(); change(f);
    assert.throws(() => f.verifier(), { message: FAILURE });
    assert.equal(f.calls.length, 0);
  }
  for (const bad of [{ ...config, operationId: 'short' }, { ...config, allowedReleases: [] },
    { ...config, allowedReleases: [RELEASE, RELEASE] }, { ...config, allowedReleases: ['https://attacker.test'] },
    { ...config, url: ORIGIN }]) assert.throws(() => fixture().api.createVerifier(bad), { message: FAILURE });
});

test('all HTTP, DTO, no-store, marker and identity failures are redacted and mint no receipt', async () => {
  const changes = [
    ...PATHS.map(route => (data, path) => { if (route === path) data.status = 503; }),
    ...PATHS.map(route => (data, path) => { if (route === path) data.headers = {}; }),
    ...PATHS.map(route => (data, path) => { if (route === path) data.body = []; }),
    (d, p) => { if (p === PATHS[0]) d.body.version = 'd'.repeat(40); },
    (d, p) => { if (p === PATHS[1]) d.body.api.major = 2; },
    (d, p) => { if (p === PATHS[1]) d.body.capabilities.push('runtime.meta.v1'); },
    (d, p) => { if (p === PATHS[2]) d.body.extra = 'private'; },
    (d, p) => { if (p === PATHS[3]) d.body.id = '00000000-0000-4000-8000-000000000002'; },
    (d, p) => { if (p === PATHS[3]) d.body.status = 'disabled'; },
    (d, p) => { if (p === PATHS[3]) d.body.email = 'invalid'; },
    ...[undefined, '', 'catalog-v0', 'catalog-v1, catalog-v1'].map(marker => (d, p) => { if (p === PATHS[5]) {
      delete d.headers['x-zimage-readonly-probe']; if (marker !== undefined) d.headers['x-zimage-readonly-probe'] = marker;
    } }),
    (d, p, calls) => { if (calls.length === 7) d.body.backendRelease = 'd'.repeat(40); },
    (d, p, calls) => { if (calls.length === 7) d.body.api.major = 2; },
    (d, p, calls) => { if (calls.length === 7) d.headers = {}; },
    () => { throw new Error('private@example.test SESSION_TOKEN_SECRET'); },
  ];
  for (const change of changes) {
    const f = fixture(change);
    await assert.rejects(() => f.verifier().verify(JSON.stringify(request())), { message: FAILURE });
    assert.ok(f.calls.length <= 7);
  }
});

test('body parsing rejects over 2MB, invalid JSON and followed redirect evidence', async () => {
  for (const response of [new Response('x'.repeat(2_000_001)), new Response('{'),
    { status: 200, redirected: true, headers: new Headers(), body: null },
    { status: 200, url: 'https://attacker.test/', headers: new Headers(), body: null },
    new Response('x', { headers: { 'content-length': '2000001' } })]) {
    const f = fixture(data => { data.response = response; });
    await assert.rejects(() => f.verifier().verify(JSON.stringify(request())), { message: FAILURE });
  }
});

test('deduplicates nonce attempts including concurrent calls, rejects changed bindings and returns detached receipts', async () => {
  const f = fixture(); const verifier = f.verifier(); const input = JSON.stringify(request());
  const [first, second] = await Promise.all([verifier.verify(input), verifier.verify(input)]);
  assert.equal(f.calls.length, 7);
  first.checks[0].status = 500;
  assert.equal(second.checks[0].status, 200);
  assert.equal((await verifier.verify(input)).checks[0].status, 200);
  await assert.rejects(() => verifier.verify(JSON.stringify(request({ pid: 102 }))), { message: FAILURE });
  assert.equal(f.calls.length, 7);
  f.state.wall = 1121;
  await assert.rejects(() => verifier.verify(input), { message: FAILURE });
});

test('a failed nonce cannot refetch, but a different recovery nonce can', async () => {
  let bad = true; const f = fixture(data => { if (bad) data.status = 503; }); const verifier = f.verifier();
  const input = JSON.stringify(request());
  await assert.rejects(() => verifier.verify(input), { message: FAILURE });
  bad = false;
  await assert.rejects(() => verifier.verify(input), { message: FAILURE });
  assert.equal(f.calls.length, 1);
  assert.equal((await verifier.verify(JSON.stringify(request({ nonce: 'c'.repeat(64) })))).catalogReady, true);
  assert.equal(f.calls.length, 8);
});

test('enforces eight nonce rounds and an unextendable monotonic twenty-minute lifetime', async () => {
  const f = fixture(); const verifier = f.verifier();
  for (let i = 0; i < 8; i++) await verifier.verify(JSON.stringify(request({ nonce: i.toString(16).repeat(64) })));
  await assert.rejects(() => verifier.verify(JSON.stringify(request({ nonce: 'f'.repeat(64) }))), { message: FAILURE });
  assert.equal(f.calls.length, 56);
  f.state.mono = 1_200_000;
  await assert.rejects(() => verifier.verify(JSON.stringify(request())), { message: FAILURE });
  assert.equal(f.calls.length, 56);
});

test('a request that expires or hits the monotonic deadline during reads cannot mint a receipt', async () => {
  for (const field of ['wall', 'mono']) {
    const f = fixture((data, path, calls, state) => { if (calls.length === 7) state[field] = field === 'wall' ? 1121 : 1_200_000; });
    await assert.rejects(() => f.verifier().verify(JSON.stringify(request())), { message: FAILURE });
  }
  const f = fixture((data, path, calls, state) => { if (calls.length === 3) state.wall = 999; });
  await assert.rejects(() => f.verifier().verify(JSON.stringify(request())), { message: FAILURE });
});

test('strict catalog DTO accepts current optional token fields and rejects coercion or extras', () => {
  const { api } = fixture();
  assert.equal(api.validateBody(PATHS[5], catalog()), true);
  assert.equal(api.validateBody(PATHS[5], { version: '', enabled: true, prices: [] }), true);
  const candidates = [{ enabled: 0 }, { extra: true }, { prices: {} }];
  for (const change of candidates) assert.equal(api.validateBody(PATHS[5], { ...catalog(), ...change }), false);
  for (const change of [{ operation: 'wallet' }, { provider: '' }, { model: '' }, { resolution: null },
    { unitMinor: true }, { unitMinor: 0 }, { unitMinor: 1.5 }, { unitMinor: 2 ** 53 }, { label: null }, { extra: true },
    { rateVersion: '' }, { rateVersion: 'x'.repeat(101) }, { billingMode: 'fixed' }, { tokenTariff: {} },
    { tokenTariff: { ...catalog().prices[0].tokenTariff, maxInputTokens: true } },
    { tokenTariff: { ...catalog().prices[0].tokenTariff, maxOutputTokens: Infinity } },
    { tokenTariff: { ...catalog().prices[0].tokenTariff, inputPerMillionNano: 3 } }]) {
    assert.equal(api.validateBody(PATHS[5], { ...catalog(), prices: [{ ...catalog().prices[0], ...change }] }), false);
  }
});

test('wire DTO integer fields reject JSON float spelling and duplicate response fields', async () => {
  for (const [route, original, replacement] of [
    [PATHS[1], '"schemaVersion":1', '"schemaVersion":1.0'],
    [PATHS[1], '"major":1', '"major":1e0'],
    [PATHS[1], '"minor":0', '"minor":0.0'],
    [PATHS[5], '"unitMinor":1', '"unitMinor":1.0'],
    [PATHS[2], '"id":', '"id":"private","id":'],
  ]) {
    const f = fixture((data, path) => { if (path === route) data.response = new Response(JSON.stringify(data.body).replace(original, replacement), { headers: data.headers }); });
    await assert.rejects(() => f.verifier().verify(JSON.stringify(request())), { message: FAILURE });
  }
});

// Minimal DOM ports exercise our UI handlers and downloads, not browser layout.
// All network responses remain real bounded Response streams.
function uiFixture(change) {
  const f = fixture(change); const nodes = []; const blobs = new Map();
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.listeners = new Map(); this.value = ''; this.disabled = false; this.textContent = ''; nodes.push(this); }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    attachShadow() { this.shadow = new Element('shadow'); return this.shadow; }
    remove() { this.removed = true; }
    click() { return this.listeners.get('click')?.({}); }
    async emit(type) { await this.listeners.get(type)?.({}); }
  }
  f.env.document = { body: new Element('body'), createElement: tag => new Element(tag),
    getElementById: id => nodes.find(n => n.id === id && !n.removed) };
  f.env.Blob = Blob;
  f.env.URL = { createObjectURL(blob) { blobs.set('blob:fixture', blob); return 'blob:fixture'; }, revokeObjectURL() {} };
  return { ...f, nodes, blobs, find: tag => nodes.find(n => n.tagName === tag) };
}

test('UI accepts public request JSON only and downloads exact redacted bytes matching its displayed SHA', async () => {
  const f = uiFixture();
  f.api.mount(config);
  assert.equal(f.calls.length, 0);
  const textarea = f.find('textarea'); const button = f.nodes.find(n => n.textContent === 'Verify public request');
  textarea.value = JSON.stringify(request());
  await button.click();
  assert.equal(textarea.value, '');
  const receiptText = f.find('pre').textContent;
  assert.equal(JSON.parse(receiptText).catalogReady, true);
  assert.doesNotMatch(receiptText, /private@example|PRIVATE SESSION|00000000/);
  const download = f.nodes.find(n => n.textContent === 'Download redacted receipt');
  assert.equal(download.disabled, false);
  await download.click();
  const bytes = await f.blobs.get('blob:fixture').text();
  assert.equal(bytes, receiptText);
  assert.ok(bytes.endsWith('\n'));
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.ok(f.nodes.some(n => n.textContent === 'Receipt SHA-256: ' + digest));
  assert.equal(f.nodes.find(n => n.tagName === 'a').download, 'backend-readonly-receipt.json');
  assert.throws(() => f.api.mount(config), { message: FAILURE });
  assert.equal(f.calls.length, 7);
});

test('UI clears stale output on invalid JSON or failure and never reads oversized file contents', async () => {
  const f = uiFixture(); f.api.mount(config);
  const button = f.nodes.find(n => n.textContent === 'Verify public request');
  f.find('textarea').value = JSON.stringify(request()); await button.click();
  f.find('textarea').value = '{"secret":"DO_NOT_ECHO"}'; await button.click();
  assert.equal(f.find('pre').textContent, '');
  assert.equal(f.nodes.find(n => n.textContent === 'Download redacted receipt').disabled, true);
  assert.ok(f.nodes.some(n => n.textContent === FAILURE));
  assert.ok(!f.nodes.some(n => /DO_NOT_ECHO/.test(n.textContent)));
  let reads = 0;
  const file = f.nodes.find(n => n.tagName === 'input');
  file.files = [{ size: 4097, async text() { reads++; return 'PRIVATE'; } }];
  await file.emit('change'); assert.equal(reads, 0);
  file.files = [{ size: 10, async text() { reads++; return '{bad'; } }];
  await file.emit('change'); assert.equal(reads, 1); assert.equal(f.find('textarea').value, '');
  file.files = [{ size: 500, async text() { return JSON.stringify(request({ nonce: 'c'.repeat(64) })); } }];
  await file.emit('change'); assert.match(f.find('textarea').value, /"nonce"/);
  assert.equal(f.calls.length, 7);
});

test('generated readable snippet mounts only on the fixed origin, without Node dependencies', async () => {
  const { createContext, runInContext } = await import('node:vm');
  const f = uiFixture();
  const source = implementation.snippetSource(config);
  assert.ok(source.length > 1000);
  assert.doesNotThrow(() => runInContext(source, createContext(f.env)));
  assert.ok(f.find('textarea'));
  assert.equal(f.calls.length, 0);
  const bad = uiFixture(); bad.env.location.origin = 'https://attacker.test';
  let alert; bad.env.alert = text => { alert = text; };
  runInContext(source, createContext(bad.env));
  assert.equal(alert, FAILURE); assert.equal(bad.calls.length, 0);
});

test('transport aborts a read at its timer and rejects invalid UTF-8 without leaking decoder errors', async () => {
  const timed = fixture();
  timed.env.setTimeout = callback => { queueMicrotask(callback); return 1; };
  timed.env.clearTimeout = () => {};
  await assert.rejects(() => timed.verifier().verify(JSON.stringify(request())), { message: FAILURE });
  assert.equal(timed.calls[0].options.signal.aborted, true);
  const invalid = fixture(data => { data.response = new Response(new Uint8Array([0xff, 0xfe])); });
  await assert.rejects(() => invalid.verifier().verify(JSON.stringify(request())), { message: FAILURE });
});

test('session DTO rejects impossible dates, missing timezone, malformed UUID and session extras', () => {
  const { api } = fixture();
  for (const date of ['2026-02-30T12:00:00Z', '2026-13-01T12:00:00Z', '2026-11-06T12:00:00', '2026-11-06T24:00:00Z']) {
    const body = bodies()[PATHS[4]]; body.sessions[0].createdAt = date;
    assert.equal(api.validateBody(PATHS[4], body), false, date);
  }
  for (const changes of [{ id: 'private' }, { extra: true }, { activityTypes: ['wallet'] }, { title: ' ' }]) {
    const body = bodies()[PATHS[4]]; Object.assign(body.sessions[0], changes);
    assert.equal(api.validateBody(PATHS[4], body), false);
  }
});


test('browser receipt passes the unchanged Python v2 receipt validator and digest kernel', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const f = fixture(); const challenge = request();
  const receipt = await f.verifier().verify(JSON.stringify(challenge));
  const python = spawnSync('python3', ['-B', '-c', `
import importlib.util, json, pathlib, sys
folder=pathlib.Path(sys.argv[1])
def load(name):
    spec=importlib.util.spec_from_file_location(name,folder/(name+'.py'))
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
transport, verifier = load('receipt'), load('verify')
payload=json.load(sys.stdin); request, receipt=payload['request'],payload['receipt']
assert transport.validate_receipt(receipt,request,operation='operation-1',release='a'*40,pid=101,now=1002)==receipt
assert verifier.request_digest(request)==receipt['requestSha256']
for route, body in payload['bodies'].items():
    assert verifier.validate_body(route, body)
print('v2-valid')
`, fileURLToPath(new URL('.', import.meta.url))], { input: JSON.stringify({ request: challenge, receipt, bodies: bodies() }), encoding: 'utf8', timeout: 10_000 });
  assert.equal(python.status, 0, python.stderr);
  assert.equal(python.stdout, 'v2-valid\n');
});
