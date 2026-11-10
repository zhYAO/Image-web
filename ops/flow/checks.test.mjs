import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runChecks } from './checks.mjs';

const commit = 'a'.repeat(40);

function fixture(t, { checkout = commit, types = 'export type Database = {}\n', failTest = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'zimage-flow-checks-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const directory = join(cwd, 'apps', 'web', 'lib', 'supabase');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'database.generated.ts'), 'export type Database = {}\r\n');
  const commands = [];
  const execute = (program, args) => {
    const command = [program, ...args].join(' ');
    commands.push(command);
    if (command === 'git rev-parse --verify HEAD') return `${checkout}\n`;
    if (command === 'pnpm --version') return '11.19.0\n';
    if (command === 'pnpm exec supabase gen types typescript --local') return types;
    if (failTest && command.startsWith('pnpm exec supabase test db')) throw new Error('pgTAP failed');
    return '';
  };
  const input = { job: 'database', expectedCommit: commit, cwd, execute, nodeVersion: 'v24.19.0', isolatedDocker: true };
  return { input, commands };
}

test('rejects a stale checkout before invoking dependency installation', (t) => {
  const { input, commands } = fixture(t, { checkout: 'b'.repeat(40) });
  assert.throws(() => runChecks(input), /checkout.*commit/i);
  assert.deepEqual(commands, ['git rev-parse --verify HEAD']);
});

test('checks the full local database and generated type contract', (t) => {
  const { input, commands } = fixture(t);
  runChecks(input);
  assert.ok(commands.includes('pnpm exec supabase test db supabase/tests/database'));
  assert.ok(commands.includes('pnpm exec supabase gen types typescript --local'));
  assert.ok(commands.includes('pnpm exec supabase stop --no-backup'));
  assert.equal(commands.at(-1), 'git rev-parse --verify HEAD');
});

test('rejects generated type drift and still stops the isolated database', (t) => {
  const { input, commands } = fixture(t, { types: 'export type Database = never\n' });
  assert.throws(() => runChecks(input), /generated.*types/i);
  assert.equal(commands.at(-1), 'pnpm exec supabase stop --no-backup');
});

test('preserves a pgTAP failure and stops the isolated database', (t) => {
  const { input, commands } = fixture(t, { failTest: true });
  assert.throws(() => runChecks(input), /pgTAP failed/);
  assert.equal(commands.at(-1), 'pnpm exec supabase stop --no-backup');
});

test('requires explicit isolation before starting the local Supabase stack', (t) => {
  const { input, commands } = fixture(t);
  assert.throws(() => runChecks({ ...input, isolatedDocker: false }), /isolated Docker/i);
  assert.ok(!commands.some((command) => command.includes('supabase start')));
});

test('rejects pre-existing Docker volumes before starting or stopping Supabase', (t) => {
  const { input, commands } = fixture(t);
  const execute = (program, args, options) => {
    const output = input.execute(program, args, options);
    return program === 'docker' && args[0] === 'volume' ? 'fixture-volume\n' : output;
  };
  assert.throws(() => runChecks({ ...input, execute }), /0 containers, 1 volume/);
  assert.ok(!commands.some(command => command.startsWith('pnpm exec supabase')));
});

test('quality runs web coverage and Flow tests without preparing or requiring apparel fonts', (t) => {
  const { input, commands } = fixture(t);
  runChecks({ ...input, job: 'quality', environment: {} });
  assert.ok(!commands.some(command => command.startsWith('curl ') || command.includes('package-static-assets.mjs ')));
  assert.ok(!commands.some(command => /(?:package-static-assets|native-font-probe)\.test\.mjs/.test(command)));
  assert.ok(commands.some(command => command.includes('vitest run --coverage') && command.includes('--testNamePattern')));
  assert.ok(commands.includes('python3 -B -m unittest discover -s ops/flow -p test_*.py'));
  assert.ok(commands.includes('pnpm build:frontend'));
  assert.ok(commands.includes('pnpm build'));
});

test('backend requires real apparel tests with the verified candidate fonts before packaging', (t) => {
  const { input, commands } = fixture(t);
  let verifiedFonts;
  let assetTestsVerifiedFonts;
  const execute = (program, args, options) => {
    const output = input.execute(program, args, options);
    if (args[0] === 'ops/aliyun/package-static-assets.mjs') {
      return JSON.stringify({ versionDirectory: input.cwd, manifestSha256: 'b'.repeat(64) });
    }
    if (args.includes('ops/aliyun/native-font-probe.test.mjs')) {
      assert.ok(args.includes('ops/aliyun/package-static-assets.test.mjs'));
      assert.equal(options.env.ZIMAGE_STATIC_ASSET_SHA256, 'b'.repeat(64));
      assetTestsVerifiedFonts = options.env.ZIMAGE_SHARED_FONT_DIR;
    }
    if (args.includes('tests/apparel-renderer.test.ts')) {
      verifiedFonts = options.env.ZIMAGE_SHARED_FONT_DIR;
      assert.equal(options.env.ZIMAGE_STATIC_ASSET_SHA256, 'b'.repeat(64));
      throw new Error('real font render failed');
    }
    return output;
  };
  assert.throws(() => runChecks({ ...input, job: 'backend', execute,
    backend: { target: 'target.json', fontSource: 'fonts', destination: 'output' },
    environment: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_fixture' },
  }), /real font render failed/);
  assert.equal(verifiedFonts, join(input.cwd, 'fonts'));
  assert.equal(assetTestsVerifiedFonts, verifiedFonts);
  assert.ok(!commands.some(command => command.includes('package-release.mjs apps/web/.next')));
});

test('backend validates the target before installing dependencies', (t) => {
  const { input, commands } = fixture(t);
  const execute = (program, args, options) => {
    const output = input.execute(program, args, options);
    if (args.includes('--check-target')) throw new Error('target ABI mismatch');
    return output;
  };
  assert.throws(() => runChecks({ ...input, job: 'backend', execute,
    backend: { target: 'target.json', fontSource: 'fonts', destination: 'output' },
  }), /target ABI mismatch/);
  assert.ok(!commands.includes('pnpm install --frozen-lockfile'));
});

test('backend rejects dotenv files before invoking the build toolchain', (t) => {
  const { input, commands } = fixture(t);
  writeFileSync(join(input.cwd, 'apps/web/.env.local'), 'SHOULD_NEVER_LOAD=1\n');
  assert.throws(() => runChecks({ ...input, job: 'backend',
    backend: { target: 'target.json', fontSource: 'fonts', destination: 'output' },
  }), /dotenv/i);
  assert.ok(!commands.includes('pnpm install --frozen-lockfile'));
});

test('backend rejects a Supabase secret passed as the public build key', (t) => {
  const { input, commands } = fixture(t);
  assert.throws(() => runChecks({ ...input, job: 'backend',
    backend: { target: 'target.json', fontSource: 'fonts', destination: 'output' },
    environment: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_invalid' },
  }), /Supabase publishable key/);
  assert.ok(!commands.includes('pnpm install --frozen-lockfile'));
});
