import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./package-static-assets.mjs', import.meta.url));
const externalFonts = process.env.ZIMAGE_SHARED_FONT_DIR;
if (!externalFonts) throw new Error('Configure ZIMAGE_SHARED_FONT_DIR before tests');
const policy = JSON.parse(await readFile(new URL('./release-public-policy.json', import.meta.url), 'utf8'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'zimage-static-assets-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  async function put(name, value = name) {
    const target = path.join(project, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  await put('apps/web/public/commerce/example.png', png);
  await put('apps/web/public/commerce/source-hero-extra.png', png);
  await put('apps/web/public/commerce/manifest.json', '{"origin":"fixture, no licensing claim"}\n');
  await put('apps/web/public/licenses/NOTICE.txt', 'original public notice');
  for (const file of policy.excludedSourceFiles) await put(`apps/web/public/${file}`, 'original excluded source');
  for (const file of ['NotoSansCJKsc-Regular.otf', 'NotoSansCJKsc-Bold.otf', 'LICENSE.txt', 'README.md'])
    await put(`apps/web/server/apparel/fonts/${file}`, await readFile(path.join(externalFonts, file)));
  const output = path.join(root, 'output');
  const run = (args = [], restrictiveUmask = false) => spawnSync(process.execPath, [
    ...(restrictiveUmask ? ['--input-type=module', '--eval', 'import { pathToFileURL } from "node:url"; process.umask(0o077); await import(pathToFileURL(process.argv[1]).href);'] : []),
    script, '--project', project, '--output', output, '--font-source', path.join(project, 'apps/web/server/apparel/fonts'), ...args,
  ], { encoding: 'utf8' });
  return { root, project, output, put, run };
}
async function missing(target) { await assert.rejects(lstat(target), { code: 'ENOENT' }); }
async function assertPublishedModes(directory) {
  assert.equal((await lstat(directory)).mode & 0o777, 0o755, directory);
  for (const name of await readdir(directory)) {
    const full = path.join(directory, name), stat = await lstat(full);
    if (stat.isDirectory()) await assertPublishedModes(full);
    else assert.equal(stat.mode & 0o777, 0o644, full);
  }
}

test('packages original bytes under the actual manifest SHA and records image, font and provenance data', async t => {
  const f = await fixture(t), result = f.run([], true);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.productionReady, false);
  const version = path.join(f.output, summary.manifestSha256);
  const manifestBytes = await readFile(path.join(version, 'asset-manifest.json'));
  assert.equal(summary.manifestSha256, digest(manifestBytes));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.productionReady, false);
  assert.equal(manifest.files.length, 8);
  assert.ok(!Object.hasOwn(manifest, 'manifestSha256'));
  assert.deepEqual(manifest.files.map(file => file.path), manifest.files.map(file => file.path).sort());
  let publicBytes = 0, fontBytes = 0;
  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(version, entry.path));
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, digest(bytes));
    const source = entry.kind === 'font' ? `apps/web/server/apparel/${entry.path}` : `apps/web/public/${entry.path}`;
    assert.deepEqual(bytes, await readFile(path.join(f.project, source)));
    assert.ok(['public', 'font'].includes(entry.kind));
    if (entry.kind === 'public') publicBytes += bytes.length; else fontBytes += bytes.length;
  }
  const image = manifest.files.find(file => file.path === 'commerce/example.png');
  assert.deepEqual([image.width, image.height, image.hasAlpha, image.orientation, image.blurDataURL], [1, 1, true, null, null]);
  assert.equal(image.mime, 'image/png');
  assert.deepEqual(image.provenance, ['commerce/manifest.json']);
  const font = manifest.files.find(file => file.path.endsWith('Regular.otf'));
  assert.equal(font.mime, 'font/otf');
  assert.equal(font.license, 'fonts/LICENSE.txt');
  assert.deepEqual(font.provenance, ['fonts/README.md']);
  assert.equal(summary.rawPublicBytes, publicBytes);
  assert.equal(summary.rawFontBytes, fontBytes);
  assert.equal(summary.rawManifestBytes, manifestBytes.length);
  assert.equal(summary.rawTotalBytes, publicBytes + fontBytes + manifestBytes.length);
  for (const file of policy.excludedSourceFiles) {
    await missing(path.join(version, file));
    assert.equal(await readFile(path.join(f.project, 'apps/web/public', file), 'utf8'), 'original excluded source');
  }
  assert.deepEqual(await readdir(f.output), [summary.manifestSha256]);
});

