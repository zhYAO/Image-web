import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./package-release.mjs', import.meta.url));
const excluded = [
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
  const kept = ['commerce/apparel-v2/manifest.json',
    'commerce/apparel-v2/source-hero-extra.png', 'other/source-hero.png'];
  for (const file of ['main-1', 'main-2', 'main-3', 'main-4', 'main-5', 'detail-01', 'detail-03', 'detail-04', 'detail-05', 'detail-06', 'detail-07'])
    for (const extension of ['jpg', 'webp']) kept.push(`commerce/apparel-v2/${file}.${extension}`);
  for (const name of kept) await put(`apps/web/public/${name}`);
  const destination = path.join(root, 'release');
  return { root, put, kept, destination, run: () => spawnSync(process.execPath, [script, 'dist', destination], { cwd: root, encoding: 'utf8' }) };
}
test('excludes precisely four source PNGs from both copy paths, retaining originals and public outputs', async t => {
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
test('generated Next maps stay in a separate debug archive while runtime code and unrelated maps stay intact', async t => {
  const f = await fixture(t);
  const maps = ['apps/web/.next/server/chunks/a.js.map', 'apps/web/.next/server/app/api/[id]/route.js.map', 'apps/web/.next/static/chunks/a.css.map'];
  for (const name of maps.slice(0, 2)) await f.put(`dist/standalone/${name}`, 'original map');
  await f.put('dist/static/chunks/a.css.map', 'original map');
  await f.put('dist/standalone/apps/web/.next/server/chunks/a.js', 'runtime js');
  await f.put('dist/standalone/apps/web/.next/server/app/world.map/page.js', 'runtime route under map-suffixed directory');
  await f.put('dist/static/chunks/a.css', 'runtime css');
  await f.put('dist/standalone/node_modules/pkg/dist/library.js.map', 'dependency map');
  await f.put('apps/web/public/notes.map', 'public map');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const runtime = spawnSync('tar', ['-tzf', `${f.destination}.tgz`], { encoding: 'utf8' });
  const debug = spawnSync('tar', ['-tzf', `${f.destination}.debug-maps.tgz`], { encoding: 'utf8' });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(debug.status, 0, debug.stderr);
  assert.deepEqual(debug.stdout.trim().split('\n').sort(), maps.map(name => `./${name}`).sort());
  for (const name of maps) {
    assert.ok(!runtime.stdout.includes(`./${name}\n`));
    assert.equal(await readFile(path.join(f.destination, name), 'utf8'), 'original map');
  }
  for (const name of ['apps/web/.next/server/chunks/a.js', 'apps/web/.next/server/app/world.map/page.js', 'apps/web/.next/static/chunks/a.css', 'node_modules/pkg/dist/library.js.map', 'apps/web/public/notes.map'])
    assert.ok(runtime.stdout.includes(`./${name}\n`), name);
});
test('retains generated route traces separately without removing runtime files or similarly named resources', async t => {
  const f = await fixture(t);
  const traces = ['apps/web/.next/server/app/api/[id]/route.js.nft.json', 'apps/web/.next/server/app/home/page.js.nft.json'];
  for (const name of traces) await f.put(`dist/standalone/${name}`, '{"version":1,"files":[]}');
  const kept = ['apps/web/.next/server/app/api/[id]/route.js',
    'apps/web/.next/server/app/route.js.nft.json/page.js',
    'apps/web/.next/server/unknown.nft.json',
    'node_modules/pkg/route.js.nft.json'];
  for (const name of kept) await f.put(`dist/standalone/${name}`, 'runtime file');
  await f.put('apps/web/public/route.js.nft.json', 'public file');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const runtime = spawnSync('tar', ['-tzf', `${f.destination}.tgz`], { encoding: 'utf8' });
  const traceArchive = spawnSync('tar', ['-tzf', `${f.destination}.build-traces.tgz`], { encoding: 'utf8' });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(traceArchive.status, 0, traceArchive.stderr);
  assert.deepEqual(traceArchive.stdout.trim().split('\n').sort(), traces.map(name => `./${name}`).sort());
  for (const name of traces) {
    assert.ok(!runtime.stdout.includes(`./${name}\n`));
    assert.equal(await readFile(path.join(f.destination, name), 'utf8'), '{"version":1,"files":[]}');
  }
  for (const name of [...kept, 'apps/web/public/route.js.nft.json'])
    assert.ok(runtime.stdout.includes(`./${name}\n`), name);
});
test('refuses to overwrite an existing build-trace archive', async t => {
  const f = await fixture(t);
  await f.put('release.build-traces.tgz', 'existing trace archive');
  assert.notEqual(f.run().status, 0);
  assert.equal(await readFile(`${f.destination}.build-traces.tgz`, 'utf8'), 'existing trace archive');
});

test('rejects stale traced apparel font payloads instead of shipping them in the application', async t => {
 const f=await fixture(t);
 await f.put('dist/standalone/apps/web/server/apparel/fonts/NotoSansCJKsc-Regular.otf','stale');
 const r=f.run();
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/external font resources/i);
 await assert.rejects(access(f.destination+'.tgz'));
});
