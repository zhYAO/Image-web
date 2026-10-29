import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = fileURLToPath(new URL('./package-release.mjs', import.meta.url));
const gnuTarOnly = { skip: process.platform === 'win32' ? 'Windows system tar is bsdtar and lacks --hard-dereference' : false };
const posixLinksOnly = { skip: process.platform === 'win32' ? 'Requires POSIX symlinks; this Windows account lacks symlink privilege' : false };
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
  await installSharpFixture(path.join(root, 'dist/standalone'));
  const destination = path.join(root, 'release');
  return { root, put, kept, destination, run: () => spawnSync(process.execPath, [script, 'dist', destination, '--format', 'full'], { cwd: root, encoding: 'utf8' }) };
}

// These cases catch accidental default-full fallback and validation after staging/spawn.
async function cliFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'zimage-package-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), destination = path.join(root, 'output');
  await mkdir(project);
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.19.0' }));
  const target = { schema: 1, runtime: { node: '24.19.0', abi: '137', platform: 'linux', arch: 'x64', libc: 'glibc-2.36' },
    toolchain: { packageManager: 'pnpm@11.19.0' }, assemblyCacheRoot: '/opt/zimage/layer-cache' };
  const targetFile = path.join(root, 'target.json');
  await writeFile(targetFile, JSON.stringify(target));
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: project, encoding: 'utf8' });
  return { root, project, destination, target, targetFile, run };
}

const inventoryRelease = '1'.repeat(40), inventoryHash = 'a'.repeat(64), otherInventoryHash = 'b'.repeat(64);
const inventoryFileRecord = (bytes, sha256 = inventoryHash) => ({ bytes, sha256 });
const inventoryDescriptor = files => ({ schema: 1, releaseSha: inventoryRelease, files });
const codeInventoryPath = `layers/code-${inventoryHash}.json`;
const runtimeInventoryPath = `layers/runtime-${inventoryHash}.tgz`;

for (const [name, files] of [
  ['per-file size above 2000000000', { [codeInventoryPath]: inventoryFileRecord(2_000_000_001) }],
  ['aggregate size above 2000000000', { [codeInventoryPath]: inventoryFileRecord(2_000_000_000),
    [runtimeInventoryPath]: inventoryFileRecord(1) }],
  ['array SHA256', { [codeInventoryPath]: inventoryFileRecord(1, [inventoryHash]) }],
  ['boxed SHA256', { [codeInventoryPath]: inventoryFileRecord(1, Object(inventoryHash)) }],
  ['newline SHA256', { [codeInventoryPath]: inventoryFileRecord(1, inventoryHash + '\n') }],
  ['null SHA256', { [codeInventoryPath]: inventoryFileRecord(1, null) }],
  ['number SHA256', { [codeInventoryPath]: inventoryFileRecord(1, 123) }],
  ['boolean SHA256', { [codeInventoryPath]: inventoryFileRecord(1, true) }],
  ['object SHA256', { [codeInventoryPath]: inventoryFileRecord(1, { value: inventoryHash }) }],
  ['string byte size', { [codeInventoryPath]: inventoryFileRecord('1') }],
  ['boolean byte size', { [codeInventoryPath]: inventoryFileRecord(true) }],
  ['fractional byte size', { [codeInventoryPath]: inventoryFileRecord(0.5) }],
  ['negative byte size', { [codeInventoryPath]: inventoryFileRecord(-1) }],
  ['duplicate layer slot', { [codeInventoryPath]: inventoryFileRecord(0),
    [`layers/code-${otherInventoryHash}.json`]: inventoryFileRecord(0) }],
  ['path with trailing newline', { [codeInventoryPath + '\n']: inventoryFileRecord(0) }],
]) test(`pure inventory validator rejects ${name}`, async () => {
  const { validateInventory } = await import('./package-release.mjs');
  assert.throws(() => validateInventory(inventoryDescriptor(files), inventoryRelease), /invalid inventory/i);
});

