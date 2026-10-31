import { setTimeout as delay } from 'node:timers/promises';
import { validateCandidateDescriptor } from '../scripts/candidate-metadata.mjs';

export function localBackendOrigin(value) {
  if (typeof value !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+\/?$/.test(value)) {
    throw new Error('开发后端必须是带端口的 http://127.0.0.1、localhost 或 [::1] 地址。');
  }
  const url = new URL(value);
  if (!url.port || Number(url.port) < 1 || Number(url.port) > 65535) throw new Error('开发后端端口无效。');
  return url.origin;
}

export function descriptorFromMeta(meta, expectedSHA) {
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  if (!/^[a-f0-9]{40}$/.test(expectedSHA ?? '')
    || !exactKeys(meta, ['schemaVersion', 'backendRelease', 'api', 'capabilities'])
    || meta.schemaVersion !== 1 || meta.backendRelease !== expectedSHA
    || !exactKeys(meta.api, ['major', 'minor']) || meta.api.major !== 1
    || !Number.isSafeInteger(meta.api.minor) || meta.api.minor < 0
    || !Array.isArray(meta.capabilities)
    || !['runtime.meta.v1', 'runtime.public-config.v1'].every(capability => meta.capabilities.includes(capability))) {
    throw new Error('开发后端身份或 API 能力不匹配；请确认当前源码与 --backend-sha。');
  }
  return validateCandidateDescriptor({
    apiRequirements: { major: meta.api.major, minMinor: meta.api.minor, capabilities: [...meta.capabilities] },
    allowedBackendReleases: [meta.backendRelease],
  });
}

function requireFormalConfig(config) {
  const keys = ['schemaVersion', 'formalAuth', 'dataMode', 'captchaSiteKey', 'approvedLegalVersion', 'registrationEnabled'];
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).length !== keys.length || !keys.every(key => Object.hasOwn(config, key))
    || config.schemaVersion !== 1 || config.dataMode !== 'http' || config.formalAuth !== true
    || typeof config.registrationEnabled !== 'boolean'
    || (config.captchaSiteKey !== null && typeof config.captchaSiteKey !== 'string')
    || (config.approvedLegalVersion !== null && typeof config.approvedLegalVersion !== 'string')) {
    throw new Error('dev:split 需要真实 HTTP 后端和正式认证配置；检查 apps/web/.env.local，不能使用匿名或 Mock 模式。');
  }
}

/** Startup retries are bounded, read-only and limited to the selected loopback origin. */
export async function readDevRuntime(origin, expectedSHA, { request = fetch, signal, timeoutMs = 120000, pollMs = 300 } = {}) {
  const backend = localBackendOrigin(origin);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    let responses;
    try {
      responses = await Promise.all(['/api/public-config', '/api/meta'].map(path => request(`${backend}${path}`, {
        method: 'GET', cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now())))]) : AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
      })));
    } catch {
      signal?.throwIfAborted();
    }
    if (responses?.every(response => response.ok)) {
      if (responses.some(response => !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''))) throw new Error('开发后端未返回 JSON 运行时配置。');
      let config, meta;
      try { [config, meta] = await Promise.all(responses.map(response => response.json())); }
      catch { throw new Error('开发后端运行时配置格式无效。'); }
      requireFormalConfig(config);
      return descriptorFromMeta(meta, expectedSHA);
    }
    if (responses?.some(response => !response.ok && response.status !== 503)) throw new Error('开发后端运行时接口不可用；请确认 API 路径和所运行的版本。');
    await Promise.all(responses?.map(response => response.body?.cancel()) ?? []);
    if (Date.now() < deadline) await delay(Math.min(pollMs, deadline - Date.now()), undefined, { signal });
  }
  throw new Error('开发后端未就绪：检查 apps/web/.env.local 中真实 Supabase URL/公钥及后端日志；不会回退到 Mock。');
}

export function devProxyOptions(origin) {
  return {
    '^/api(?:/|$)': {
      target: localBackendOrigin(origin), changeOrigin: false, xfwd: false,
      // Keep the browser Origin/Host, Cookie and Set-Cookie unchanged. The backend
      // owns CSRF checks; Vite pipes response chunks without a timeout or buffer.
      timeout: 0, proxyTimeout: 0,
    },
  };
}
