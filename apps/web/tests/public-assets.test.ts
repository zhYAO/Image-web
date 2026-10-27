import { afterEach, describe, expect, it, vi } from 'vitest';

import { publicAssetUrl } from '@/lib/public-assets';
import { publicAssetRemotePatterns, validatePublicAssetBase } from '@/build/static-assets-config.mjs';
import { commerceExampleForScene, templatePreviewUrl } from '@/features/commerce/commerce-examples';

const digest = 'a'.repeat(64);
const base = `https://www.zimage.store/static-assets/${digest}`;
afterEach(() => vi.unstubAllEnvs());

describe('versioned public resources', () => {
  it('uses repository URLs by default for offline development and existing deployments', () => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_ASSET_BASE_URL', '');
    expect(publicAssetUrl('/commerce/apparel-v2/main-1.webp')).toBe('/commerce/apparel-v2/main-1.webp');
    expect(publicAssetRemotePatterns(undefined)).toEqual([]);
  });

  it('maps only public commerce resources to the immutable HTTPS version', () => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_ASSET_BASE_URL', base);
    expect(publicAssetUrl('/commerce/apparel-v2/main-1.webp')).toBe(`${base}/commerce/apparel-v2/main-1.webp`);
    expect(commerceExampleForScene('apparel-catalog')).toBe(`${base}/commerce/apparel-v2/main-1.webp`);
    expect(templatePreviewUrl('white-main')).toBe(`${base}/commerce/templates/white-main-womenswear-v1.webp`);
    expect(validatePublicAssetBase(base + '/')).toBe(base);
    expect(publicAssetRemotePatterns(base)).toEqual([{
      protocol: 'https', hostname: 'www.zimage.store', port: '',
      pathname: `/static-assets/${digest}/commerce/**`, search: '',
    }]);
  });

  it.each(['/api/assets/private', 'https://private.example/signed?token=secret', 'blob:local-image',
    'data:image/png;base64,abc', '//other.example/image.webp', '/commerce/../api/private',
    '/commerce/%2e%2e/private', '/commerce/a%2fb', '/commerce/image.webp?secret=1'])('does not rewrite private or noncanonical input %s', value => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_ASSET_BASE_URL', base);
    expect(publicAssetUrl(value)).toBe(value);
  });

  it.each(['http://www.zimage.store/static-assets/' + digest, 'https://user:password@www.zimage.store/static-assets/' + digest,
    'https://www.zimage.store/static-assets/latest', base + '?token=1', base + '#fragment',
    'https://**.example.com/static-assets/' + digest, 'https://*.example.com/static-assets/' + digest,
    'https://www.zimage.store/other/' + digest])('rejects unsafe or mutable configuration %s', value => {
    expect(() => validatePublicAssetBase(value)).toThrow(/STATIC_ASSET/);
  });
});
