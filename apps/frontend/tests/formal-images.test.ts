// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import createConfig from '../vite.config';
import { checkStaticResources } from '../scripts/check-dist.mjs';
import { readImageDelivery, previewMetadataPath } from '../build/image-delivery.mjs';
import { publicImageContract, publicImageMetadataPath, readPinnedPublicImages } from '../../web/build/public-image-build.mjs';

const base = 'https://www.zimage.store/static-assets/' + readPinnedPublicImages().manifestSha256;
const contract = publicImageContract(base);
const delivery = readImageDelivery(undefined, base)!;
const temporary: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const candidate = { schemaVersion: 1, namespace: 'images-fixture', apiRequirements: { major: 1, minMinor: 0, capabilities: [] }, allowedBackendReleases: ['offline'], sourceIdentity: { sourceSHA: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64), lockfileSha256: 'd'.repeat(64), dirty: false }, buildToolchainFingerprint: 'c'.repeat(64) };

it.each(['legacy', 'all62', 'missing', 'unknown', 'foreign', 'query', 'relative-origin', 'font', 'changed-hash', 'renamed', 'conflict'])('JS and Python use the same formal closure (%s)', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'zimage-shared-images-')); temporary.push(root);
  await mkdir(join(root, '.release'));
  await writeFile(join(root, '.release/candidate.json'), JSON.stringify(candidate));
  let html = '<h1>Offline fixture</h1>';
  if (kind !== 'legacy') {
    await writeFile(join(root, publicImageMetadataPath), JSON.stringify(contract));
    html += contract.files.map(file => `<img src="${base}/${file.path}">`).join('');
  }
  if (kind === 'missing') await rm(join(root, publicImageMetadataPath));
  if (kind === 'unknown') html += `<img src="${base}/commerce/unlisted.webp">`;
  if (kind === 'foreign') html += '<img src="https://other.test/a.webp">';
  if (kind === 'query') html += `<img src="${base}/${contract.files[0]!.path}?x=1">`;
  if (kind === 'relative-origin') html += '<img src="//www.zimage.store/a.webp">';
  if (kind === 'font') html += `<img src="${base}/fonts/a.otf">`;
  if (kind === 'changed-hash') {
    const changed = structuredClone(contract); changed.files[0]!.sha256 = '0'.repeat(64);
    await writeFile(join(root, publicImageMetadataPath), JSON.stringify(changed));
  }
  if (kind === 'renamed') await writeFile(join(root, 'renamed.webp'), await readFile(new URL('../../web/public/' + contract.files[0]!.path, import.meta.url)));
  if (kind === 'conflict') await writeFile(join(root, previewMetadataPath), JSON.stringify(delivery));
  await writeFile(join(root, 'index.html'), html);
  let accepted = true;
  try { await checkStaticResources({ dist: root, namespace: 'images-fixture', imageDelivery: kind === 'legacy' || kind === 'missing' ? undefined : delivery }); }
  catch { accepted = false; }
  const script = fileURLToPath(new URL('../../../ops/aliyun/frontend/test_public_images.py', import.meta.url));
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const args = [...(process.platform === 'win32' ? ['-3'] : []), '-B', script, '--closure-fixture', root];
  const result = spawnSync(python, args, { encoding: 'utf8', timeout: 10_000 });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(accepted ? 'accepted' : 'rejected');
  expect(accepted).toBe(['legacy', 'all62'].includes(kind));
}, 15_000);

it('normal Vite build emits the bound formal contract only after 62 verified fixture responses', async () => {
  vi.stubEnv('ZIMAGE_PUBLIC_IMAGE_BASE_URL', base);
  vi.stubEnv('NEXT_PUBLIC_STATIC_ASSET_BASE_URL', '');
  vi.stubEnv('ZIMAGE_IMAGE_DELIVERY', '');
  vi.stubEnv('ZIMAGE_ASSET_NAMESPACE', 'images-fixture');
  vi.stubEnv('ZIMAGE_FRONTEND_COMPATIBILITY', JSON.stringify({ apiRequirements: candidate.apiRequirements, allowedBackendReleases: ['offline'] }));
  const request = vi.fn(async (url: string) => {
    const file = contract.files.find(file => url === base + '/' + file.path)!;
    const bytes = await readFile(new URL('../../web/public/' + file.path, import.meta.url));
    return new Response(Uint8Array.from(bytes), { headers: { 'content-type': file.contentType, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
  });
  vi.stubGlobal('fetch', request);
  if (typeof createConfig !== 'function') throw new Error('Missing config');
  const config = await createConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false });
  const plugin = config.plugins![0] as Plugin;
  if (typeof plugin.buildStart !== 'function' || typeof plugin.generateBundle !== 'function') throw new Error('Missing build hooks');
  await Reflect.apply(plugin.buildStart, {}, []);
  const emitFile = vi.fn();
  Reflect.apply(plugin.generateBundle, { emitFile, getModuleIds: () => [] }, []);
  expect(request).toHaveBeenCalledTimes(62);
  const emitted = emitFile.mock.calls.find(([file]) => file.fileName === publicImageMetadataPath)?.[0];
  expect(JSON.parse(emitted.source)).toEqual(contract);
  expect(emitFile.mock.calls.some(([file]) => file.fileName === previewMetadataPath)).toBe(false);
});
