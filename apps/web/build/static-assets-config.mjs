// Shared browser/build validation. No network or filesystem access.
export function validatePublicAssetBase(raw) {
  if (raw === undefined || raw === '') return undefined;
  let url;
  try { url = new URL(raw); } catch { throw new Error('NEXT_PUBLIC_STATIC_ASSET_BASE_URL must be a versioned HTTPS URL'); }
  const exactHostname = url.hostname.length <= 253 && url.hostname.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !exactHostname
      || !/^\/static-assets\/[a-f0-9]{64}\/?$/.test(url.pathname)) {
    throw new Error('NEXT_PUBLIC_STATIC_ASSET_BASE_URL must use HTTPS /static-assets/<manifest-sha256> without credentials or query');
  }
  return url.href.replace(/\/$/, '');
}

export function publicAssetRemotePatterns(raw) {
  const base = validatePublicAssetBase(raw);
  if (!base) return [];
  const url = new URL(base);
  return [{ protocol: 'https', hostname: url.hostname, port: url.port,
    pathname: `${url.pathname}/commerce/**`, search: '' }];
}
