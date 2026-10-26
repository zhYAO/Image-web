import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./package-release.mjs', import.meta.url));
const excluded = [
  'commerce/apparel-v1/source-contact-sheet.png',
  'commerce/apparel-v2/source-hero.png',
  'commerce/apparel-v2/source-detail.png',
  'commerce/apparel-v2/source-lifestyle.png',
  'commerce/apparel-v2/source-seated.png',
];
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'zimage-package-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function put(name, value = name) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  }
  await put('dist/required-server-files.json', JSON.stringify({ config: { distDir: '.next' } }));
  await put('dist/standalone/apps/web/server.js', 'server');
  await put('dist/standalone/.env.production', 'do not ship');
  await put('dist/static/chunks/main.js', 'client');
  for (const name of excluded) {
    await put(`apps/web/public/${name}`);
    await put(`dist/standalone/apps/web/public/${name}`);
  }
  const kept = ['commerce/apparel-v1/manifest.json', 'commerce/apparel-v2/manifest.json',
    'commerce/apparel-v2/source-hero-extra.png', 'other/source-hero.png'];
  for (const version of ['apparel-v1', 'apparel-v2'])
    for (const file of ['main-1', 'main-2', 'main-3', 'main-4', 'main-5', 'detail-01', 'detail-03', 'detail-04', 'detail-05', 'detail-06', 'detail-07'])
      for (const extension of ['jpg', 'webp']) kept.push(`commerce/${version}/${file}.${extension}`);
  for (const name of kept) await put(`apps/web/public/${name}`);
  const destination = path.join(root, 'release');
  return { root, put, kept, destination, run: () => spawnSync(process.execPath, [script, 'dist', destination], { cwd: root, encoding: 'utf8' }) };
}
test('excludes precisely five source PNGs from both copy paths, retaining originals and public outputs', async t => {
  const f = await fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  for (const name of excluded) {
    await assert.rejects(access(path.join(f.destination, 'apps/web/public', name)));
    assert.equal(await readFile(path.join(f.root, 'apps/web/public', name), 'utf8'), `apps/web/public/${name}`);
  }
  for (const name of f.kept) assert.equal(await readFile(path.join(f.destination, 'apps/web/public', name), 'utf8'), `apps/web/public/${name}`);
  const archive = spawnSync('tar', ['-tzf', `${f.destination}.tgz`], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  for (const name of excluded) assert.ok(!archive.stdout.includes(`./apps/web/public/${name}\n`));
  for (const name of f.kept) assert.ok(archive.stdout.includes(`./apps/web/public/${name}\n`));
  assert.ok(!archive.stdout.includes('.env'));
});
test('refuses to merge a new release into an existing directory', async t => {
  const f = await fixture(t);
  await f.put('release/keep.txt', 'existing');
  assert.notEqual(f.run().status, 0);
  assert.equal(await readFile(path.join(f.destination, 'keep.txt'), 'utf8'), 'existing');
});
test('refuses to overwrite an existing release archive', async t => {
  const f = await fixture(t);
  await f.put('release.tgz', 'existing archive');
  assert.notEqual(f.run().status, 0);
  assert.equal(await readFile(`${f.destination}.tgz`, 'utf8'), 'existing archive');
});
