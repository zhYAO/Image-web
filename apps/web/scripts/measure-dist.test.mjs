import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, readlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./measure-dist.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'zimage-dist-'));
  const dist = path.join(root, '.next');
  const write = (relative, bytes) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.alloc(bytes, 0x61));
  };
  // Release layout mirrors the assembled package: standalone keeps the
  // outputFileTracingRoot-relative apps/web/... paths, plus static and public.
  write('.next/standalone/apps/web/server.js', 1000);
  write('.next/standalone/apps/web/server/apparel/fonts/NotoSansCJKsc-Bold.otf', 400);
  write('.next/standalone/apps/web/server/apparel/fonts/NotoSansCJKsc-Regular.otf', 300);
  write('.next/standalone/node_modules/sharp/build/Release/sharp.node', 2000);
  write('.next/static/chunks/main.js', 500);
  write('public/commerce/example.png', 700);
  // Diagnostics live inside .next/server and .next/static but ship separately.
  write('.next/standalone/apps/web/.next/server/app/page.js.map', 90_000);
  write('.next/standalone/apps/web/.next/server/app/page.js.nft.json', 60_000);
  return { root, dist };
}

function run(root, dist, extra = []) {
  // Absolute paths also exercise the fixture's own public directory rather than
  // the repository's, so the reported totals are fully determined by the fixture.
  return execFileSync(process.execPath, [
    script,
    '--dist', dist,
    '--public', path.join(root, 'public'),
    ...extra,
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('reports mutually exclusive logical bytes and excludes maps and traces', () => {
  const { root, dist } = fixture();
  try {
    const output = run(root, dist);
    assert.match(output, /complete runtime\s+4900\b/);
    assert.match(output, /business subtotal\s+1500\b/);
    assert.match(output, /runtime dependencies\s+2000\b/);
    assert.match(output, /fonts and licenses\s+700\b/);
    assert.match(output, /public assets\s+700\b/);
    // Diagnostics are reported, never folded into the runtime total.
    assert.match(output, /Excluded diagnostics: 2 files, 150000 bytes/);
    assert.match(output, /Slim trace check: PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('excludes the source images that the release policy keeps out of the package', () => {
  const { root, dist } = fixture();
  try {
    // release-public-policy.json drops this exact public path from the release.
    const excluded = path.join(root, 'public/commerce/apparel-v2/source-hero.png');
    mkdirSync(path.dirname(excluded), { recursive: true });
    writeFileSync(excluded, Buffer.alloc(5000, 0x61));
    const output = run(root, dist);
    // Totals must stay identical to the baseline fixture: the image never ships.
    assert.match(output, /complete runtime\s+4900\b/);
    assert.match(output, /public assets\s+700\b/);
    assert.match(output, /Excluded public policy: 1 files, 5000 bytes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('assert-slim fails when Next development output is traced into the release', () => {
  const { root, dist } = fixture();
  try {
    const dev = path.join(root, '.next/standalone/node_modules/next/dist/server/dev');
    mkdirSync(dev, { recursive: true });
    writeFileSync(path.join(dev, 'next-dev-server.js'), 'module.exports = {};');
    assert.throws(() => run(root, dist, ['--assert-slim']), /Command failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('assert-slim also catches the traced esbuild binary and dev bundler', () => {
  for (const relative of [
    'node_modules/.pnpm/@esbuild+linux-x64@0.25.0/node_modules/@esbuild/linux-x64/bin/esbuild',
    'node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js',
  ]) {
    const { root, dist } = fixture();
    try {
      const target = path.join(root, '.next/standalone', relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'binary');
      assert.throws(() => run(root, dist, ['--assert-slim']), /Command failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('refuses partial totals instead of under-reporting a missing input', () => {
  const { root, dist } = fixture();
  try {
    // A dist without static output must not be reported as a small release.
    rmSync(path.join(dist, 'static'), { recursive: true, force: true });
    assert.throws(() => run(root, dist), /Command failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function report(root, dist) {
  const json = path.join(root, 'report.json');
  run(root, dist, ['--json', json]);
  return JSON.parse(readFileSync(json, 'utf8'));
}

test('counts unique input files once, including separately reported diagnostics', () => {
  const { root, dist } = fixture();
  try {
    const result = report(root, dist);
    assert.equal(result.regularFiles, 8);
    assert.equal(result.diagnostics.files, 2);
    assert.equal(result.completeRuntimeBytes, 4900);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('counts actual UTF-8 link target bytes without following the target', () => {
  const { root, dist } = fixture();
  try {
    const target = path.join(root, 'external-target-with-a-long-name');
    mkdirSync(target);
    writeFileSync(path.join(target, 'not-shipped.txt'), Buffer.alloc(9999));
    const link = path.join(dist, 'standalone/node_modules/x');
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const result = report(root, dist);
    assert.equal(result.symlinks, 1);
    assert.equal(result.symlinkTargetBytes, Buffer.byteLength(readlinkSync(link)));
    assert.equal(result.completeRuntimeBytes, 4900);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('uses the same later static/public overrides as the release packer', () => {
  const { root, dist } = fixture();
  try {
    const publicCopy = path.join(dist, 'standalone/apps/web/public/commerce');
    const staticCopy = path.join(dist, 'standalone/apps/web/.next/static/chunks');
    mkdirSync(publicCopy, { recursive: true });
    mkdirSync(staticCopy, { recursive: true });
    writeFileSync(path.join(publicCopy, 'example.png'), Buffer.alloc(100));
    writeFileSync(path.join(staticCopy, 'main.js'), Buffer.alloc(10));
    const assembled = path.join(root, 'assembled');
    cpSync(path.join(dist, 'standalone'), assembled, { recursive: true, verbatimSymlinks: true });
    cpSync(path.join(root, 'public'), path.join(assembled, 'apps/web/public'), { recursive: true });
    cpSync(path.join(dist, 'static'), path.join(assembled, 'apps/web/.next/static'), { recursive: true });
    const result = report(root, dist);
    assert.equal(result.categories.publicAssets.bytes, readFileSync(path.join(assembled, 'apps/web/public/commerce/example.png')).length);
    assert.equal(result.categories.clientStatic.bytes, readFileSync(path.join(assembled, 'apps/web/.next/static/chunks/main.js')).length);
    assert.equal(result.completeRuntimeBytes, 4900);
    assert.equal(result.regularFiles, 8);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runtime audit counts package/subtree bytes once and records overlapping NFT owner paths', () => {
  const { root, dist } = fixture();
  try {
    const write = (relative, data) => {
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, data);
    };
    const pkg = 'node_modules/.pnpm/next@16.4.5/node_modules/next';
    const a = `${pkg}/dist/compiled/next-server/app-page.runtime.prod.js`;
    const b = `${pkg}/dist/server/lib/router-server.js`;
    const c = 'node_modules/.pnpm/@example+image@1.0.0/node_modules/@example/image/codec.wasm';
    for (const [file, size] of [[a, 500], [b, 300], [c, 51]]) {
      write(`.next/standalone/${file}`, Buffer.alloc(size));
      write(file, Buffer.alloc(size));
    }
    const tf = (owner, refs) => {
      const actual = path.join(dist, owner);
      const toSource = p => path.relative(path.dirname(actual), path.join(root, p)).split(path.sep).join('/');
      write(`.next/${owner}`, JSON.stringify({ version: 1, files: refs.map(toSource) }));
    };
    tf('next-server.js.nft.json', [a, a, b, 'node_modules/sharp/build/Release/sharp.node']);
    tf('server/app/workspace/page.js.nft.json', [a, c, '../ignored-outside-root.js']);
    write('.next/server/app/bad.js.nft.json', '{}');
    write('.next/cache/bogus.js.nft.json', '{"version":1,"files":[]}');
    const ordinary = report(root, dist);
    assert.equal(Object.hasOwn(ordinary, 'runtimeDependencyAudit'), false);
    const output = path.join(root, 'audit.json');
    run(root, dist, ['--runtime-audit', '--trace-root', root, '--json', output]);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    const audit = result.runtimeDependencyAudit;
    assert.equal(audit.runtimeBytes, ordinary.categories.runtimeDependencies.bytes);
    assert.equal(audit.runtimeFiles, ordinary.categories.runtimeDependencies.files);
    assert.deepEqual(audit.packages.map(({ name, bytes }) => [name, bytes]), [['sharp', 2000], ['next', 800], ['@example/image', 51]]);
    assert.deepEqual(audit.nextSubtrees.map(({ name, bytes }) => [name, bytes]), [['dist/compiled/next-server', 500], ['dist/server/lib', 300]]);
    assert.deepEqual(audit.packages.find(({ name }) => name === 'next').traceOwners, [
      { name: 'next-server.js.nft.json', bytes: 800 },
      { name: 'server/app/workspace/page.js.nft.json', bytes: 500 },
    ]);
    assert.deepEqual(audit.largestNextFiles[0], { name: a, bytes: 500, tracedBy: ['next-server.js.nft.json', 'server/app/workspace/page.js.nft.json'] });
    assert.equal(audit.trace.manifestsFound, 3);
    assert.equal(audit.trace.manifestsRead, 2);
    assert.equal(audit.trace.ignoredOutsideRoot, 1);
    assert.deepEqual(audit.trace.manifestErrors, ['server/app/bad.js.nft.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runtime audit accepts only a contained source alias and never counts symlink target copies', () => {
  const { root, dist } = fixture();
  try {
    const alias = path.join(root, 'node_modules/next');
    const instance = path.join(root, 'node_modules/.pnpm/next@16.4.5/node_modules/next');
    const install = path.join(dist, 'standalone/node_modules/.pnpm/next@16.4.5/node_modules/next');
    for (const dir of [instance, install]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), '{}');
    }
    symlinkSync(instance, alias, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(root, path.join(root, 'node_modules/loop'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(path.join(dist, 'next-server.js.nft.json'), JSON.stringify({
      version: 1,
      files: ['../node_modules/next/package.json', '../node_modules/loop/nonexistent', '/etc/passwd', null],
    }));
    const output = path.join(root, 'audit.json');
    run(root, dist, ['--runtime-audit', '--trace-root', root, '--json', output]);
    const result = JSON.parse(readFileSync(output, 'utf8')).runtimeDependencyAudit;
    assert.equal(result.runtimeBytes, 2002);
    assert.deepEqual(result.packages.find(pkg => pkg.name === 'next').traceOwners, [{ name: 'next-server.js.nft.json', bytes: 2 }]);
    assert.equal(result.trace.invalidEntries, 2);
    assert.equal(result.trace.unmatchedEntries, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
