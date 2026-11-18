'use strict';

// Loaded by Node --require before the unmodified Next standalone server. Next
// 16.4.5 start-server.js awaits requestHandler inside its createServer callback.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire, syncBuiltinESMExports } = require('node:module');
const { createHash, randomUUID } = require('node:crypto');
const CONTROL_FILE = '/etc/zimage/backend-maintenance.json';
const BRIDGE_KEY = Symbol.for('zimage.http-admission.v1');
const PROTOCOL_VERSION = 1;
const BARRIER_ID = 'node-http-create-server-v1';
const CHECK_PATHS = new Set(['/api/health/ready', '/api/meta', '/api/public-config', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing', '/login']);
const FRAMEWORK_HOOK = 'response-cache-revalidate-v1';
const CATALOG_PATH = path.join(__dirname, 'next-source-profiles.json');
if (process.env.ZIMAGE_LIFECYCLE_ENABLED === '1' || (require.main === module && process.argv[2] === 'inspect')) {
  trustedLegacyEntry(CATALOG_PATH);
  trustedLegacyEntry(__filename);
}
const SOURCE_PROFILES = require('./next-source-profiles.json');
const NEXT_VERSION = '16.4.x';
// These exact files establish the image request/cache/async handoff boundaries.
// Upgrading Next requires a new source audit and these pins, not a version bypass.
const NEXT_SOURCE_HASHES = Object.freeze(SOURCE_PROFILES.profiles[SOURCE_PROFILES.candidateProfile].hashes);
const LEGACY_RELEASES = new Set(['7a811b326aa4b344cee08bc5a33c04e44a780fd4', 'fb4fb09f909c0ae5dce98ebd0d9540386685ddb7']);
if (SOURCE_PROFILES.schema !== 1 || SOURCE_PROFILES.legacy.releases.length !== 2
    || !SOURCE_PROFILES.legacy.releases.every(sha => LEGACY_RELEASES.has(sha))) throw new Error('Invalid historical Next binding');
for (const [id, profile] of Object.entries(SOURCE_PROFILES.profiles)) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(profile.hashes).sort()));
  if (Object.keys(profile.hashes).length !== 9 || id !== 'sha256:' + createHash('sha256').update(canonical).digest('hex')) throw new Error('Invalid reviewed Next profile');
  Object.freeze(profile.hashes);
  Object.freeze(profile);
}
Object.freeze(SOURCE_PROFILES.profiles);
Object.freeze(SOURCE_PROFILES.legacy.releases);
Object.freeze(SOURCE_PROFILES.legacy);
Object.freeze(SOURCE_PROFILES);
function stableNext(version) {
  const match = typeof version === 'string' && /^16\.4\.(0|[1-9][0-9]*)$/.exec(version);
  return !!match && Number.isSafeInteger(Number(match[1]));
}
function legacyReleaseFromCanonicalPath(entry) {
  const match = /^\/opt\/zimage\/releases\/([a-f0-9]{40})\/apps\/web\/server\.js$/.exec(entry);
  return match && LEGACY_RELEASES.has(match[1]) ? match[1] : undefined;
}
function frameworkProfile(version, hashes, legacyRelease) {
  if (!stableNext(version)) throw new Error('HTTP admission requires audited Next stable 16.4.x');
  if (legacyRelease !== undefined && (!LEGACY_RELEASES.has(legacyRelease) || version !== SOURCE_PROFILES.legacy.nextVersion)) throw new Error('Unapproved legacy Next release/version');
  const profileId = legacyRelease === undefined ? SOURCE_PROFILES.candidateProfile : SOURCE_PROFILES.legacy.profile;
  const expected = SOURCE_PROFILES.profiles[profileId].hashes;
  if (!hashes || Object.keys(hashes).length !== 9 || !Object.entries(expected).every(([name, value]) => hashes[name] === value)) throw new Error('Unaudited Next admission source profile');
  return { version, profileId, hashes: expected, legacy: legacyRelease !== undefined };
}
function trustedLegacyEntry(entry) {
  // Production callers get entry only from realpath(process.argv[1]). Existing
  // managed release/helper trust checks remain; no environment override exists.
  for (let current = entry; ; current = path.dirname(current)) {
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || info.uid !== 0 || (info.mode & 0o022))
      throw new Error('Untrusted retained Next entry');
    if (current === path.dirname(current)) break;
  }
}

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
    const frameworkWork = frameworkProbe ? frameworkProbe() : { protocolVersion: 1, installed: false, nextVersion: NEXT_VERSION, hook: FRAMEWORK_HOOK, controlValid: false };
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

