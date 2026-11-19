import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regularFiles } from './static-files.mjs';
import { assertStageSource } from './build-source-identity.mjs';
import { publicImageMetadataPath, publicImageContract, validatePublicImageContract } from '../../web/build/public-image-build.mjs';
import { hash, readImageDelivery, previewMetadataPath, validatePreview } from '../build/image-delivery.mjs';

/** Copy declared public examples and license notices; never copy the entire app.
 * @param {{ source: string, dist: string, imageDelivery?: ReturnType<typeof readImageDelivery> }} options
 */
export async function copyPublicAssets({ source, dist, imageDelivery = undefined }) {
  const policy = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../build/public-asset-allowlist.json'), 'utf8'));
  const allowed = new Set(policy.files);
  const excluded = new Set(policy.excludedSourceFiles);
  for (const path of allowed) {
    if (excluded.has(path) || !(path.startsWith('commerce/') ? /\.(?:webp|png|jpe?g)$/.test(path) : path.startsWith('licenses/') && /\.(?:md|txt)$/.test(path))) throw new Error('Invalid public asset allowlist');
  }
  const candidates = (await regularFiles(source)).filter(file => file.path.startsWith('commerce/') || file.path.startsWith('licenses/'));
  if (candidates.some(file => !allowed.has(file.path) && !excluded.has(file.path))) throw new Error('Unapproved public asset path');
  const selected = candidates.filter(file => allowed.has(file.path));
  if (imageDelivery) {
    validatePreview(imageDelivery);
    const names = new Set((await regularFiles(dist)).map(file => file.path));
    if (names.has(previewMetadataPath) && names.has(publicImageMetadataPath)) throw new Error('Conflicting public image modes');
    const formal = names.has(publicImageMetadataPath);
    let recorded = JSON.parse(await readFile(join(dist, formal ? publicImageMetadataPath : previewMetadataPath), 'utf8'));
    recorded = formal ? validatePublicImageContract(recorded) : validatePreview(recorded);
    if (JSON.stringify(recorded) !== JSON.stringify(formal ? publicImageContract(imageDelivery.baseUrl) : imageDelivery)) throw new Error('External preview build and copy binding differs');
    for (const entry of imageDelivery.files) {
      const file = selected.find(file => file.path === entry.path);
      if (!file || file.bytes !== entry.bytes || hash(await readFile(join(source, entry.path))) !== entry.sha256) throw new Error('External preview source image differs from pinned manifest');
    }
  }
  const copied = imageDelivery ? selected.filter(file => !file.path.startsWith('commerce/')) : selected;
  const bytes = copied.reduce((sum, file) => sum + file.bytes, 0);
  if (copied.length > 10000 || bytes > 256 * 1024 * 1024) throw new Error('Public asset copy budget exceeded');
  for (const file of copied) {
    const target = join(dist, file.path);
    await mkdir(dirname(target), { recursive: true });
    // Fails on collision instead of overwriting an unexpected build file.
    await copyFile(join(source, file.path), target, 1);
  }
  return { files: copied.length, bytes, ...(imageDelivery ? { externalImages: 62, productionVerified: false } : {}) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const stage = { project: resolve(root, '../..'), snapshotPath: resolve(root, 'dist/.vite/source-snapshot.json'), candidatePath: resolve(root, 'dist/.release/candidate.json'), namespace: process.env.ZIMAGE_ASSET_NAMESPACE };
  assertStageSource(stage);
  const result = await copyPublicAssets({ source: resolve(root, '../web/public'), dist: resolve(root, 'dist'), imageDelivery: readImageDelivery(process.env.ZIMAGE_IMAGE_DELIVERY, process.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL) });
  assertStageSource(stage);
  process.stdout.write(JSON.stringify(result) + '\n');
}