test('pure inventory validator accepts exact byte caps and all seven bounded slots', async () => {
  const { validateInventory } = await import('./package-release.mjs');
  assert.doesNotThrow(() => validateInventory(inventoryDescriptor({ [codeInventoryPath]: inventoryFileRecord(2_000_000_000) }), inventoryRelease));
  assert.doesNotThrow(() => validateInventory(inventoryDescriptor({ [codeInventoryPath]: inventoryFileRecord(1_000_000_000),
    [runtimeInventoryPath]: inventoryFileRecord(1_000_000_000) }), inventoryRelease));
  const seven = { [`releases/${inventoryRelease}.json`]: inventoryFileRecord(0) };
  for (const kind of ['code', 'runtime', 'assets']) for (const extension of ['json', 'tgz'])
    seven[`layers/${kind}-${inventoryHash}.${extension}`] = inventoryFileRecord(0);
  assert.doesNotThrow(() => validateInventory(inventoryDescriptor(seven), inventoryRelease));
  const eight = { ...seven, [`layers/assets-${otherInventoryHash}.tgz`]: inventoryFileRecord(0) };
  assert.throws(() => validateInventory(inventoryDescriptor(eight), inventoryRelease), /invalid inventory/i);
});

test('pure inventory validator refuses malformed and non-string release identities', async () => {
  const { validateInventory } = await import('./package-release.mjs');
  for (const releaseSha of ['bad', inventoryRelease + '\n', [inventoryRelease], Object(inventoryRelease), null, 123]) {
    const descriptor = { schema: 1, releaseSha, files: {} };
    assert.throws(() => validateInventory(descriptor, releaseSha), /invalid inventory/i);
  }
  assert.throws(() => validateInventory({ schema: 1, releaseSha: [inventoryRelease], files: {} }, inventoryRelease), /invalid inventory/i);
});