test('publishes POSIX file and directory modes despite a restrictive umask', {
  skip: process.platform === 'win32' ? 'Pending actual POSIX host: Windows cannot prove POSIX permission modes or umask behavior' : false,
}, async t => {
  const f = await fixture(t), result = f.run([], true);
  assert.equal(result.status, 0, result.stderr);
  await assertPublishedModes(f.output);
});

test('uses deterministic manifest bytes and changes version when a resource changes', async t => {
  const f = await fixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  const sha = JSON.parse(first.stdout).manifestSha256;
  await rm(f.output, { recursive: true });
  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).manifestSha256, sha);
  await rm(f.output, { recursive: true });
  await f.put('apps/web/public/licenses/NOTICE.txt', 'changed original notice');
  const changed = f.run();
  assert.equal(changed.status, 0, changed.stderr);
  assert.notEqual(JSON.parse(changed.stdout).manifestSha256, sha);
});

test('refuses existing output directories, including an empty directory and an existing version', async t => {
  const f = await fixture(t);
  await mkdir(f.output);
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(await readdir(f.output), []);
  await writeFile(path.join(f.output, 'keep'), 'must remain');
  assert.notEqual(f.run().status, 0);
  assert.equal(await readFile(path.join(f.output, 'keep'), 'utf8'), 'must remain');
});

test('rejects overlap with project in either direction before writing output', async t => {
  const f = await fixture(t);
  for (const output of [path.join(f.project, 'assets'), path.join(f.project, 'apps/web/public/assets'), f.root]) {
    const result = spawnSync(process.execPath, [script, '--project', f.project, '--font-source', path.join(f.project, 'apps/web/server/apparel/fonts'), '--output', output], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /overlap/i);
  }
  await missing(path.join(f.project, 'assets'));
  await missing(f.output);
});

test('rejects symlink files, directories, excluded source files and project aliases', async t => {
  const cases = [];
  for (const type of ['file', 'directory', 'excluded', 'project']) {
    const f = await fixture(t);
    const source = type === 'project' ? f.project : path.join(f.project, `apps/web/public/commerce${type === 'directory' ? '' : '/example.png'}`);
    const target = type === 'excluded' ? `apps/web/public/${policy.excludedSourceFiles[0]}` : `apps/web/public/${type === 'file' ? 'commerce/link.png' : 'linked'}`;
    const link = type === 'project' ? path.join(f.root, 'project-link') : path.join(f.project, target);
    if (type === 'excluded') await rm(link);
    try {
      await symlink(source, link);
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code) || error.syscall !== 'symlink') throw error;
      t.skip(`Windows symlink fixture creation failed with ${error.code}: this account lacks symlink permission; product validation pending`);
      return;
    }
    cases.push({ f, type, link });
  }
  for (const { f, type, link } of cases) {
    if (type === 'project') {
      const result = spawnSync(process.execPath, [script, '--project', link, '--font-source', externalFonts, '--output', f.output], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /symlink/i);
    } else {
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /symlink/i);
    }
    await missing(f.output);
  }
});

test('rejects unsafe or unknown resource paths and removes temporary output on failure', async t => {
  for (const invalid of ['commerce/unknown.js', 'commerce/back\\slash.png', '.env', 'fonts/collision.txt', 'asset-manifest.json']) {
    const f = await fixture(t);
    await f.put(`apps/web/public/${invalid}`, 'not publishable');
    const result = f.run();
    assert.notEqual(result.status, 0, invalid);
    await missing(f.output);
    assert.deepEqual((await readdir(f.root)).sort(), ['project']);
  }
});

