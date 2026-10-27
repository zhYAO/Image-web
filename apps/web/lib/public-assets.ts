import { validatePublicAssetBase } from '../build/static-assets-config.mjs';

// Explicitly public examples/brand images only. Never rewrite API, signed,
// uploaded, object/data URLs, static-import objects or authentication paths.
export function publicAssetUrl(value: string): string {
  const base = validatePublicAssetBase(process.env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL);
  if (!base || !value.startsWith('/commerce/') || /[?#\\\u0000-\u001f\u007f]/.test(value)) return value;
  try {
    const parts = value.slice(1).split('/').map(decodeURIComponent);
    if (parts.some(part => !part || part === '.' || part === '..' || /[/\\]/.test(part))) return value;
  } catch { return value; }
  return base + value;
}