for (const [name, files] of [
  ['oversized object', { [codeInventoryPath]: inventoryFileRecord(2_000_000_001) }],
  ['oversized aggregate', { [codeInventoryPath]: inventoryFileRecord(2_000_000_000), [runtimeInventoryPath]: inventoryFileRecord(1) }],
  ['array hash', { [codeInventoryPath]: inventoryFileRecord(1, [inventoryHash]) }],
]) test(`invalid inventory ${name} fails CLI validation without target outputs or child execution`, async t => {
  const f = await cliFixture(t), inventoryFile = path.join(f.root, 'inventory.json');
  await writeFile(inventoryFile, JSON.stringify(inventoryDescriptor(files)));
  const result = f.run(['dist', f.destination, '--assets', 'assets', '--release-id', inventoryRelease,
    '--target', f.targetFile, '--inventory', inventoryFile, '--python', path.join(f.root, 'must-not-run')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid inventory/i);
  assert.equal(result.stdout, '');
  await assert.rejects(access(f.destination));
  for (const suffix of ['.tgz', '.debug-maps.tgz', '.build-traces.tgz']) await assert.rejects(access(f.destination + suffix));
  assert.deepEqual((await readdir(f.root)).sort(), ['inventory.json', 'project', 'target.json']);
  assert.deepEqual((await readdir(f.project)).sort(), ['package.json']);
});

test('valid inventory preserves the exact target runtime gate before outputs or child execution', async t => {
  const f = await cliFixture(t), inventoryFile = path.join(f.root, 'inventory.json');
  await writeFile(inventoryFile, JSON.stringify(inventoryDescriptor({ [codeInventoryPath]: inventoryFileRecord(2_000_000_000) })));
  f.target.runtime.node = '0.0.0';
  await writeFile(f.targetFile, JSON.stringify(f.target));
  const result = f.run(['dist', f.destination, '--assets', 'assets', '--release-id', inventoryRelease,
    '--target', f.targetFile, '--inventory', inventoryFile, '--python', path.join(f.root, 'must-not-run')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime fingerprint.*target/i);
  assert.equal(result.stdout, '');
  await assert.rejects(access(f.destination));
});

test('default layers require an explicit target before creating any output', async t => {
  const f = await cliFixture(t);
  const result = f.run(['dist', f.destination, '--assets', 'assets', '--release-id', '1'.repeat(40)]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target.*required/i);
  await assert.rejects(access(f.destination));
  await assert.rejects(access(f.destination + '.tgz'));
});

for (const [name, flags, error] of [
  ['unknown flag', ['--unknown'], /unknown option/i],
  ['duplicate flag', ['--format', 'full', '--format', 'full'], /duplicate option/i],
  ['invalid format', ['--format', 'legacy'], /format.*layers.*full/i],
  ['missing flag value', ['--format'], /requires a value/i],
  ['too many arguments', ['third'], /positional/i],
  ['full prepare-only', ['--format', 'full', '--prepare-only'], /prepare-only.*layers/i],
  ['platform override', ['--platform', 'linux'], /unknown option/i],
]) test(`CLI rejects ${name} before writes`, async t => {
  const f = await cliFixture(t), result = f.run(['dist', f.destination, ...flags]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, error);
  await assert.rejects(access(f.destination));
  await assert.rejects(access(f.destination + '.tgz'));
});

test('check-target requires target and cannot silently package defaults', async t => {
  const f = await cliFixture(t), result = f.run(['--check-target']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target.*required/i);
  assert.deepEqual((await readdir(f.project)).sort(), ['package.json']);
});

test('a mismatched target is rejected before staging or starting Python', async t => {
  const f = await cliFixture(t);
  f.target.runtime.node = '0.0.0';
  await writeFile(f.targetFile, JSON.stringify(f.target));
  const result = f.run(['dist', f.destination, '--assets', 'assets', '--release-id', '1'.repeat(40),
    '--target', f.targetFile, '--python', path.join(f.root, 'must-not-run')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime fingerprint.*target/i);
  await assert.rejects(access(f.destination));
  assert.ok(!result.stdout.includes('ready'));
});

test('the actual Windows host cannot claim Linux target compatibility', { skip: process.platform !== 'win32' }, async t => {
  const f = await cliFixture(t), result = f.run(['--check-target', '--target', f.targetFile]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime fingerprint.*target/i);
  assert.deepEqual((await readdir(f.project)).sort(), ['package.json']);
});

for (const [name, mutate] of [
  ['cache root', target => { target.assemblyCacheRoot = '/tmp/cache'; }],
  ['toolchain', target => { target.toolchain.packageManager = 'pnpm@11.18.0'; }],
  ['extra field', target => { target.extra = true; }],
  ['missing runtime field', target => { delete target.runtime.abi; }],
]) test(`check-target rejects invalid ${name} without artifacts`, async t => {
  const f = await cliFixture(t);
  mutate(f.target);
  await writeFile(f.targetFile, JSON.stringify(f.target));
  const result = f.run(['--check-target', '--target', f.targetFile]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid target/i);
  assert.deepEqual((await readdir(f.project)).sort(), ['package.json']);
});
test('excludes precisely four source PNGs from both copy paths, retaining originals and public outputs', gnuTarOnly, async t => {
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
test('generated Next maps stay in a separate debug archive while runtime code and unrelated maps stay intact', gnuTarOnly, async t => {
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
test('retains generated route traces separately without removing runtime files or similarly named resources', gnuTarOnly, async t => {
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
import { cp, readdir, symlink, rename, link } from 'node:fs/promises';
import { createRequire } from 'node:module';

const hostPlatform = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? 'linuxmusl' : process.platform;
const hostNative = `@img/sharp-${hostPlatform}-${process.arch}`;
let sharpFixture;
after(async () => { if (sharpFixture) await rm(await sharpFixture, { recursive: true, force: true }); });
// Copy the real host closure once, then hardlink immutable files into independent fixture directories.
async function installSharpFixture(destination) {
  if (sharpFixture) {
    async function clone(source, target) {
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(source, { withFileTypes: true })) {
        if (entry.isDirectory()) await clone(path.join(source, entry.name), path.join(target, entry.name));
        else await link(path.join(source, entry.name), path.join(target, entry.name));
      }
    }
    await clone(await sharpFixture, destination);
    return;
  }
  sharpFixture = mkdtemp(path.join(tmpdir(), 'zimage-sharp-fixture-'));
  const cache = await sharpFixture;
  const sourceRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  const copied = new Set();
  async function copyPackage(name, resolver) {
    if (copied.has(name)) return;
    let manifest;
    try { manifest = resolver.resolve(`${name}/package.json`); }
    catch (error) {
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      const exportedEntry = name.startsWith('@img/sharp-libvips-') ? `${name}/lib`
        : name.startsWith('@img/sharp-') ? `${name}/sharp.node` : name;
      let directory = path.dirname(resolver.resolve(exportedEntry));
      while (true) {
        try {
          const candidate = path.join(directory, 'package.json');
          if (JSON.parse(await readFile(candidate, 'utf8')).name === name) { manifest = candidate; break; }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const parent = path.dirname(directory);
        if (parent === directory) throw new Error(`Cannot find exact manifest for ${name}`);
        directory = parent;
      }
    }
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    copied.add(name);
    await cp(path.dirname(manifest), path.join(cache, 'node_modules', name), { recursive: true, dereference: true });
    const resolverHere = createRequire(manifest);
    for (const dep of Object.keys(data.dependencies || {})) await copyPackage(dep, resolverHere);
    for (const dep of Object.keys(data.optionalDependencies || {}))
      if (dep === hostNative || dep === `@img/sharp-libvips-${hostPlatform}-${process.arch}`) await copyPackage(dep, resolverHere);
  }
  await copyPackage('sharp', sourceRequire);
  await installSharpFixture(destination);
}

async function preflight() { return import('./package-preflight.mjs'); }

test('candidate preflight loads real host Sharp and reports JPEG WebP AVIF round trips after relocation', async t => {
  const f = await fixture(t);
  const moved = f.destination + '-moved';
  await mkdir(f.destination);
  await mkdir(path.join(f.destination, 'apps/web'), { recursive: true });
  await installSharpFixture(f.destination);
  await rename(f.destination, moved);
  const { preflightCandidate } = await preflight();
  const report = await preflightCandidate(moved);
  assert.deepEqual(report.codecs, ['jpeg', 'webp', 'avif']);
  assert.equal(report.platform, process.platform);
  assert.equal(report.arch, process.arch);
  assert.equal(report.libc, process.platform === 'linux' ? (hostPlatform === 'linuxmusl' ? 'musl' : 'glibc') : null);
  assert.ok(report.native.some(file => file.includes(hostNative.split('/')[1])), JSON.stringify(report));
});

test('candidate rejects absent native resolution even when native files remain elsewhere', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.destination, 'apps/web'), { recursive: true });
  await installSharpFixture(f.destination);
  const native = hostNative.slice('@img/'.length);
  await rename(path.join(f.destination, 'node_modules/@img', native), path.join(f.destination, 'unreachable-native'));
  const { preflightCandidate } = await preflight();
  await assert.rejects(preflightCandidate(f.destination), /Sharp native preflight failed/);
});

for (const kind of ['dangling', 'escaping', 'absolute']) test(`candidate rejects ${kind} links`, posixLinksOnly, async t => {
  const f = await fixture(t);
  await mkdir(f.destination);
  await f.put('release/inside/file', 'x');
  const target = kind === 'absolute' ? path.join(f.destination, 'inside') : kind === 'dangling' ? 'missing' : '../outside';
  await symlink(target, path.join(f.destination, 'link'), 'dir');
  const { validateCandidateLinks } = await preflight();
  await assert.rejects(validateCandidateLinks(f.destination), /link/i);
});

async function linkFixture(t) {
  const parent = await mkdtemp(path.join(tmpdir(), 'zimage-link-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'candidate');
  await mkdir(root);
  return { root, parent };
}

test('candidate rejects a lexical internal link escaping through an ancestor link with chain-specific error', posixLinksOnly, async t => {
  const { root, parent } = await linkFixture(t);
  await mkdir(path.join(parent, 'outside'));
  await writeFile(path.join(parent, 'outside/file'), 'outside');
  // Sorted traversal must inspect a-chain before z-ancestor; a-chain itself has no lexical escape.
  await symlink('../outside', path.join(root, 'z-ancestor'), 'dir');
  await symlink('z-ancestor/file', path.join(root, 'a-chain'), 'file');
  const { validateCandidateLinks } = await preflight();
  await assert.rejects(validateCandidateLinks(root), /Escaping release link chain: .*a-chain/);
});

test('candidate rejects cyclic internal links', posixLinksOnly, async t => {
  const { root } = await linkFixture(t);
  await symlink('b-cycle', path.join(root, 'a-cycle'), 'file');
  await symlink('a-cycle', path.join(root, 'b-cycle'), 'file');
  const { validateCandidateLinks } = await preflight();
  await assert.rejects(validateCandidateLinks(root), /Dangling or cyclic release link: .*a-cycle/);
});

for (const diagnostic of ['chunk.js.map', 'route.js.nft.json']) test(`candidate rejects retained links to archive-excluded ${diagnostic}`, posixLinksOnly, async t => {
  const { root } = await linkFixture(t);
  await writeFile(path.join(root, diagnostic), 'diagnostic');
  await symlink(diagnostic, path.join(root, 'z-intermediate'), 'file');
  await symlink('z-intermediate', path.join(root, 'a-retained'), 'file');
  const { validateCandidateLinks } = await preflight();
  await assert.rejects(validateCandidateLinks(root, [`./${diagnostic}`]), /release link targets archive-excluded file: .*a-retained/i);
  await validateCandidateLinks(root);
});

test('relative internal links remain valid after moving candidate', posixLinksOnly, async t => {
  const f = await fixture(t);
  await f.put('release/inside/file', 'x');
  await symlink('inside', path.join(f.destination, 'link'), 'dir');
  const moved = f.destination + '-moved';
  await rename(f.destination, moved);
  const { validateCandidateLinks } = await preflight();
  await validateCandidateLinks(moved);
  assert.equal(await readFile(path.join(moved, 'link/file'), 'utf8'), 'x');
});

test('packaging rejects missing Sharp before creating any success archive', async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, 'dist/standalone/node_modules'), { recursive: true, force: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Sharp native preflight failed/);
  await assert.rejects(access(f.destination + '.tgz'));
});


test('host selection rejects a native package available only under a different platform name', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.destination, 'apps/web'), { recursive: true });
  await installSharpFixture(f.destination);
  await rename(path.join(f.destination, 'node_modules', hostNative), path.join(f.destination, 'node_modules/@img/sharp-wrong-platform'));
  const { preflightCandidate } = await preflight();
  await assert.rejects(preflightCandidate(f.destination), /Sharp native preflight failed/);
});

test('native probe ignores inherited Node configuration and source module search paths', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.destination, 'apps/web'), { recursive: true });
  await installSharpFixture(f.destination);
  const before = { NODE_OPTIONS: process.env.NODE_OPTIONS, NODE_PATH: process.env.NODE_PATH };
  process.env.NODE_OPTIONS = '--require=definitely-missing-preflight-module';
  process.env.NODE_PATH = path.resolve('node_modules');
  try {
    const { preflightCandidate } = await preflight();
    assert.deepEqual((await preflightCandidate(f.destination)).codecs, ['jpeg', 'webp', 'avif']);
    await rm(path.join(f.destination, 'node_modules/sharp'), { recursive: true });
    await assert.rejects(preflightCandidate(f.destination), /Sharp native preflight failed/);
  } finally {
    for (const key of Object.keys(before)) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  }
});

