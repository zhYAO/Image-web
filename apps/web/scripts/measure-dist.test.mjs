import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
