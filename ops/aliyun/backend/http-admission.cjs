'use strict';

// Loaded by Node --require before the unmodified Next standalone server. Next
// 16.4.1 start-server.js awaits requestHandler inside its createServer callback.
const fs = require('node:fs');
const http = require('node:http');
const { createRequire, syncBuiltinESMExports } = require('node:module');
const { createHash, randomUUID } = require('node:crypto');
const CONTROL_FILE = '/etc/zimage/backend-maintenance.json';
const BRIDGE_KEY = Symbol.for('zimage.http-admission.v1');
const PROTOCOL_VERSION = 1;
const BARRIER_ID = 'node-http-create-server-v1';
const CHECK_PATHS = new Set(['/api/health/ready', '/api/meta', '/api/public-config', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing', '/login']);
const FRAMEWORK_HOOK = 'response-cache-revalidate-v1';
// These exact files establish the image request/cache/async handoff boundaries.
// Upgrading Next requires a new source audit and these pins, not a version bypass.
const NEXT_SOURCE_HASHES = Object.freeze({
  'next/dist/server/lib/start-server.js': '840e9d4b844ef1adfb1b6435f219c9bf3af459b5738756c03919f9b46035ff0e',
  'next/dist/server/next-server.js': '973a8ed699b0295f4751d32fb53043574103f19c5a43d241d99ef9574c099fca',
  'next/dist/server/response-cache/index.js': '2f69084f08c875effc18db29f5ae4cf01fa23f76c26530c3e685bc7272121cc4',
  'next/dist/server/image-optimizer.js': 'b599e7d1483e6df7d941ca23c45a00c2b3db3903869180e1384ab4558af644ba',
  'next/dist/lib/batcher.js': 'fb64a7f69707222bed0a3bc8f9fca482db9a45aafe116ada65cc8a0ce641352b',
  'next/dist/lib/scheduler.js': '8198d8ad75e5d0dc739068bf3660dde1d0dad2fec9b5a208e75b8610d8e77ce0',
  'next/dist/server/lib/disk-lru-cache.external.js': '36676a59923aede5b12c419eb03689a58e29706e0af8cb15b47957036bdd835c',
  'next/dist/server/lib/lru-cache.js': 'b9b499c0213d746b6d7e2d6df2f99f1948c7a01034f9a1b0c3a4c860dc3cb56d',
  'next/dist/server/image-optimizer/transform.js': '7234aedad279bacd68855dfe629bfb5c50b6afe4cc58221543673d28c50a9455',
});

function validateControl(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'mode,operationId,schemaVersion'
    || body.schemaVersion !== 2 || !['open', 'draining', 'checking'].includes(body.mode)
    || typeof body.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/.test(body.operationId)) {
    throw new Error('Invalid HTTP admission control');
  }
  return body;
}
function parseControl(text) { return validateControl(JSON.parse(text)); }
function readControl() {
  for (const path of ['/etc', '/etc/zimage']) {
    const info = fs.lstatSync(path);
    if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022)) throw new Error('Untrusted control parent');
  }
  const fd = fs.openSync(CONTROL_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) || info.nlink !== 1 || info.size > 1024) throw new Error('Untrusted control file');
    return parseControl(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

function createAdmissionController(readGate = readControl) {
  let activeHttpRequests = 0, activeFrameworkWork = 0, wrappedServerCount = 0;
  let frameworkProbe;
  const contexts = new WeakMap();
  function gate() { return validateControl(readGate()); }
  function snapshot() {
    let control;
    try { control = gate(); } catch { /* fail closed */ }
    const frameworkWork = frameworkProbe ? frameworkProbe() : { protocolVersion: 1, installed: false, nextVersion: '16.4.1', hook: FRAMEWORK_HOOK, controlValid: false };
    return { protocolVersion: PROTOCOL_VERSION, barrierId: BARRIER_ID, installed: true,
      wrappedServerCount, activeHttpRequests, activeFrameworkWork, controlValid: !!control && (!frameworkProbe || frameworkWork.controlValid),
      frameworkWork,
      schemaVersion: 2, admissionMode: control?.mode ?? 'draining', admissionEpoch: control?.operationId ?? 'invalid-control' };
  }
  function admitted(req, upgrade) {
    try {
      if (frameworkProbe && !frameworkProbe().controlValid) return false;
      const control = gate();
      return control.mode === 'open' || (!upgrade && control.mode === 'checking'
        && (req.method === 'GET' || req.method === 'HEAD') && typeof req.url === 'string'
        && (CHECK_PATHS.has(req.url) || (req.url.startsWith('/_next/static/')
          && req.url.slice('/_next/static/'.length).split('/').every(part => /^[A-Za-z0-9._~-]+$/.test(part) && part !== '.' && part !== '..'))));
    } catch { return false; }
  }
  function deny(response, upgrade) {
    if (upgrade) {
      response.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nCache-Control: private, no-store\r\nRetry-After: 30\r\nContent-Length: 0\r\n\r\n');
      response.destroySoon();
    } else {
      const correlationId = randomUUID();
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'retry-after': '30', 'x-correlation-id': correlationId, connection: 'close' });
      response.end(JSON.stringify({ code: 'network', correlationId, message: '服务正在维护，请保留原请求编号，稍后重试。', retryable: true }));
    }
  }
  function wrapListener(listener) {
    function wrapped(req, response, ...rest) {
      const context = contexts.get(response);
      if (!context) throw new Error('HTTP callback invoked outside admission barrier');
      context.pending++;
      let result;
      try { result = Reflect.apply(listener, this, [req, response, ...rest]); }
      catch (error) { context.pending--; context.release(); throw error; }
      // Observe, but retain, the listener's exact return value and throw behavior.
      // A closed socket alone must not hide still-running native/async work.
      Promise.resolve(result).then(() => { context.pending--; context.release(); }, () => { context.pending--; context.release(); });
      return result;
    }
    wrapped.listener = listener.listener ?? listener;
    return wrapped;
  }
  function createServer(factory, receiver, args) {
    const wrappers = new WeakMap();
    function wrap(listener) {
      if (typeof listener !== 'function') return listener;
      let wrapped = wrappers.get(listener);
      if (!wrapped) { wrapped = wrapListener(listener); wrappers.set(listener, wrapped); }
      return wrapped;
    }
    const parameters = [...args];
    if (typeof parameters.at(-1) === 'function') parameters[parameters.length - 1] = wrap(parameters.at(-1));
    const server = Reflect.apply(factory, receiver, parameters);
    wrappedServerCount++;
    const emit = server.emit;
    server.emit = function(event, ...values) {
      if (!['request', 'upgrade', 'connect'].includes(event)) return Reflect.apply(emit, this, [event, ...values]);
      const [req, response] = values;
      const tunnel = event !== 'request';
      if (!admitted(req, tunnel)) { deny(response, tunnel); return true; }
      // No await between the persistent gate read and this increment. The Unix
      // status callback runs on the same event loop and cannot see a gap here.
      activeHttpRequests++;
      let terminal = response.destroyed === true || (!tunnel && response.writableFinished === true);
      let dispatched = false, released = false;
      const context = { pending: 0, release() {
        if (!released && dispatched && terminal && context.pending === 0) {
          released = true; activeHttpRequests--; contexts.delete(response);
          response.removeListener('finish', finish); response.removeListener('close', finish);
        }
      } };
      function finish() { terminal = true; context.release(); }
      contexts.set(response, context);
      if (!tunnel) response.once('finish', finish);
      response.once('close', finish);
      try { return Reflect.apply(emit, this, [event, ...values]); }
      finally { dispatched = true; context.release(); }
    };
    for (const method of ['on', 'addListener', 'prependListener']) {
      const register = server[method];
      server[method] = function(event, listener) {
        return Reflect.apply(register, this, [event, ['request', 'upgrade', 'connect'].includes(event) ? wrap(listener) : listener]);
      };
    }
    const remove = server.removeListener;
    server.removeListener = server.off = function(event, listener) {
      const mapped = wrappers.get(listener);
      const target = ['request', 'upgrade', 'connect'].includes(event)
        ? this.rawListeners(event).findLast(item => item === listener || item.listener === listener || item === mapped) ?? listener : listener;
      return Reflect.apply(remove, this, [event, target]);
    };
    return server;
  }
  function trackFramework(operation) {
    // Intake is gated once, at HTTP admission. Existing framework work and its
    // failure/cache-write finalizers MUST continue when maintenance closes.
    activeFrameworkWork++;
    let result;
    try { result = operation(); } catch (error) { activeFrameworkWork--; throw error; }
    Promise.resolve(result).then(() => { activeFrameworkWork--; }, () => { activeFrameworkWork--; });
    return result;
  }
  function setFrameworkProbe(probe) {
    if (frameworkProbe) throw new Error('Framework admission hooks already installed');
    frameworkProbe = probe;
  }
  return Object.freeze({ snapshot, createServer, trackFramework, setFrameworkProbe });
}

