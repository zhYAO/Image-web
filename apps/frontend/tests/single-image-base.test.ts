// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { resolvePublicImageBase, validatePublicImageBase } from '../../web/build/public-image-base.mjs';
import { readPinnedPublicImages, requirePinnedImageBase, verifyPublishedImages } from '../../web/build/public-image-build.mjs';
import { readImageDelivery } from '../build/image-delivery.mjs';
import createConfig from '../vite.config';

const policy = readPinnedPublicImages();
const base = 'https://www.zimage.store/static-assets/' + policy.manifestSha256;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('uses one canonical value, preserves the old generic asset parser, and rejects ambiguous migration', () => {
  expect(resolvePublicImageBase(undefined, undefined)).toBeUndefined();
  const legacy = 'https://old-assets.example/static-assets/' + 'b'.repeat(64) + '/';
  expect(resolvePublicImageBase(undefined, legacy)).toBe(legacy.slice(0, -1));
  expect(resolvePublicImageBase(base, undefined)).toBe(base);
  expect(resolvePublicImageBase(base, base + '/')).toBe(base);
  expect(() => resolvePublicImageBase(base, legacy)).toThrow('conflicts');
  expect(() => readImageDelivery(undefined, base, legacy)).toThrow('conflicts');
  for (const bad of [base + '/', base + '?v=1', base + '#x', base.replace('https:', 'http:'), base.replace('www.', ''), base.replace('www.', 'WWW.'), base.replace('/static-assets/', '/x/../static-assets/'), base.replace('https://', 'https://u@'), base.replace('www.zimage.store', '127.0.0.1')]) {
    expect(() => validatePublicImageBase(bad)).toThrow();
  }
  expect(() => requirePinnedImageBase(base.replace(policy.manifestSha256, '0'.repeat(64)))).toThrow('pinned');
});

function responseFor(url: string, change?: (bytes: Buffer, headers: Record<string, string>) => Response) {
  const file = policy.files.find(entry => url === base + '/' + entry.path)!;
  expect(file).toBeDefined();
  const bytes = readFileSync(new URL('../../web/public/' + file.path, import.meta.url));
  const headers = { 'content-type': file.contentType, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' };
  return change ? change(bytes, headers) : new Response(Uint8Array.from(bytes), { headers });
}

it('accepts exactly 62 complete public responses with matching MIME, size and SHA (offline fixture)', async () => {
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
    return responseFor(String(url));
  });
  expect(await verifyPublishedImages(base, { request: request as typeof fetch })).toMatchObject({ images: 62, allImagesVerified: true });
  expect(request).toHaveBeenCalledTimes(62);
});

it.each(['404', 'mime', 'hash', 'short', 'large', 'private', 'no-store', 'encoding', 'redirect'])('fails closed for %s without reporting bodies', async kind => {
  const request = vi.fn(async (url: string | URL | Request) => responseFor(String(url), (bytes, headers) => {
    if (kind === '404') return new Response('PRIVATE TEST BODY', { status: 404 });
    if (kind === 'mime') headers['content-type'] = 'text/html';
    if (kind === 'private') headers['cache-control'] = 'private, max-age=31536000, immutable';
    if (kind === 'no-store') headers['cache-control'] += ', no-store';
    if (kind === 'encoding') Object.assign(headers, { 'content-encoding': 'gzip' });
    if (kind === 'hash') bytes = Buffer.from(bytes).fill(0);
    if (kind === 'short') bytes = bytes.subarray(1);
    if (kind === 'large') bytes = Buffer.concat([bytes, Buffer.from([0])]);
    const response = new Response(Uint8Array.from(bytes), { headers });
    if (kind === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    return response;
  }));
  await expect(verifyPublishedImages(base, { request: request as typeof fetch })).rejects.toThrow('keep the safe bundled mode');
  expect(request).toHaveBeenCalledOnce();
});

it('normal Vite build refuses failed acceptance before sampling/emitting build output; preview is explicitly separate', async () => {
  vi.stubEnv('ZIMAGE_PUBLIC_IMAGE_BASE_URL', base);
  vi.stubEnv('NEXT_PUBLIC_STATIC_ASSET_BASE_URL', '');
  vi.stubEnv('ZIMAGE_IMAGE_DELIVERY', '');
  vi.stubEnv('ZIMAGE_ASSET_NAMESPACE', 'offline-gate-test');
  vi.stubEnv('ZIMAGE_FRONTEND_COMPATIBILITY', JSON.stringify({ apiRequirements: { major: 1, minMinor: 0, capabilities: [] }, allowedBackendReleases: ['offline'] }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  if (typeof createConfig !== 'function') throw new Error('Missing config factory');
  const config = await createConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false });
  const plugin = config.plugins![0] as unknown as { buildStart: () => Promise<void> };
  await expect(plugin.buildStart()).rejects.toThrow('keep the safe bundled mode');
  expect(config.define?.__ZIMAGE_PUBLIC_IMAGE_BASE__).toBe(JSON.stringify(base));
});

it('Next config derives its build-time constant from the same sole input and keeps formal installers unchanged', () => {
  const source = readFileSync(new URL('../../web/next.config.ts', import.meta.url), 'utf8');
  expect(source).toContain('resolvePublicImageBase(sharedImageBase, legacyAssetBase)');
  expect(source).toContain('await verifyBuildPublicImages(imageBase!)');
  expect(source).toContain("ZIMAGE_PUBLIC_IMAGE_BASE_URL: sharedImageBase ? imageBase! : ''");
  const helper = readFileSync(new URL('../../web/lib/public-assets.ts', import.meta.url), 'utf8');
  expect(helper).toContain('process.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL');
  // Static contract evidence only; this is not a real Next production build or formal release acceptance.
});
