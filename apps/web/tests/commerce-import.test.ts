import { describe, expect, it } from 'vitest';
import { assertPublicImportUrl } from '@/server/commerce/public-image-import';

describe('public product link import', () => {
  it('accepts an HTTPS product page and rejects credentials, local hosts and custom ports', () => {
    expect(assertPublicImportUrl('https://example.com/product/1').hostname).toBe('example.com');
    expect(() => assertPublicImportUrl('http://example.com/product')).toThrow();
    expect(() => assertPublicImportUrl('https://127.0.0.1/product')).toThrow();
    expect(() => assertPublicImportUrl('https://user:pass@example.com/product')).toThrow();
    expect(() => assertPublicImportUrl('https://example.com:8443/product')).toThrow();
  });
});
