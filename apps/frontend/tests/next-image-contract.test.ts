// @vitest-environment node
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { compiledPublicImageContract, publicImageContract, readPinnedPublicImages, verifyPublicImageSources } from '../../web/build/public-image-build.mjs';
import { stageCandidate } from '../../../ops/aliyun/package-stage.mjs';
import { preflightCandidate } from '../../../ops/aliyun/package-preflight.mjs';

vi.mock('../../../ops/aliyun/package-preflight.mjs', () => ({ preflightCandidate: vi.fn(async () => { throw new Error('FIXTURE_NATIVE_GATE'); }) }));

const base = 'https://www.zimage.store/static-assets/' + readPinnedPublicImages().manifestSha256;
const contract = publicImageContract(base);
const configuration = () => ({ env: { ZIMAGE_PUBLIC_IMAGE_BASE_URL: base, ZIMAGE_PUBLIC_IMAGE_CONTRACT: JSON.stringify(contract) },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'www.zimage.store', port: '', pathname: '/static-assets/' + contract.manifestSha256 + '/commerce/**', search: '' }] } });
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('distinguishes legacy compiled configuration and exact derived image-only identity', () => {
  expect(compiledPublicImageContract({ env: {} })).toBeUndefined();
  expect(compiledPublicImageContract(configuration())).toEqual(contract);
  const reordered = configuration();
  reordered.images.remotePatterns[0] = { ...reordered.images.remotePatterns[0]!, ...{ search: '' } };
  expect(compiledPublicImageContract(reordered)).toEqual(contract);
});

it('both real staging copy paths omit only reviewed images and still stop at the mandatory native gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zimage-copy-contract-')); temporary.push(root);
  const project = join(root, 'project'), dist = join(project, 'dist'), destination = join(root, 'staged');
  for (const file of contract.files) {
    const target = join(project, 'apps/web/public', file.path); await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL('../../web/public/' + file.path, import.meta.url), target);
  }
  await mkdir(join(dist, 'standalone/apps/web/public', dirname(contract.files[0]!.path)), { recursive: true });
  await copyFile(new URL('../../web/public/' + contract.files[0]!.path, import.meta.url), join(dist, 'standalone/apps/web/public', contract.files[0]!.path));
  await mkdir(join(dist, 'static'), { recursive: true });
  await mkdir(join(project, 'apps/web/public/licenses'), { recursive: true });
  await writeFile(join(project, 'apps/web/public/licenses/NOTICE.txt'), 'retained fixture notice');
  await writeFile(join(project, 'apps/web/public/brand.svg'), '<svg/>');
  await writeFile(join(dist, 'required-server-files.json'), JSON.stringify({ config: { ...configuration(), distDir: '.next' } }));
  await expect(stageCandidate({ project, dist, destination })).rejects.toThrow('FIXTURE_NATIVE_GATE');
  for (const file of contract.files) await expect(access(join(destination, 'apps/web/public', file.path))).rejects.toThrow();
  expect(await readFile(join(destination, 'apps/web/public/licenses/NOTICE.txt'), 'utf8')).toBe('retained fixture notice');
  expect(await readFile(join(destination, 'apps/web/public/brand.svg'), 'utf8')).toBe('<svg/>');
  expect(preflightCandidate).toHaveBeenCalled();
  // Native failure is intentional. This tests copying and fail-closed ordering,
  // not Sharp, an executable Next build, or a publishable archive.
});

it.each(['base', 'missing', 'extra-pattern', 'query', 'hash'])('fails closed on compiled %s mismatch', kind => {
  const config = configuration();
  if (kind === 'base') config.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL += '/';
  if (kind === 'missing') config.env.ZIMAGE_PUBLIC_IMAGE_CONTRACT = '';
  if (kind === 'extra-pattern') config.images.remotePatterns.push({ ...config.images.remotePatterns[0]! });
  if (kind === 'query') config.images.remotePatterns[0]!.search = '?x=1';
  if (kind === 'hash') {
    const changed = structuredClone(contract); changed.files[0]!.sha256 = '0'.repeat(64);
    config.env.ZIMAGE_PUBLIC_IMAGE_CONTRACT = JSON.stringify(changed);
  }
  expect(() => compiledPublicImageContract(config)).toThrow();
});

it('verifies all original 62 bytes before either staging or resource pack may omit them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zimage-next-public-images-')); temporary.push(root);
  for (const file of contract.files) {
    const target = join(root, file.path); await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL('../../web/public/' + file.path, import.meta.url), target);
  }
  await expect(verifyPublicImageSources(root, contract)).resolves.toBeUndefined();
  await writeFile(join(root, contract.files[0]!.path), 'changed fixture');
  await expect(verifyPublicImageSources(root, contract)).rejects.toThrow('source mismatch');
});