test('packaging rejects a non-portable link before opening any archive', posixLinksOnly, async t => {
  const f = await fixture(t);
  await symlink(path.join(f.root, 'dist/standalone/apps/web'), path.join(f.root, 'dist/standalone/absolute-link'), 'junction');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release link/i);
  for (const suffix of ['.tgz', '.debug-maps.tgz', '.build-traces.tgz']) await assert.rejects(access(f.destination + suffix));
});

test('full packaging rejects noncanonical Next config before staging', async t => {
  const f = await fixture(t);
  await f.put('dist/required-server-files.json', JSON.stringify({ config: { distDir: '.next-build-qa' } }));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /canonical .next/);
  await assert.rejects(access(f.destination));
});

test('shared staging preserves public exclusions and diagnostic evidence before archiving', async t => {
  const f = await fixture(t);
  await f.put('dist/standalone/apps/web/.next/server/api/[id]/route.js.map', 'map');
  await f.put('dist/standalone/apps/web/.next/server/api/[id]/route.js.nft.json', 'trace');
  await f.put('dist/standalone/apps/web/.next/server/world.map/page.js', 'route');
  await f.put('dist/static/chunks/main.css.map', 'css map');
  await f.put('dist/standalone/node_modules/pkg/lib.js.map', 'dependency map');
  const { stageCandidate } = await import('./package-stage.mjs');
  const stage = await stageCandidate({ project: f.root, dist: 'dist', destination: f.destination });
  assert.deepEqual(stage.maps, ['./apps/web/.next/server/api/[id]/route.js.map', './apps/web/.next/static/chunks/main.css.map']);
  assert.deepEqual(stage.traces, ['./apps/web/.next/server/api/[id]/route.js.nft.json']);
  assert.deepEqual(stage.nativeReport.codecs, ['jpeg', 'webp', 'avif']);
  for (const name of excluded) await assert.rejects(access(path.join(f.destination, 'apps/web/public', name)));
  for (const name of f.kept) await access(path.join(f.destination, 'apps/web/public', name));
  await assert.rejects(access(path.join(f.destination, '.env.production')));
  await access(path.join(f.destination, 'apps/web/.next/server/world.map/page.js'));
  await access(path.join(f.destination, 'node_modules/pkg/lib.js.map'));
});

