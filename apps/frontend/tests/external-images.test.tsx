// @vitest-environment node
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { publicAssetUrl } from '../src/platform/public-assets';
import { publicExampleUrl } from '../../web/features/commerce/public-example-images';
import { publicAssetUrl as nextPublicAssetUrl } from '../../web/lib/public-assets';
import { imagePolicyVersion, previewMetadataPath, readImageDelivery, validatePreview } from '../build/image-delivery.mjs';
import { copyPublicAssets } from '../scripts/copy-public-assets.mjs';
import { namespacePublicAssetSource } from '../build/public-asset-source';
import { checkStaticResources } from '../scripts/check-dist.mjs';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const policyBytes = await readFile(join(project, 'ops/aliyun/public-images.json'));
const policy = JSON.parse(policyBytes.toString());
const base = 'https://www.zimage.store/static-assets/' + imagePolicyVersion(policyBytes);
const delivery = readImageDelivery('external-preview', base)!;
const temporary: string[] = [];
it('keeps the immutable image policy version identical across LF and CRLF checkouts', () => {
  const lf = Buffer.from(policyBytes.toString('utf8').replaceAll('\r\n', '\n'));
  const crlf = Buffer.from(lf.toString('utf8').replaceAll('\n', '\r\n'));
  expect(imagePolicyVersion(lf)).toBe(imagePolicyVersion(crlf));
  expect(imagePolicyVersion(lf)).toBe('6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24');
});

afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

it('uses the sole exact pinned base automatically; unset remains bundled', () => {
  expect(readImageDelivery(undefined, undefined)).toBeUndefined();
  expect(readImageDelivery(undefined, base)).toEqual(delivery);
  for (const invalid of [base.replace('https:', 'http:'), base.replace('www.zimage.store', 'evil.test'), base + '?key=x', base + '/', base.replace(imagePolicyVersion(policyBytes), '0'.repeat(64)), base.replace('https://', 'https://user@')]) {
    expect(() => readImageDelivery('external-preview', invalid)).toThrow();
  }
  expect(() => validatePreview({ ...delivery, productionVerified: true })).toThrow();
});

it('maps exactly the same 62 paths in browser and Next helper to an offline HTTPS response map', async () => {
  vi.stubGlobal('__ZIMAGE_PUBLIC_IMAGE_BASE__', base);
  vi.stubEnv('ZIMAGE_PUBLIC_IMAGE_BASE_URL', base);
  vi.stubEnv('NEXT_PUBLIC_STATIC_ASSET_BASE_URL', '');
  const responses = new Map<string, Buffer>();
  for (const file of policy.files) {
    const bytes = await readFile(join(project, 'apps/web/public', file.path));
    const url = base + '/' + file.path;
    responses.set(url, bytes);
    expect(publicAssetUrl('/' + file.path)).toBe(url);
    expect(publicExampleUrl('/' + file.path, base)).toBe(url);
    expect(nextPublicAssetUrl('/' + file.path)).toBe(url);
    expect(bytes.length).toBe(file.bytes);
    expect(createHash('sha256').update(responses.get(url)!).digest('hex')).toBe(file.sha256);
  }
  expect(responses.size).toBe(62); // Synthetic response map, never a production GET claim.
  for (const path of ['/api/assets/private', '/commerce/new-upload.webp', '/commerce/apparel-v2/main-1.webp?token=x', '/commerce/../private.webp', 'https://private.test/image.webp']) {
    expect(publicAssetUrl(path)).toBe(path);
    expect(publicExampleUrl(path, base)).toBe(path);
    expect(nextPublicAssetUrl(path)).toBe(path);
  }
});

it('rewrites reviewed constants in browser/SSR while retaining dynamic and private inputs', () => {
  const source = 'export const values=["/commerce/apparel-v2/main-1.webp", "/commerce/new-upload.webp"];';
  const result = namespacePublicAssetSource(source, '/project/apps/web/features/brand/landing/HeroGallery.tsx', 'test', base);
  expect(result).toContain(base + '/commerce/apparel-v2/main-1.webp');
  expect(result).toContain('"/commerce/new-upload.webp"');
  expect(namespacePublicAssetSource(source, '/project/apps/web/store/session.ts', 'test', base)).toBe(source);
});

it('omits verified images only in explicit preview and rejects changed original bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zimage-images-preview-')); temporary.push(root);
  const source = join(root, 'public'), dist = join(root, 'dist');
  await mkdir(join(dist, '.release'), { recursive: true });
  await writeFile(join(dist, previewMetadataPath), JSON.stringify(delivery));
  for (const file of policy.files) {
    await mkdir(dirname(join(source, file.path)), { recursive: true });
    await copyFile(join(project, 'apps/web/public', file.path), join(source, file.path));
  }
  expect(await copyPublicAssets({ source, dist, imageDelivery: delivery })).toMatchObject({ files: 0, bytes: 0, externalImages: 62 });
  await writeFile(join(source, policy.files[0].path), 'changed');
  await expect(copyPublicAssets({ source, dist, imageDelivery: delivery })).rejects.toThrow('pinned manifest');
});

it('fails closed when preview metadata is presented without explicit mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zimage-images-metadata-')); temporary.push(root);
  await mkdir(join(root, '.release'));
  await writeFile(join(root, '.release/candidate.json'), '{}');
  await writeFile(join(root, previewMetadataPath), JSON.stringify(delivery));
  await writeFile(join(root, 'index.html'), '<html></html>');
  await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('explicit build mode');
});

it('preserves the exact existing captcha loader and rejects unknown external resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zimage-images-captcha-')); temporary.push(root);
  await mkdir(join(root, '.release'));
  const candidate = { schemaVersion: 1, namespace: 'test', apiRequirements: { major: 1, minMinor: 0, capabilities: [] }, allowedBackendReleases: ['test'], sourceIdentity: { sourceSHA: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64), lockfileSha256: 'c'.repeat(64), dirty: true }, buildToolchainFingerprint: 'd'.repeat(64) };
  await writeFile(join(root, '.release/candidate.json'), JSON.stringify(candidate));
  await writeFile(join(root, previewMetadataPath), JSON.stringify(delivery));
  await writeFile(join(root, 'index.html'), '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"></script>');
  expect(await checkStaticResources({ dist: root, namespace: 'test', imageDelivery: delivery })).toMatchObject({ files: 1 });
  for (const url of ['https://evil.test/image.webp', base + '/commerce/not-reviewed.webp', 'https://challenges.cloudflare.com/turnstile/v0/api.js?other=1']) {
    await writeFile(join(root, 'index.html'), `<img src="${url}">`);
    await expect(checkStaticResources({ dist: root, namespace: 'test', imageDelivery: delivery })).rejects.toThrow('Unreviewed external');
  }
});


it('keeps the Next public example origin on the verified owner ECS site', () => {
  for (const origin of ['https://other.test', 'https://assets.zimage.test', 'https://www.zimage.store:8443']) {
    vi.stubEnv('ZIMAGE_PUBLIC_IMAGE_BASE_URL', origin + '/static-assets/' + imagePolicyVersion(policyBytes));
    expect(() => nextPublicAssetUrl('/commerce/apparel-v2/main-1.webp')).toThrow();
  }
});