test('fails atomically for corrupt images, missing license or unexpected font files', async t => {
  for (const invalid of ['image', 'license', 'extra-font']) {
    const f = await fixture(t);
    if (invalid === 'image') await f.put('apps/web/public/commerce/corrupt.png', 'bad png');
    if (invalid === 'license') await rm(path.join(f.project, 'apps/web/server/apparel/fonts/LICENSE.txt'));
    if (invalid === 'extra-font') await f.put('apps/web/server/apparel/fonts/unexpected.otf', 'extra');
    const result = f.run();
    assert.notEqual(result.status, 0, invalid);
    await missing(f.output);
    assert.deepEqual((await readdir(f.root)).sort(), ['project']);
  }
});

test('rejects a held output lock and unknown or duplicate CLI arguments', async t => {
  const f = await fixture(t);
  const lock = path.join(f.root, '.output.static-assets.lock');
  await mkdir(lock);
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(await readdir(lock), []);
  await rm(lock, { recursive: true });
  for (const args of [['--unknown', 'value'], ['--project', f.project], ['--output', '../escape']])
    assert.notEqual(f.run(args).status, 0);
  await missing(f.output);
});
test('policy exclusions point at files that still exist in the repository', async () => {
  // A stale exclusion silently stops protecting anything and hides real dead assets,
  // so every policy path must resolve against the working tree.
  const project = fileURLToPath(new URL('../../', import.meta.url));
  for (const file of policy.excludedSourceFiles) {
    const target = path.join(project, 'apps/web/public', file);
    const stat = await lstat(target).catch(error => {
      assert.fail(`release-public-policy.json references a missing file: apps/web/public/${file} (${error.code})`);
    });
    assert.ok(stat.isFile(), `excluded source must be a regular file: apps/web/public/${file}`);
  }
});
test('Nginx example limits immutable assets to hash paths, exact origins and public read methods', async () => {
  const config = await readFile(new URL('./static-assets.nginx.example.conf', import.meta.url), 'utf8');
  assert.match(config, /map \$http_origin \$zimage_asset_cors_origin/);
  assert.match(config, /"https:\/\/www\.zimage\.store"/);
  assert.match(config, /"https:\/\/zimage\.store"/);
  assert.match(config, /localhost/);
  assert.match(config, /127\[\.\]0\[\.\]0\[\.\]1/);
  assert.match(config, /"~\^https\?:\/\/[^"\n]+\{1,5\}[^"\n]+"\s+\$http_origin;/);
  assert.match(config, /\[0-9a-f\]\{64\}/);
  assert.match(config, /alias \/srv\/zimage-static-assets\/\$asset_path;/);
  assert.match(config, /max-age=31536000, immutable/);
  assert.match(config, /font\/otf\s+otf;/);
  assert.match(config, /X-Content-Type-Options "nosniff" always/);
  assert.match(config, /Vary "Origin" always/);
  assert.match(config, /GET\|HEAD\|OPTIONS/);
  assert.match(config, /autoindex off;/);
  assert.match(config, /disable_symlinks on;/);
  assert.ok(!config.includes('try_files'));
  assert.ok(!config.includes('Access-Control-Allow-Credentials'));
  assert.ok(!/Access-Control-Allow-Origin\s+["']?\*/.test(config));
});

test('requires an explicit font source instead of silently using repository fonts', async t => {
  const f = await fixture(t);
  const result = spawnSync(process.execPath, [script, '--project', f.project, '--output', f.output], {encoding:'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /font-source/);
  await missing(f.output);
});
test('rejects altered original font or license bytes', async t => {
  for (const name of ['NotoSansCJKsc-Regular.otf', 'LICENSE.txt', 'README.md']) {
    const f = await fixture(t);
    await f.put('apps/web/server/apparel/fonts/' + name, 'changed');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256/);
    await missing(f.output);
  }
});

test('prepares fonts-only resources without changing full-resource manifest semantics', async t => {
  const f = await fixture(t);
  await rm(path.join(f.project,'apps/web/public'),{recursive:true});
  const result=f.run(['--fonts-only','true']);
  assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.rawPublicBytes,0);
  assert.equal(summary.rawFontBytes,33444552);
  const manifest=JSON.parse(await readFile(path.join(summary.versionDirectory,'asset-manifest.json')));
  assert.equal(manifest.files.length,4);
  assert.ok(manifest.files.every(e=>e.path.startsWith('fonts/')));
});
