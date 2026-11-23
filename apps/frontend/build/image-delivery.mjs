import { readFileSync } from 'node:fs';

export const previewMetadataPath = '.release/external-images.json';
export { hash, imagePolicyVersion } from '../../web/build/public-image-build.mjs';
import { imagePolicyVersion, requirePinnedImageBase } from '../../web/build/public-image-build.mjs';
import { resolvePublicImageBase } from '../../web/build/public-image-base.mjs';
const policyUrl = new URL('../../../ops/aliyun/public-images.json', import.meta.url);
export function readImageDelivery(mode, rawBase, legacyBase = process.env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL) {
  if (!rawBase) {
    if (mode && mode !== 'bundled') throw new Error('An explicit image base is required');
    return undefined;
  }
  if (mode === 'bundled') throw new Error('Image base conflicts with legacy bundled mode');
  if (mode && mode !== 'external-preview') throw new Error('Unsupported image delivery mode');
  resolvePublicImageBase(rawBase, legacyBase, { offlinePreview: mode === 'external-preview' });
  requirePinnedImageBase(rawBase, { offlinePreview: mode === 'external-preview' });
  const raw = readFileSync(policyUrl), manifestSha256 = imagePolicyVersion(raw);
  const policy = JSON.parse(raw);
  const allowed = JSON.parse(readFileSync(new URL('./public-asset-allowlist.json', import.meta.url))).files.filter(name => name.startsWith('commerce/')).sort();
  const shared = JSON.parse(readFileSync(new URL('../../web/features/commerce/public-image-paths.json', import.meta.url))).sort();
  if (policy.schema !== 1 || policy.kind !== 'public-images' || policy.files?.length !== 62
      || policy.files.some(e => !/^commerce\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:jpg|webp)$/.test(e.path)
        || !Number.isSafeInteger(e.bytes) || e.bytes <= 0 || !/^[a-f0-9]{64}$/.test(e.sha256)
        || e.contentType !== (e.path.endsWith('.jpg') ? 'image/jpeg' : 'image/webp'))
      || new Set(policy.files.map(e => e.path)).size !== 62
      || JSON.stringify(policy.files.map(e => e.path).sort()) !== JSON.stringify(allowed)
      || JSON.stringify(shared) !== JSON.stringify(allowed)) throw new Error('Public image policies differ');
  let base;
  try { base = new URL(rawBase); } catch { throw new Error('Explicit immutable HTTPS preview base required'); }
  if (!['https://www.zimage.store', 'https://assets.zimage.test'].includes(base.origin)
      || base.username || base.password || base.search || base.hash
      || rawBase !== base.href || base.pathname !== '/static-assets/' + manifestSha256) throw new Error('Preview base differs from pinned public image manifest');
  return { schema: 1, kind: 'external-preview', productionVerified: false, baseUrl: base.href,
    manifestSha256, files: policy.files };
}

export function validatePreview(value) {
  const expected = readImageDelivery('external-preview', value?.baseUrl);
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Unexpected image preview metadata');
  return expected;
}
