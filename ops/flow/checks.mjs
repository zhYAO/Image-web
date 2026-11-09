import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function runCommand(program, args, { cwd, env, capture }) {
  const result = spawnSync(program, args, {
    cwd, env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args[0]} failed (${result.status ?? result.signal})`);
  return result.stdout ?? '';
}

function databaseChecks(run, cwd) {
  const count = (output) => output.split(/\r?\n/).filter(line => line.trim()).length;
  const containers = count(run('docker', ['ps', '-aq'], true));
  const volumes = count(run('docker', ['volume', 'ls', '-q'], true));
  if (containers || volumes) {
    throw new Error(`Database checks require an empty, isolated Docker daemon (${containers} containers, ${volumes} volumes)`);
  }

  let failure;
  try {
    run('pnpm', ['exec', 'supabase', 'start'], true);
    run('pnpm', ['exec', 'supabase', 'test', 'db', 'supabase/tests/database']);
    const generated = run('pnpm', ['exec', 'supabase', 'gen', 'types', 'typescript', '--local'], true);
    const expected = readFileSync(join(cwd, 'apps/web/lib/supabase/database.generated.ts'), 'utf8');
    if (generated.replaceAll('\r\n', '\n') !== expected.replaceAll('\r\n', '\n')) {
      throw new Error('Generated database types differ from apps/web/lib/supabase/database.generated.ts');
    }
  } catch (error) {
    failure = error;
  }

  try {
    run('pnpm', ['exec', 'supabase', 'stop', '--no-backup'], true);
  } catch (error) {
    if (failure) throw new AggregateError([failure, error], `${failure.message}; isolated Supabase cleanup failed`);
    throw error;
  }
  if (failure) throw failure;
}

function qualityChecks(run, env, expectedCommit) {
  run('pnpm', ['lint']);
  run('pnpm', ['typecheck']);
  run('pnpm', ['--filter', '@zimage/domain', 'test:coverage']);
  run('pnpm', ['--filter', '@zimage/frontend', 'test:run']);
  run('pnpm', ['--filter', '@zimage/web', 'exec', 'vitest', 'run', '--coverage',
    '--testNamePattern', '^(?!.*\\[apparel-fonts\\])', '--maxWorkers=1', '--testTimeout=120000']);
  run('pnpm', ['--filter', '@zimage/web', 'test:acceptance-budget']);
  run('node', ['--test', 'scripts/dev.test.mjs', 'scripts/dev-split.test.mjs', 'scripts/acceptance-credit-budget.test.mjs',
    'scripts/release.test.mjs', 'apps/web/scripts/ui-dependency-boundary.test.mjs', 'apps/web/scripts/measure-dist.test.mjs',
    'ops/aliyun/package-static-assets.test.mjs', 'ops/aliyun/package-release.test.mjs', 'ops/aliyun/native-font-probe.test.mjs',
    'ops/aliyun/frontend/package.test.mjs', 'ops/aliyun/backend/http-admission.test.cjs',
    'ops/flow/checks.test.mjs', 'ops/flow/reconcile.test.mjs']);
  for (const directory of ['ops/aliyun', 'ops/aliyun/frontend', 'ops/aliyun/backend', 'ops/aliyun/paired']) {
    run('python3', ['-B', '-m', 'unittest', 'discover', '-s', directory, '-p', 'test_*.py']);
  }
  run('pnpm', ['exec', 'vitest', 'run', 'supabase/functions/generation-worker', 'supabase/functions/cleanup-worker']);

  env.ZIMAGE_ASSET_NAMESPACE = `ci-${expectedCommit}`;
  env.ZIMAGE_FRONTEND_COMPATIBILITY = JSON.stringify({
    apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.public-config.v1', 'runtime.meta.v1'] },
    allowedBackendReleases: [expectedCommit],
  });
  run('pnpm', ['build:frontend']);
  env.NEXT_PUBLIC_DATA_MODE = 'mock';
  run('pnpm', ['build']);
  run('node', ['apps/web/scripts/verify-built-retired-route.mjs']);
}

function backendPreflight(run, cwd, backend) {
  if (!backend?.target || !backend.fontSource || !backend.destination) {
    throw new Error('Backend build requires a target manifest, original fonts and an artifact destination');
  }
  for (const directory of [cwd, join(cwd, 'apps/web')]) {
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      if (existsSync(join(directory, name))) throw new Error('Backend build rejects dotenv files');
    }
  }
  if (run('git', ['status', '--porcelain=v1', '--untracked-files=all'], true).trim()) {
    throw new Error('Backend build requires a clean source checkout');
  }
  run('node', ['ops/aliyun/package-release.mjs', '--check-target', '--target', backend.target]);
}

function buildBackend(run, env, expectedCommit, backend) {
  const work = mkdtempSync(join(tmpdir(), 'zimage-flow-backend-'));
  try {
    const resources = JSON.parse(run('node', ['ops/aliyun/package-static-assets.mjs',
      '--font-source', backend.fontSource, '--output', join(work, 'resources')], true));
    Object.assign(env, {
      NEXT_PUBLIC_DATA_MODE: 'http', NEXT_PUBLIC_PHASE2_AUTH: 'true', NEXT_PUBLIC_STATIC_ASSET_BASE_URL: '',
      ZIMAGE_DEPLOYMENT_ENV: 'production', ZIMAGE_BUILD_SHA: expectedCommit, ZIMAGE_BUILD_SLIM: '1',
      ZIMAGE_SHARED_FONT_DIR: join(resources.versionDirectory, 'fonts'),
      ZIMAGE_STATIC_ASSET_SHA256: resources.manifestSha256, NODE_OPTIONS: '--max-old-space-size=4096',
    });
    run('pnpm', ['--filter', '@zimage/web', 'exec', 'vitest', 'run',
      'tests/apparel-font-files.test.ts', 'tests/apparel-renderer.test.ts', 'tests/apparel-service.test.ts',
      '--maxWorkers=1', '--testTimeout=120000']);
    run('pnpm', ['--filter', '@zimage/web', 'exec', 'next', 'build', '--webpack']);
    run('node', ['apps/web/scripts/verify-built-retired-route.mjs']);
    run('node', ['apps/web/scripts/measure-dist.mjs', '--assert-slim']);
    run('node', ['ops/aliyun/package-release.mjs', 'apps/web/.next', backend.destination,
      '--assets', resources.versionDirectory, '--release-id', expectedCommit, '--target', backend.target]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function backendEnvironment(source) {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USERPROFILE', 'SYSTEMROOT', 'USER', 'LANG', 'LC_ALL',
    'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS',
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    'NEXT_PUBLIC_SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'];
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.includes(key)));
}

function verifyBackendPublicEnvironment(env) {
  const url = URL.parse(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (url?.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Backend build requires a verified HTTPS Supabase URL');
  }
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  const parts = key.split('.');
  if (parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
    try {
      if (JSON.parse(Buffer.from(parts[1], 'base64url')).role === 'anon') return;
    } catch { /* Invalid legacy JWT. */ }
  }
  throw new Error('Backend build requires a Supabase publishable key or legacy anon JWT');
}

export function runChecks({ job, expectedCommit, cwd = process.cwd(), execute = runCommand,
  nodeVersion = process.version, isolatedDocker = false, backend, environment = process.env }) {
  if (!['quality', 'database', 'backend'].includes(job)) throw new Error('Expected Flow job quality, database or backend');
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) throw new Error('EXPECTED_COMMIT must be a full Git SHA');
  const env = { ...(job === 'backend' ? backendEnvironment(environment) : environment),
    CI: 'true', NEXT_TELEMETRY_DISABLED: '1' };
  const run = (program, args, capture = false) => execute(program, args, { cwd, env, capture });
  const checkCheckout = () => {
    if (run('git', ['rev-parse', '--verify', 'HEAD'], true).trim() !== expectedCommit) {
      throw new Error('Flow checkout does not match expected commit');
    }
  };

  checkCheckout();
  if (job === 'database' && !isolatedDocker) throw new Error('Database job requires an isolated Docker daemon');
  if (nodeVersion !== 'v24.19.0' || run('pnpm', ['--version'], true).trim() !== '11.19.0') {
    throw new Error('Expected Node 24.19.0 and pnpm 11.19.0');
  }
  if (job === 'backend') {
    backendPreflight(run, cwd, backend);
    verifyBackendPublicEnvironment(env);
  }
  run('pnpm', ['install', '--frozen-lockfile']);
  if (job === 'database') databaseChecks(run, cwd);
  else if (job === 'backend') buildBackend(run, env, expectedCommit, backend);
  else qualityChecks(run, env, expectedCommit);
  checkCheckout();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runChecks({
      job: process.argv[2], expectedCommit: process.env.EXPECTED_COMMIT,
      isolatedDocker: process.env.ZIMAGE_FLOW_ISOLATED_DOCKER === '1',
      backend: {
        target: process.env.ZIMAGE_FLOW_TARGET_FILE,
        fontSource: process.env.ZIMAGE_FLOW_FONT_SOURCE,
        destination: process.env.ZIMAGE_FLOW_ARTIFACT_DIR,
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
