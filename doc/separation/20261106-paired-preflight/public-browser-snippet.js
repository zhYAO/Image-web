void (() => {
  "use strict";
  try {
    const kernel = (function browserReadonlyKernel(env = globalThis) {
  const ORIGIN = 'https://www.zimage.store';
  const PATHS = Object.freeze(['/api/health/ready', '/api/meta', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing']);
  const CATALOG = PATHS[5];
  const FAILURE = 'Read-only verification failed; no receipt generated.';
  const REQUEST_KEYS = ['schemaVersion', 'operationId', 'backendRelease', 'pid', 'nonce', 'createdAt', 'expiresAt'];
  const MAX_BODY = 2_000_000;
  const encoder = new env.TextEncoder();
  const fail = () => { throw new Error(FAILURE); };
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  const matches = (v, re) => typeof v === 'string' && re.test(v);
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const timestamp = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
  const uuid = v => matches(v, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const operation = v => matches(v, /^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/);
  const release = v => matches(v, /^[a-f0-9]{40}$/);
  const clone = v => JSON.parse(JSON.stringify(v));

  function validateConfig(config) {
    if (!exact(config, ['operationId', 'allowedReleases']) || !operation(config.operationId)
        || !Array.isArray(config.allowedReleases) || config.allowedReleases.length < 1 || config.allowedReleases.length > 8
        || !config.allowedReleases.every(release) || new Set(config.allowedReleases).size !== config.allowedReleases.length) fail();
    return { operationId: config.operationId, allowedReleases: [...config.allowedReleases] };
  }

  function originCheck() {
    if (env.location.origin !== ORIGIN || env.top !== env.self) fail();
  }

  // Preserve duplicate names and integer wire spellings before JavaScript's
  // numeric representation erases the Python int/float distinction.
  function parseJSON(text, integerAt = () => false) {
    let at = 0;
    const whitespace = () => { while (/[\x20\t\r\n]/.test(text[at] || '\0')) at++; };
    function string() {
      const start = at++;
      if (text[start] !== '"') fail();
      while (at < text.length) {
        if (text[at] === '"') return JSON.parse(text.slice(start, ++at));
        if (text[at] === '\\') at++;
        at++;
      }
      return fail();
    }
    function read(path) {
      if (path.length > 64) fail();
      whitespace();
      if (text[at] === '"') return string();
      if (text[at] === '{' || text[at] === '[') {
        const object = text[at++] === '{';
        const end = object ? '}' : ']';
        const value = object ? Object.create(null) : [];
        whitespace();
        if (text[at] !== end) {
          while (true) {
            const key = object ? string() : value.length;
            if (object) {
              if (Object.hasOwn(value, key)) fail();
              whitespace(); if (text[at++] !== ':') fail();
            }
            value[key] = read([...path, key]);
            whitespace();
            if (text[at] !== ',') break;
            at++; whitespace();
          }
        }
        if (text[at++] !== end) fail();
        return value;
      }
      for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
        if (text.startsWith(literal, at)) { at += literal.length; return value; }
      }
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
      if (!match || integerAt(path) && !/^(?:0|[1-9][0-9]*)$/.test(match[0])) fail();
      at += match[0].length;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) fail();
      return value;
    }
    const result = read([]);
    whitespace(); if (at !== text.length) fail();
    return result;
  }

  function parseRequest(text) {
    try {
      if (typeof text !== 'string' || !text.length || text.length > 4096 || encoder.encode(text).length > 4096) fail();
      const value = parseJSON(text, path => path.length === 1 && ['schemaVersion', 'pid'].includes(path[0]));
      if (!exact(value, REQUEST_KEYS) || value.schemaVersion !== 1 || !operation(value.operationId) || !release(value.backendRelease)
          || !matches(value.nonce, /^[a-f0-9]{64}$/) || !Number.isInteger(value.pid) || value.pid < 1 || value.pid > 2147483647
          || !timestamp(value.createdAt) || !timestamp(value.expiresAt) || !(value.expiresAt - value.createdAt > 0)
          || value.expiresAt - value.createdAt > 120) fail();
      return value;
    } catch { return fail(); }
  }

  // Python repr uses scientific notation below 1e-4, with a two-digit
  // exponent. Integral timestamp floats are normalized to integers by v2.
  function canonicalNumber(value) {
    if (!timestamp(value)) fail();
    if (Number.isInteger(value)) return String(value);
    if (value >= 0.0001) return String(value);
    const [coefficient, exponent] = value.toExponential().split('e');
    return coefficient + 'e' + (Number(exponent) < 0 ? '-' : '+') + String(Math.abs(Number(exponent))).padStart(2, '0');
  }

  function canonicalRequest(request) {
    return '{' + Object.keys(request).sort().map(key => JSON.stringify(key) + ':'
      + (['createdAt', 'expiresAt'].includes(key) ? canonicalNumber(request[key]) : JSON.stringify(request[key]))).join(',') + '}\n';
  }
  async function sha256(text) {
    const digest = await env.crypto.subtle.digest('SHA-256', encoder.encode(text));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function requestDigest(request) { return sha256(canonicalRequest(request)); }

  function awareDate(value) {
    if (typeof value !== 'string') return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m) return false;
    const [, year, month, day, hour, minute, second = '0', zone] = m;
    const y = Number(year), mo = Number(month), d = Number(day);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]
      && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
      && (zone === 'Z' || Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59);
  }

  function validateBody(path, body) {
    if (!record(body)) return false;
    if (path === PATHS[0]) return body.status === 'ok' && typeof body.version === 'string';
    if (path === PATHS[1]) return exact(body, ['schemaVersion', 'backendRelease', 'api', 'capabilities']) && body.schemaVersion === 1
      && exact(body.api, ['major', 'minor']) && body.api.major === 1 && integer(body.api.minor)
      && Array.isArray(body.capabilities) && body.capabilities.length <= 256
      && body.capabilities.every(c => typeof c === 'string' && c.length <= 100 && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(c))
      && new Set(body.capabilities).size === body.capabilities.length;
    if (path === PATHS[2]) return exact(body, ['id']) && uuid(body.id);
    if (path === PATHS[3]) return uuid(body.id) && body.status === 'active' && Object.hasOwn(body, 'displayName')
      && (body.displayName === null || typeof body.displayName === 'string' && [...body.displayName].length <= 80)
      && matches(body.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    if (path === PATHS[4]) return exact(body, ['sessions']) && Array.isArray(body.sessions) && body.sessions.every(item =>
      record(item) && ['id', 'status', 'title', 'createdAt', 'updatedAt'].every(k => Object.hasOwn(item, k))
      && Object.keys(item).every(k => ['id', 'status', 'title', 'createdAt', 'updatedAt', 'activityTypes'].includes(k))
      && uuid(item.id) && ['active', 'deleting'].includes(item.status)
      && typeof item.title === 'string' && [...item.title.trim()].length >= 1 && [...item.title.trim()].length <= 100
      && awareDate(item.createdAt) && awareDate(item.updatedAt)
      && (!Object.hasOwn(item, 'activityTypes') || Array.isArray(item.activityTypes)
        && item.activityTypes.every(t => ['chat', 'image', 'commerce', 'poster'].includes(t))));
    if (path !== CATALOG || !exact(body, ['version', 'enabled', 'prices']) || typeof body.version !== 'string'
        || typeof body.enabled !== 'boolean' || !Array.isArray(body.prices)) return false;
    return body.prices.every(price => {
      const required = ['operation', 'provider', 'model', 'resolution', 'unitMinor', 'label'];
      const optional = ['rateVersion', 'billingMode', 'tokenTariff'];
      if (!record(price) || !required.every(k => Object.hasOwn(price, k)) || !Object.keys(price).every(k => [...required, ...optional].includes(k))
          || !['image', 'chat', 'optimize'].includes(price.operation) || typeof price.provider !== 'string' || !price.provider
          || typeof price.model !== 'string' || !price.model || typeof price.resolution !== 'string' || typeof price.label !== 'string'
          || !integer(price.unitMinor) || price.unitMinor < 1) return false;
      if (Object.hasOwn(price, 'rateVersion') && !(typeof price.rateVersion === 'string' && [...price.rateVersion].length >= 1 && [...price.rateVersion].length <= 100)) return false;
      if (Object.hasOwn(price, 'billingMode') && price.billingMode !== 'usage_capped') return false;
      if (Object.hasOwn(price, 'tokenTariff')) {
        const tariff = price.tokenTariff;
        const rates = ['inputPerMillionNano', 'cachedInputPerMillionNano', 'outputPerMillionNano'];
        const limits = ['maxInputTokens', 'maxOutputTokens'];
        if (!exact(tariff, [...rates, ...limits]) || !rates.every(k => typeof tariff[k] === 'string')
            || !limits.every(k => typeof tariff[k] === 'number' && Number.isFinite(tariff[k]))) return false;
      }
      return true;
    });
  }

  async function boundedJSON(response, path) {
    if (Number(response.headers.get('content-length')) > MAX_BODY || !response.body) fail();
    const reader = response.body.getReader();
    const decoder = new env.TextDecoder('utf-8', { fatal: true });
    let total = 0, text = '', complete = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) { complete = true; break; }
        total += value.byteLength;
        if (total > MAX_BODY) fail();
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return parseJSON(text, keys => path === PATHS[1]
        ? keys.length === 1 && keys[0] === 'schemaVersion' || keys.length === 2 && keys[0] === 'api' && ['major', 'minor'].includes(keys[1])
        : path === CATALOG && keys.length === 3 && keys[0] === 'prices' && keys[2] === 'unitMinor');
    } finally {
      if (!complete) { try { await reader.cancel(); } catch {} }
      reader.releaseLock();
    }
  }

  function createVerifier(configuration) {
    try {
      originCheck();
      const config = validateConfig(configuration);
      const started = env.performance.now();
      if (!Number.isFinite(started)) fail();
      const rounds = new Map();
      const clock = () => env.Date.now() / 1000;
      function current(request) {
        originCheck();
        const tick = env.performance.now(), now = clock();
        if (!Number.isFinite(tick) || tick < started || tick - started >= 1_200_000 || !timestamp(now)
            || request.operationId !== config.operationId || !config.allowedReleases.includes(request.backendRelease)
            || now < request.createdAt || now > request.expiresAt) fail();
        return now;
      }
      async function fetchFixed(path, request) {
        current(request);
        if (!PATHS.includes(path)) fail();
        const controller = new env.AbortController();
        const timeout = env.setTimeout(() => controller.abort(), Math.max(1, Math.min(12_000,
          (request.expiresAt - clock()) * 1000, 1_200_000 - (env.performance.now() - started))));
        try {
          const headers = { Accept: 'application/json' };
          if (path === CATALOG) headers['x-zimage-readonly-probe'] = 'catalog-v1';
          const url = ORIGIN + path;
          const response = await env.fetch(url, { method: 'GET', headers, credentials: 'same-origin',
            redirect: 'error', cache: 'no-store', mode: 'same-origin', signal: controller.signal });
          if (controller.signal.aborted || response.status !== 200 || response.redirected || response.url && response.url !== url) fail();
          const body = await boundedJSON(response, path);
          current(request);
          if (controller.signal.aborted || !validateBody(path, body)
              || !response.headers.get('cache-control')?.toLowerCase().includes('no-store')
              || path === CATALOG && response.headers.get('x-zimage-readonly-probe') !== 'catalog-v1') fail();
          if (path === PATHS[0] && body.version !== request.backendRelease
              || path === PATHS[1] && body.backendRelease !== request.backendRelease) fail();
          return body;
        } finally { env.clearTimeout(timeout); }
      }
      async function run(request) {
        const checks = [];
        let identity;
        for (const path of PATHS) {
          const body = await fetchFixed(path, request);
          if (path === PATHS[2]) identity = body.id;
          if (path === PATHS[3] && body.id !== identity) fail();
          checks.push({ path, status: 200, noStore: true, authenticated: checks.length >= 2 });
        }
        identity = undefined;
        await fetchFixed(PATHS[1], request);
        const requestSha256 = await requestDigest(request);
        const checkedAt = current(request);
        return { schemaVersion: 1, verifierProtocol: 'zimage-backend-readonly-v2', operationId: request.operationId,
          backendRelease: request.backendRelease, pid: request.pid, nonce: request.nonce, requestSha256, checkedAt, checks,
          authenticatedReadOnly: true, independentPublic: true, catalogReady: true };
      }
      return Object.freeze({
        async verify(text) {
          try {
            const request = parseRequest(text);
            current(request);
            const binding = canonicalRequest(request);
            let round = rounds.get(request.nonce);
            if (round && round.binding !== binding) fail();
            if (!round) {
              if (rounds.size >= 8) fail();
              // Store before yielding: concurrent submissions share one attempt.
              round = { binding, promise: run(request).catch(() => fail()) };
              rounds.set(request.nonce, round);
            }
            const receipt = await round.promise;
            current(request);
            return clone(receipt);
          } catch { return fail(); }
        },
      });
    } catch { return fail(); }
  }


  function mount(configuration) {
    try {
      originCheck();
      const document = env.document;
      const mountId = 'zimage-browser-readonly-verifier-v2';
      if (!document.body || document.getElementById(mountId)) fail();
      const config = validateConfig(configuration);
      const verifier = createVerifier(config);
      const host = document.createElement('section'); host.id = mountId;
      host.style.cssText = 'position:fixed;inset:16px 16px auto auto;z-index:2147483647;max-height:90vh;overflow:auto;width:min(640px,90vw);background:white;color:#111;border:2px solid #1746a2;padding:16px;font:14px/1.5 system-ui;box-shadow:0 8px 40px #0004;';
      host.setAttribute('aria-label', 'Zimage read-only verification');
      const root = host.attachShadow({ mode: 'closed' });
      const title = document.createElement('h2'); title.textContent = 'Zimage read-only verification';
      const instructions = document.createElement('p');
      instructions.textContent = 'Select or paste only the public seven-field request JSON. This helper uses the signed-in page for seven fixed GETs. It accepts up to eight nonce rounds within twenty minutes.';
      const authority = document.createElement('p');
      authority.textContent = 'Operation: ' + config.operationId + ' | Allowed releases: ' + config.allowedReleases.join(', ');
      const fileLabel = document.createElement('label'); fileLabel.textContent = 'Public request JSON file (maximum 4 KB)';
      const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json';
      fileLabel.append(file);
      const textLabel = document.createElement('label'); textLabel.textContent = 'Public request JSON';
      const text = document.createElement('textarea'); text.rows = 8; text.cols = 70; text.maxLength = 4096;
      text.setAttribute('aria-label', 'Public request JSON'); textLabel.append(text);
      const verify = document.createElement('button'); verify.type = 'button'; verify.textContent = 'Verify public request';
      const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Download redacted receipt'; download.disabled = true;
      const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Ready for a public request.';
      const digest = document.createElement('p');
      const output = document.createElement('pre'); output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:36vh;overflow:auto;';
      let bytes = '', busy = false, closed = false;
      const clear = () => { bytes = ''; output.textContent = ''; digest.textContent = ''; download.disabled = true; };
      const lock = value => { verify.disabled = value || closed; file.disabled = value || closed; text.disabled = value || closed; };
      file.addEventListener('change', async () => {
        if (busy || closed) return;
        clear(); text.value = ''; status.textContent = 'Ready for a public request.';
        try {
          const selected = file.files;
          if (!selected || selected.length !== 1 || selected[0].size < 1 || selected[0].size > 4096) fail();
          const input = await selected[0].text();
          parseRequest(input);
          if (!closed && !busy) text.value = input;
        } catch { status.textContent = FAILURE; }
        finally { file.value = ''; }
      });
      verify.addEventListener('click', async () => {
        if (busy || closed) return;
        busy = true; clear(); lock(true); status.textContent = 'Checking fixed read-only routes…';
        const input = text.value; text.value = ''; file.value = '';
        try {
          const receipt = await verifier.verify(input);
          const next = JSON.stringify(receipt, null, 2) + '\n';
          const hash = await sha256(next);
          if (closed) fail();
          bytes = next; output.textContent = bytes; digest.textContent = 'Receipt SHA-256: ' + hash;
          download.disabled = false; status.textContent = 'Redacted receipt ready. Send only the receipt and its SHA-256.';
        } catch { clear(); status.textContent = FAILURE; }
        finally { busy = false; lock(false); }
      });
      download.addEventListener('click', () => {
        if (!bytes || closed || busy) return;
        try {
          const url = env.URL.createObjectURL(new env.Blob([bytes], { type: 'application/json;charset=utf-8' }));
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'backend-readonly-receipt.json';
          root.append(anchor); anchor.click(); anchor.remove();
          const cleanup = env.setTimeout(() => env.URL.revokeObjectURL(url), 1000); cleanup?.unref?.();
        } catch { clear(); status.textContent = FAILURE; }
      });
      root.append(title, instructions, authority, fileLabel, textLabel, verify, download, status, digest, output);
      document.body.append(host);
      const expiry = env.setTimeout(() => {
        closed = true; text.value = ''; file.value = ''; clear(); lock(true); status.textContent = 'Helper deadline reached. No further requests accepted.';
      }, 1_200_000);
      expiry?.unref?.();
    } catch { return fail(); }
  }

  return Object.freeze({ createVerifier, parseRequest, requestDigest, validateBody, validateConfig, mount });
})();
    kernel.mount({
  "operationId": "paired-7a811b3-20261106",
  "allowedReleases": [
    "fb4fb09f909c0ae5dce98ebd0d9540386685ddb7",
    "7a811b326aa4b344cee08bc5a33c04e44a780fd4"
  ]
});
  } catch {
    globalThis.alert("Read-only verification failed; no receipt generated.");
  }
})();