test('diagnostic classification rejects generated map symlinks and preserves route directories', async () => {
  const { diagnosticKind } = await import('./package-stage.mjs');
  for (const entry of ['apps/web/.next/server/a.js.map', 'apps/web/.next/static/a.css.map'])
    assert.throws(() => diagnosticKind(entry, 'symlink'), /diagnostic.*symlink/i);
  assert.equal(diagnosticKind('apps/web/.next/server/a.js.map', 'file'), 'map');
  assert.equal(diagnosticKind('apps/web/.next/server/world.map', 'directory'), null);
  assert.equal(diagnosticKind('apps/web/.next/server/world.map/page.js', 'file'), null);
  assert.equal(diagnosticKind('apps/web/.next/server/route.js.nft.json', 'file'), 'trace');
  assert.equal(diagnosticKind('apps/web/.next/server/route.js.nft.json', 'symlink'), null);
  for (const entry of ['node_modules/pkg/library.js.map', 'apps/web/public/notes.map'])
    assert.equal(diagnosticKind(entry, 'symlink'), null);
});

test('shared staging rejects map-to-map symlinks before publishing any archive', async t => {
  const f = await fixture(t);
  const directory = 'dist/standalone/apps/web/.next/server';
  await f.put(`${directory}/b.js.map`, 'original map');
  const source = path.join(f.root, directory, 'a.js.map');
  try { await symlink('b.js.map', source, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`Windows file symlink fixture denied: ${error.code}; real POSIX regression remains pending`);
      return;
    }
    throw error;
  }
  const { stageCandidate } = await import('./package-stage.mjs');
  await assert.rejects(stageCandidate({ project: f.root, dist: 'dist', destination: f.destination }), /diagnostic.*symlink/i);
  assert.equal(await readFile(source, 'utf8'), 'original map');
  for (const suffix of ['.tgz', '.debug-maps.tgz', '.build-traces.tgz'])
    await assert.rejects(access(f.destination + suffix));
});