function inspectRuntime(nextRequire, entry, strict) {
  const pkg = nextRequire('next/package.json');
  if (!stableNext(pkg.version)) throw new Error('HTTP admission requires audited Next stable 16.4.x');
  if (typeof nextRequire.resolve !== 'function') throw new Error('Unaudited Next source resolution');
  const packagePath = fs.realpathSync(nextRequire.resolve('next/package.json'));
  const packageRoot = path.dirname(packagePath);
  const publicEntry = fs.realpathSync(nextRequire.resolve('next'));
  if (!publicEntry.startsWith(packageRoot + path.sep)
      || publicEntry !== fs.realpathSync(path.join(packageRoot, 'dist/server/next.js'))) throw new Error('Unaudited Next admission source module identity');
  const paths = {}, hashes = {};
  for (const name of Object.keys(NEXT_SOURCE_HASHES)) {
    const resolved = fs.realpathSync(nextRequire.resolve(name));
    if (!resolved.startsWith(packageRoot + path.sep)
        || resolved !== fs.realpathSync(path.join(packageRoot, name.slice(5)))) throw new Error('Unaudited Next admission source module identity');
    paths[name] = resolved;
    hashes[name] = createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  }
  let release, legacyRelease, appPackage;
  if (strict) {
    entry = fs.realpathSync(entry);
    const match = /^(\/opt\/zimage\/releases\/([a-f0-9]{40}))\/apps\/web\/server\.js$/.exec(entry);
    if (!match) throw new Error('Next identity requires canonical immutable release entry');
    release = match[2];
    legacyRelease = legacyReleaseFromCanonicalPath(entry);
    appPackage = path.join(path.dirname(entry), 'package.json');
    const declared = JSON.parse(fs.readFileSync(appPackage, 'utf8')).dependencies?.next;
    if (declared !== pkg.version || !stableNext(declared)) throw new Error('Resolved Next differs from artifact pin');
    for (const file of [entry, appPackage, packagePath, publicEntry, ...Object.values(paths)]) {
      if (!fs.realpathSync(file).startsWith(match[1] + '/')) throw new Error('Next module escapes immutable release');
      trustedLegacyEntry(fs.realpathSync(file));
    }
    trustedLegacyEntry(CATALOG_PATH);
    trustedLegacyEntry(__filename);
  }
  const profile = frameworkProfile(pkg.version, hashes, legacyRelease);
  const contract = profile.legacy
    ? { protocolVersion: 1, nextVersion: pkg.version }
    : { protocolVersion: 2, nextVersion: pkg.version, sourceProfile: profile.profileId };
  const files = strict ? [entry, appPackage, packagePath, publicEntry, ...Object.values(paths), CATALOG_PATH, __filename].map(file => {
    file = fs.realpathSync(file);
    const s = fs.statSync(file, { bigint: true });
    return { path: file, identity: [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.uid].map(String) };
  }) : [];
  return { pkg, packagePath, publicEntry, paths, profile, contract, release, files };
}

function installFrameworkTracking(controller, nextRequire, runtime) {
  if (controller.snapshot().frameworkWork.installed) throw new Error('Incompatible or repeated Next admission hook');
  if (!runtime) {
    if (process.env.ZIMAGE_LIFECYCLE_ENABLED === '1') throw new Error('Production hooks require immutable release identity');
    runtime = inspectRuntime(nextRequire, undefined, false);
  }
  const { profile, contract, pkg, packagePath } = runtime;
  const packageModule = require.cache[packagePath];
  if (!packageModule || packageModule.exports !== pkg) throw new Error('Next package module identity differs');
  Object.freeze(pkg);
  const diskPath = fs.realpathSync(nextRequire.resolve('next/dist/server/lib/disk-lru-cache.external'));
  if (diskPath !== runtime.paths['next/dist/server/lib/disk-lru-cache.external.js']) throw new Error('Next disk module alias differs from audited identity');
  // Existing image-optimizer imports could retain unobservable original exports.
  if (require.cache[diskPath]) throw new Error('Next disk cache loaded before HTTP admission preload');
  const responsePath = fs.realpathSync(nextRequire.resolve('next/dist/server/response-cache'));
  if (responsePath !== runtime.paths['next/dist/server/response-cache/index.js']) throw new Error('Next response module alias differs from audited identity');
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
  controller.setFrameworkProbe(() => ({ ...contract, installed: true, hook: FRAMEWORK_HOOK,
    controlValid: methods.every(name => prototype[name] === wrappers.get(name))
      && pkg.version === profile.version && require.cache[packagePath] === packageModule && packageModule.exports === pkg
      && fs.realpathSync(nextRequire.resolve('next')) === runtime.publicEntry
      && Object.entries(runtime.paths).every(([name, resolved]) => fs.realpathSync(nextRequire.resolve(name)) === resolved)
      && require.cache[diskPath] === diskModule && diskModule.exports === trackedDiskExports
      && require.cache[responsePath] === responseModule && responseModule.exports === responseExports && responseExports.default === ResponseCache }));
}

function installController(controller, nextRequire, qaOnly, entry) {
  if (Object.hasOwn(globalThis, BRIDGE_KEY)) throw new Error('HTTP admission preload already installed');
  installFrameworkTracking(controller, nextRequire, inspectRuntime(nextRequire, entry, !qaOnly));
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
  const entry = fs.realpathSync(process.argv[1]);
  return installController(createAdmissionController(), createRequire(entry), false, entry);
}

function installForTesting({ readGate, nextRequire }) {
  // Explicit code-only QA injection. Never an environment/path override for the
  // production preload, and never accepted by enabled lifecycle instrumentation.
  if (process.env.ZIMAGE_LIFECYCLE_ENABLED === '1' || typeof readGate !== 'function' || typeof nextRequire !== 'function') throw new Error('HTTP admission QA install requires disabled lifecycle and explicit dependencies');
  return installController(createAdmissionController(readGate), nextRequire, true);
}

module.exports = { BRIDGE_KEY, PROTOCOL_VERSION, BARRIER_ID, CHECK_PATHS: Object.freeze([...CHECK_PATHS]), NEXT_SOURCE_HASHES, SOURCE_PROFILES, stableNext, inspectRuntime, legacyReleaseFromCanonicalPath, frameworkProfile, trustedLegacyEntry, parseControl, readControl, createAdmissionController, installFrameworkTracking, install, installForTesting };
const inspection = require.main === module && process.argv.length === 4 && process.argv[2] === 'inspect';
if (inspection) {
  const value = inspectRuntime(createRequire(process.argv[3]), process.argv[3], true);
  console.log(JSON.stringify({ release: value.release, contract: value.contract, files: value.files }));
} else if (process.env.ZIMAGE_LIFECYCLE_ENABLED === '1') install();
