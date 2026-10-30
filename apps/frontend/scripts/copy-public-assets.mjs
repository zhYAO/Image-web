import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regularFiles } from './static-files.mjs';
import { assertStageSource } from './build-source-identity.mjs';

/** Copy declared public examples and license notices; never copy the entire app. */
export async function copyPublicAssets({ source, dist }) {
  const policy = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../build/public-asset-allowlist.json'), 'utf8'));
  const allowed = new Set(policy.files);
  const excluded = new Set(policy.excludedSourceFiles);
  for (const path of allowed) {
    if (excluded.has(path) || !(path.startsWith('commerce/') ? /\.(?:webp|png|jpe?g)$/.test(path) : path.startsWith('licenses/') && /\.(?:md|txt)$/.test(path))) throw new Error('Invalid public asset allowlist');
  }
  const candidates = (await regularFiles(source)).filter(file => file.path.startsWith('commerce/') || file.path.startsWith('licenses/'));
  if (candidates.some(file => !allowed.has(file.path) && !excluded.has(file.path))) throw new Error('Unapproved public asset path');
  const selected = candidates.filter(file => allowed.has(file.path));
  const bytes = selected.reduce((sum, file) => sum + file.bytes, 0);
  if (selected.length > 10000 || bytes > 256 * 1024 * 1024) throw new Error('Public asset copy budget exceeded');
  for (const file of selected) {
    const target = join(dist, file.path);
    await mkdir(dirname(target), { recursive: true });
    // Fails on collision instead of overwriting an unexpected build file.
    await copyFile(join(source, file.path), target, 1);
  }
  return { files: selected.length, bytes };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const stage = { project: resolve(root, '../..'), snapshotPath: resolve(root, 'dist/.vite/source-snapshot.json'), candidatePath: resolve(root, 'dist/.release/candidate.json'), namespace: process.env.ZIMAGE_ASSET_NAMESPACE };
  assertStageSource(stage);
  const result = await copyPublicAssets({ source: resolve(root, '../web/public'), dist: resolve(root, 'dist') });
  assertStageSource(stage);
  process.stdout.write(JSON.stringify(result) + '\n');
}