test('target check rejects project toolchain drift before any build input is needed', async t => {
  const f = await cliFixture(t);
  await writeFile(path.join(f.project, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }));
  const result = f.run(['--check-target', '--target', f.targetFile]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project packageManager.*target/i);
  assert.deepEqual((await readdir(f.project)).sort(), ['package.json']);
});

test('parser selects layers by default while explicit full retains legacy paths', async () => {
  const { parseReleaseArgs } = await import('./package-release.mjs');
  const layers = parseReleaseArgs(['dist', '/tmp/new-release', '--assets', '/tmp/version', '--release-id', '1'.repeat(40), '--target', '/tmp/target.json']);
  assert.equal(layers.format, 'layers');
  assert.equal(layers.prepareOnly, false);
  assert.equal(parseReleaseArgs(['--format', 'full']).destination, '/tmp/zimage-release');
});

test('failed archive child removes its partial output and propagates failure', async t => {
  const f = await cliFixture(t);
  const { writeArchive } = await import('./package-stage.mjs');
  const archive = path.join(f.root, 'failed.tgz');
  await assert.rejects(writeArchive(archive, f.project, ['--zimage-invalid-option']), /archive command failed/i);
  await assert.rejects(access(archive));
});

const linuxOnly = { skip: process.platform !== 'linux' ? 'Requires actual Linux/glibc, native Linux Sharp and GNU tar' : false };
async function layerFixture(t) {
  const f = await fixture(t);
  const work = await mkdtemp(path.join(tmpdir(), 'zimage-layer-entry-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const config = { distDir: '.next', output: 'standalone', images: { remotePatterns: [] } };
  for (const name of ['dist/required-server-files.json', 'dist/standalone/apps/web/.next/required-server-files.json'])
    await f.put(name, JSON.stringify({ config }));
  await f.put('dist/standalone/apps/web/.next/BUILD_ID', 'fixture-build');
  await f.put('dist/standalone/apps/web/.next/server/chunk.js', 'server chunk');
  await f.put('dist/standalone/apps/web/.next/server/chunk.js.map', 'debug evidence');
  await f.put('dist/standalone/apps/web/.next/server/route.js.nft.json', '{"version":1,"files":[]}');
  await f.put('package.json', JSON.stringify({ packageManager: 'pnpm@11.19.0' }));
  await f.put('pnpm-lock.yaml', 'lockfileVersion: 9.0');
  await f.put('apps/web/next.config.ts', 'export default {output:"standalone"};');
  await f.put('apps/web/build/static-assets-config.mjs', 'export const assets = {};');
  const values = new Map(f.kept.map(name => [name, Buffer.from(`apps/web/public/${name}`)]));
  for (const name of ['NotoSansCJKsc-Regular.otf', 'NotoSansCJKsc-Bold.otf', 'LICENSE.txt', 'README.md'])
    values.set(`fonts/${name}`, Buffer.from(name));
  const sha = body => createHash('sha256').update(body).digest('hex');
  const body = JSON.stringify({ schema: 1, productionReady: false, files: [...values].map(([name, value]) => ({
    path: name, kind: name.startsWith('fonts/') ? 'font' : 'public', bytes: value.length, sha256: sha(value), mime: 'text/plain' })) });
  const assets = path.join(work, 'assets', sha(body));
  for (const [name, value] of [...values, ['asset-manifest.json', body]]) {
    await mkdir(path.dirname(path.join(assets, name)), { recursive: true });
    await writeFile(path.join(assets, name), value);
  }
  const target = { schema: 1, runtime: { node: process.versions.node, abi: process.versions.modules, platform: process.platform,
    arch: process.arch, libc: `glibc-${process.report.getReport().header.glibcVersionRuntime}` },
    toolchain: { packageManager: 'pnpm@11.19.0' }, assemblyCacheRoot: '/opt/zimage/layer-cache' };
  const targetFile = path.join(work, 'target.json');
  await writeFile(targetFile, JSON.stringify(target));
  const destination = path.join(work, 'output');
  const run = (extra = [], dest = destination, releaseSha = '1'.repeat(40)) => spawnSync(process.execPath,
    [script, 'dist', dest, '--assets', assets, '--release-id', releaseSha, '--target', targetFile, ...extra],
    { cwd: f.root, encoding: 'utf8' });
  return { ...f, work, assets, targetFile, destination, run };
}

test('default layers publish one cold transport and separate diagnostics with measured accounting', linuxOnly, async t => {
  const f = await layerFixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(path.join(f.destination, 'release-result.json'), 'utf8'));
  assert.equal(report.format, 'layers');
  assert.equal(report.prepareOnly, false);
  assert.equal(report.transport.upload.length, 7);
  assert.equal(report.transport.reuse.length, 0);
  const members = spawnSync('tar', ['-tzf', report.artifacts.transport], { encoding: 'utf8' });
  assert.equal(members.status, 0, members.stderr);
  assert.equal(members.stdout.trim().split('\n').length, 7);
  assert.equal(report.transport.bytes, (await stat(report.artifacts.transport)).size);
  await assert.rejects(access(f.destination + '.tgz'));
  const request = JSON.parse(await readFile(report.artifacts.inventoryRequest, 'utf8'));
  assert.equal(Object.keys(request.files).length, 7);
  for (const kind of ['code', 'runtime', 'assets']) {
    await access(path.join(report.artifacts.store, report.pack.layers[kind].archive));
    await access(path.join(report.artifacts.store, report.pack.layers[kind].index));
  }
  const codeMembers = spawnSync('tar', ['-tzf', path.join(report.artifacts.store, report.pack.layers.code.archive)], { encoding: 'utf8' });
  assert.equal(codeMembers.status, 0, codeMembers.stderr);
  assert.ok(!codeMembers.stdout.includes('chunk.js.map'));
  assert.ok(!codeMembers.stdout.includes('route.js.nft.json'));
  await access(report.artifacts.debugMaps);
  await access(report.artifacts.buildTraces);
});

test('prepare-only publishes layer objects and inventory request without an outer archive', linuxOnly, async t => {
  const f = await layerFixture(t), result = f.run(['--prepare-only']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(path.join(f.destination, 'release-result.json'), 'utf8'));
  assert.equal(report.prepareOnly, true);
  assert.equal(report.artifacts.transport, null);
  assert.equal(report.transport.bundle, undefined);
  await access(report.artifacts.manifest);
  await access(report.artifacts.inventoryRequest);
  await assert.rejects(access(path.join(f.destination, 'transport.tgz')));
  await assert.rejects(access(f.destination + '.tgz'));
});

test('matching target inventory yields manifest-only delta while retaining full local store', linuxOnly, async t => {
  const f = await layerFixture(t);
  assert.equal(f.run(['--prepare-only']).status, 0);
  const inventory = JSON.parse(await readFile(path.join(f.destination, 'inventory-request.json'), 'utf8'));
  inventory.releaseSha = '2'.repeat(40);
  for (const name of Object.keys(inventory.files)) if (name.startsWith('releases/')) delete inventory.files[name];
  const inventoryFile = path.join(f.work, 'inventory.json');
  await writeFile(inventoryFile, JSON.stringify(inventory));
  const dest = path.join(f.work, 'delta'), result = f.run(['--inventory', inventoryFile], dest, '2'.repeat(40));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(path.join(dest, 'release-result.json'), 'utf8'));
  assert.equal(report.transport.upload.length, 1);
  assert.equal(report.transport.reuse.length, 6);
  assert.ok(report.transport.compressedTransferBytes < report.transport.requiredCompressedBytes);
  assert.equal((await readdir(path.join(dest, 'store/layers'))).length, 6);
});

test('layers native failure prevents all layer and outer archives', linuxOnly, async t => {
  const f = await layerFixture(t);
  await rm(path.join(f.root, 'dist/standalone/node_modules'), { recursive: true, force: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Sharp native preflight failed/);
  for (const name of ['store', 'transport.tgz', 'debug-maps.tgz', 'build-traces.tgz', 'release-result.json'])
    await assert.rejects(access(path.join(f.destination, name)));
});

test('a failing Python child cannot publish a transport or report success', linuxOnly, async t => {
  const f = await layerFixture(t), result = f.run(['--python', path.join(f.work, 'missing-python')]);
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes('ready'));
  await assert.rejects(access(path.join(f.destination, 'transport.tgz')));
  await assert.rejects(access(path.join(f.destination, 'release-result.json')));
});