function installFrameworkTracking(controller, nextRequire) {
  if (controller.snapshot().frameworkWork.installed) throw new Error('Incompatible or repeated Next admission hook');
  if (nextRequire('next/package.json').version !== '16.4.1') throw new Error('HTTP admission requires audited Next 16.4.1');
  for (const [name, expected] of Object.entries(NEXT_SOURCE_HASHES)) {
    if (createHash('sha256').update(fs.readFileSync(nextRequire.resolve(name))).digest('hex') !== expected) throw new Error('Unaudited Next admission source: ' + name);
  }
  const diskPath = nextRequire.resolve('next/dist/server/lib/disk-lru-cache.external');
  // Existing image-optimizer imports could retain unobservable original exports.
  if (require.cache[diskPath]) throw new Error('Next disk cache loaded before HTTP admission preload');
  const responsePath = nextRequire.resolve('next/dist/server/response-cache');
  const responseExports = nextRequire(responsePath), responseModule = require.cache[responsePath];
  const ResponseCache = responseExports.default;
  if (!responseModule || responseModule.exports !== responseExports) throw new Error('Incompatible Next response cache module');
  const prototype = ResponseCache?.prototype;
  const methods = ['get', 'handleGet', 'revalidate', 'handleRevalidate'];
  const wrappers = new Map();
  // get covers keyless/minimal mode; handleGet covers lookup and stale handoff;
  // revalidate covers batched jobs; handleRevalidate covers prefetch direct work
  // and awaits generator, conversion, successful cache-write and failed retention.
  // Each increment is synchronous, before the original method can resolve stale.
  for (const name of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype ?? {}, name);
    if (typeof descriptor?.value !== 'function' || descriptor.configurable !== true || descriptor.writable !== true) throw new Error('Incompatible or repeated Next admission hook: ' + name);
  }
  const diskExports = nextRequire(diskPath), diskModule = require.cache[diskPath];
  const initialize = diskExports.getOrInitDiskLRU;
  if (typeof initialize !== 'function' || typeof diskExports.resetDiskLRU !== 'function'
    || !diskModule || diskModule.exports !== diskExports) throw new Error('Incompatible Next disk admission hook');
  function initializeTracked(cacheDir, maxSize, readEntries, evictEntry) {
    function evictTracked(...args) { return controller.trackFramework(() => Reflect.apply(evictEntry, this, args)); }
    return controller.trackFramework(() => Reflect.apply(initialize, this, [cacheDir, maxSize, readEntries, evictTracked]));
  }
  const diskDescriptors = Object.getOwnPropertyDescriptors(diskExports);
  diskDescriptors.getOrInitDiskLRU = { value: initializeTracked, enumerable: true, writable: false, configurable: false };
  const trackedDiskExports = Object.freeze(Object.defineProperties({}, diskDescriptors));
  Object.defineProperty(diskModule, 'exports', { value: trackedDiskExports, writable: false, configurable: false });
  for (const name of methods) {
    const original = prototype[name];
    function wrapped(...args) { return controller.trackFramework(() => Reflect.apply(original, this, args)); }
    Object.defineProperty(prototype, name, { value: wrapped, configurable: false, writable: false });
    wrappers.set(name, wrapped);
  }
  Object.freeze(responseExports);
  Object.defineProperty(responseModule, 'exports', { value: responseExports, writable: false, configurable: false });
  controller.setFrameworkProbe(() => ({ protocolVersion: 1, installed: true, nextVersion: '16.4.1', hook: FRAMEWORK_HOOK,
    controlValid: methods.every(name => prototype[name] === wrappers.get(name))
      && require.cache[diskPath] === diskModule && diskModule.exports === trackedDiskExports
      && require.cache[responsePath] === responseModule && responseModule.exports === responseExports && responseExports.default === ResponseCache }));
}

