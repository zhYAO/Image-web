// Browser-safe parsing only. This is the single new user-facing image prefix.
import { validatePublicAssetBase } from './static-assets-config.mjs';

export function validatePublicImageBase(raw, { offlinePreview = false } = {}) {
  if (raw === undefined || raw === '') return undefined;
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid ZIMAGE_PUBLIC_IMAGE_BASE_URL'); }
  const originAllowed = url.origin === 'https://www.zimage.store'
    || (offlinePreview && url.origin === 'https://assets.zimage.test');
  if (!originAllowed || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.href !== raw || !/^\/static-assets\/[a-f0-9]{64}$/.test(url.pathname)) {
    throw new Error('ZIMAGE_PUBLIC_IMAGE_BASE_URL must be an exact trusted immutable HTTPS image prefix');
  }
  return url.href;
}

export function resolvePublicImageBase(raw, legacy, options) {
  const base = validatePublicImageBase(raw, options);
  const old = validatePublicAssetBase(legacy);
  if (base && old && base !== old) throw new Error('ZIMAGE_PUBLIC_IMAGE_BASE_URL conflicts with the legacy example-image base');
  return base ?? old;
}