function installController(controller, nextRequire, qaOnly) {
  if (Object.hasOwn(globalThis, BRIDGE_KEY)) throw new Error('HTTP admission preload already installed');
  installFrameworkTracking(controller, nextRequire);
  const original = http.createServer;
  http.createServer = function(...args) { return controller.createServer(original, this, args); };
  syncBuiltinESMExports();
  const bridge = Object.freeze({ protocolVersion: PROTOCOL_VERSION, barrierId: BARRIER_ID, qaOnly, snapshot: controller.snapshot });
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: bridge, writable: false, configurable: false });
  return bridge;
}

function install() {
  // Resolve from the actual standalone entry, rather than the root helper's
  // install directory, so we observe the same module instance as Next itself.
  return installController(createAdmissionController(), createRequire(process.argv[1]), false);
}

function installForTesting({ readGate, nextRequire }) {
  // Explicit code-only QA injection. Never an environment/path override for the
  // production preload, and never accepted by enabled lifecycle instrumentation.
  if (process.env.ZIMAGE_LIFECYCLE_ENABLED === '1' || typeof readGate !== 'function' || typeof nextRequire !== 'function') throw new Error('HTTP admission QA install requires disabled lifecycle and explicit dependencies');
  return installController(createAdmissionController(readGate), nextRequire, true);
}

module.exports = { BRIDGE_KEY, PROTOCOL_VERSION, BARRIER_ID, CHECK_PATHS: Object.freeze([...CHECK_PATHS]), NEXT_SOURCE_HASHES, parseControl, readControl, createAdmissionController, installFrameworkTracking, install, installForTesting };
if (process.env.ZIMAGE_LIFECYCLE_ENABLED === '1') install();
