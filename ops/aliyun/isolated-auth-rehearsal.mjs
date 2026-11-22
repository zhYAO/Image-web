#!/usr/bin/env node
// Secretless runner: authenticated same-origin HTTP with a disposable Supabase
// stack. The dedicated no-M7 diagnostic also runs a local-only browser check.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { browserAuth } from './isolated-auth-browser.mjs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const CLI_VERSION = '2.115.0';
const LOCAL_API = 'http://127.0.0.1:54321';
const ARCHIVE_ROOT = /^[a-f0-9]{40}$/;
const require = (condition, description) => { if (!condition) throw new Error(description); };
const localEnvironment = { PATH: process.env.PATH, LANG: 'C.UTF-8', NEXT_TELEMETRY_DISABLED: '1',
  DOCKER_HOST: 'unix:///var/run/docker.sock', NO_PROXY: '127.0.0.1,localhost' };

export function localStatus(record) {
  require(record && ['http://127.0.0.1:54321', 'http://localhost:54321'].includes(record.API_URL)
    && /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(record.PUBLISHABLE_KEY ?? '')
    && /^sb_secret_[A-Za-z0-9_-]{16,}$/.test(record.SECRET_KEY ?? ''), 'Local Supabase endpoint or modern CLI key contract invalid');
  // Never pass the URL supplied by the status response to authenticated HTTP.
  return { publishable: record.PUBLISHABLE_KEY, secret: record.SECRET_KEY };
}

export function validateM6Ledger(text) {
  const entries = text.trimEnd().split('\n');
  const versions = entries.map(row => row.split('|')[0]);
  require(entries.length === 43 && new Set(entries).size === 43 && new Set(versions).size === 43
    && entries.every(row => /^\d{14}\|[a-z0-9_]+$/.test(row))
    && entries.join('\n') === [...entries].sort().join('\n')
    && entries.includes('20261106083858|chat_usage_settlement')
    && entries.includes('20261106123202|isolated_provider_diagnostics')
    && !entries.some(row => row.endsWith('|verified_openai_chat_metering')),
    'Invalid disposable M6 migration ledger');
  return entries.join('\n');
}

function disableFixtureSection(text, section) {
  const marker = '[' + section + ']\n';
  const start = text.startsWith(marker) ? 0 : (text.indexOf('\n' + marker) + 1 || -1);
  if (start < 0) return text.trimEnd() + '\n\n[' + section + ']\nenabled = false\n';
  const end = text.indexOf('\n[', start + section.length + 3);
  const before = text.slice(0, start);
  const block = text.slice(start, end < 0 ? undefined : end);
  require(block.match(/^enabled = (?:true|false)$/gm)?.length === 1, 'Unexpected fixture enabled setting');
  return before + block.replace(/^enabled = (?:true|false)$/m, 'enabled = false') + (end < 0 ? '' : text.slice(end));
}

export function disposableConfig(source, projectId, fixtureProfile = false) {
  require(/^zimage_auth_[a-f0-9]{12}$/.test(projectId), 'Invalid disposable project id');
  require(source.match(/^project_id = "[A-Za-z0-9_-]+"$/gm)?.length === 1, 'Expected one local project entry');
  require(/^major_version = 17$/m.test(source) && /^port = 54321$/m.test(source), 'Local database/API target changed');
  // Keep real migrations, Auth, Data API, and private pg_cron prerequisites.
  // No Edge workers or Studio/provider credentials are started.
  const disable = new Set(['edge_runtime', 'studio', 'analytics', 'realtime', 'storage.vector']);
  const lines = source.replace(/^project_id = "[A-Za-z0-9_-]+"$/m, `project_id = "${projectId}"`).split('\n');
  let section = '';
  const output = lines.map(line => {
    const header = line.match(/^\[([a-z_.-]+)\]$/);
    if (header) section = header[1];
    if ((disable.has(section) || section.startsWith('functions.')) && /^enabled = (?:true|false)$/.test(line)) return 'enabled = false';
    return line;
  }).join('\n');
  return fixtureProfile ? disableFixtureSection(disableFixtureSection(output, 'db.seed'), 'auth.captcha') : output;
}

export function storeCookies(jar, headers) {
  for (const field of headers.getSetCookie()) {
    const cookie = field.split(';', 1)[0];
    const i = cookie.indexOf('=');
    if (i <= 0 || !/^sb-[a-zA-Z0-9_.-]+$/.test(cookie.slice(0, i))) continue;
    if (!cookie.slice(i + 1) || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(field)) jar.delete(cookie.slice(0, i));
    else jar.set(cookie.slice(0, i), cookie.slice(i + 1));
  }
}

async function regular(file) {
  const info = await lstat(file);
  require(info.isFile() && !info.isSymbolicLink() && info.size <= 5_000_000, 'Expected regular bounded rehearsal file');
  return readFile(file);
}

async function prepare(project, scratch, id, fixture) {
  const src = path.join(project, 'supabase'), dst = path.join(scratch, 'supabase');
  require((await lstat(src)).isDirectory(), 'Invalid local Supabase source directory');
  await mkdir(dst, { mode: 0o700 });
  const config = await regular(path.join(src, 'config.toml'));
  await writeFile(path.join(dst, 'config.toml'), disposableConfig(config.toString(), id, !!fixture), { mode: 0o600, flag: 'wx' });
  let expectedLedger;
  for (const group of ['migrations', 'templates']) {
    const fixtureMigrations = fixture && group === 'migrations';
    const sourceGroup = fixtureMigrations ? path.join(fixture, 'supabase', group) : path.join(src, group);
    require((await lstat(sourceGroup)).isDirectory(), 'Invalid local Supabase source member directory');
    await mkdir(path.join(dst, group), { mode: 0o700 });
    const files = await readdir(sourceGroup);
    if (fixtureMigrations) {
      expectedLedger = validateM6Ledger((await regular(path.join(fixture, 'expected-migration-ledger.txt'))).toString());
      require(validateM6Ledger(files.sort().map(file => file.replace(/\.sql$/, '').replace('_', '|')).join('\n')) === expectedLedger,
        'Fixture migration inputs differ from expected ledger');
    }
    require(files.length > 0 && files.length <= 100, 'Incomplete migration or template set');
    for (const file of files) {
      require((group === 'migrations' ? /^\d{14}_[A-Za-z0-9_]+\.sql$/ : /^[a-z-]+\.html$/).test(file), 'Unexpected migration/template member');
      await writeFile(path.join(dst, group, file), await regular(path.join(sourceGroup, file)), { mode: 0o600, flag: 'wx' });
    }
  }
  if (!fixture) await writeFile(path.join(dst, 'seed.sql'), await regular(path.join(src, 'seed.sql')), { mode: 0o600, flag: 'wx' });
  return expectedLedger;
}

function command(file, args, cwd, env, timeout, name) {
  const done = spawnSync(file, args, { cwd, env, timeout, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  require(!done.error && done.status === 0, `${name} failed (command output suppressed)`);
  return done.stdout;
}

async function freePort() {
  const listener = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function request(origin, route, options = {}) {
  const parsed = new URL(origin);
  require(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && /^\/[a-z0-9/_-]+$/i.test(route)
    && !route.startsWith('//'), 'Only fixed loopback endpoints are allowed');
  return fetch(origin + route, { ...options, signal: AbortSignal.timeout(4000), redirect: 'error' });
}

async function run(args) {
  const selected = args.length === 5 && args[3] === '--m6-diagnostics-no-m7';
  require(process.platform === 'linux' && process.versions.node === '24.19.0' && (args.length === 3 || selected), 'Invalid isolated proof invocation');
  const paths = selected ? [...args.slice(0, 3), args[4]] : args;
  require(paths.every(item => path.isAbsolute(item)), 'Expected absolute checkout and inspected artifact roots');
  const [project, backend, frontend, fixture] = await Promise.all(paths.map(x => realpath(x)));
  if (selected) {
    require(process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_OS === 'Linux' && process.env.TMPDIR, 'No M7 fixture requires disposable hosted Linux');
    const base = await realpath(process.env.TMPDIR);
    const rel = path.relative(base, fixture);
    require(rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'), 'No M7 fixture is outside private scratch');
  }
  const app = path.join(backend, 'apps/web');
  const commit = (await regular(path.join(app, '.next/BUILD_ID'))).toString().trim();
  const candidate = JSON.parse(await regular(path.join(frontend, '.release/candidate.json')));
  require(ARCHIVE_ROOT.test(commit) && candidate.sourceIdentity?.sourceSHA === commit && candidate.sourceIdentity?.dirty === false
    && new RegExp('^rehearsal-' + commit + '-[1-9][0-9]*-[1-9][0-9]*$').test(candidate.namespace)
    && candidate.allowedBackendReleases?.length === 1 && candidate.allowedBackendReleases[0] === commit, 'Not an exact paired release');
  require((await regular(path.join(frontend, 'app.html'))).includes(Buffer.from('/frontend-assets/' + candidate.namespace + '/')),
    'Exact frontend shell does not bind its expected namespace');
  require((await lstat('/var/run/docker.sock').catch(() => null))?.isSocket(), 'Local Docker socket unavailable - real authenticated rehearsal blocked');
  const docker = command('docker', ['version', '--format', '{{.Server.Version}}'], project, localEnvironment, 10_000, 'Local Docker runtime');
  require(docker.trim(), 'Local Docker daemon unavailable');
  const id = 'zimage_auth_' + randomBytes(6).toString('hex');
  const scratch = await mkdtemp('/tmp/zimage-auth-rehearsal-');
  const cli = path.join(project, 'node_modules/.bin/supabase');
  const cliEnv = { ...localEnvironment, HOME: scratch, XDG_CONFIG_HOME: scratch, SUPABASE_TELEMETRY_DISABLED: '1' };
  let stackAttempted = false;
  let appProc, retainedProc;
  try {
    require(command(cli, ['--version'], project, cliEnv, 10000, 'Pinned Supabase CLI').trim() === CLI_VERSION, 'Supabase CLI differs from pinned workspace version');
    const expectedLedger = await prepare(project, scratch, id, fixture);
    stackAttempted = true;
    command(cli, ['start', '--workdir', scratch], project, cliEnv, 12 * 60_000, 'Disposable Supabase start and migrations');
    const verifyLedger = () => {
      if (!expectedLedger) return;
      const sql = 'select version || chr(124) || name from supabase_migrations.schema_migrations order by version;';
      const actual = command('docker', ['exec', 'supabase_db_' + id, 'psql', '-X', '-U', 'postgres',
        '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], project, localEnvironment, 30_000, 'Disposable migration ledger verification');
      require(validateM6Ledger(actual) === expectedLedger, 'Disposable migration ledger mismatch');
    };
    verifyLedger();
    const status = localStatus(JSON.parse(command(cli, ['status', '--output', 'json', '--workdir', scratch], project, cliEnv, 30_000, 'Local Supabase status')));
    const email = id + '@example.test', password = randomBytes(24).toString('base64url') + 'aA1!';
    const user = await request(LOCAL_API, '/auth/v1/admin/users', {
      method: 'POST', headers: { apikey: status.secret, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    require(user.ok, 'Synthetic local Auth user creation failed');
    const userId = (await user.json()).id;
    require(typeof userId === 'string' && /^[a-f0-9-]{36}$/.test(userId), 'Synthetic user identity missing');

    const port = await freePort(), origin = 'http://127.0.0.1:' + port;
    const ingressPort = selected ? await freePort() : null;
    require(ingressPort !== port, 'Disposable ingress collided with backend');
    const allowedOrigins = selected ? origin + ',http://127.0.0.1:' + ingressPort : origin;
    appProc = spawn(process.execPath, ['server.js'], { cwd: app, stdio: 'ignore', env: {
      LANG: 'C.UTF-8', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: '127.0.0.1', PORT: String(port),
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_API, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishable,
      SUPABASE_SECRET_KEY: status.secret, AUTH_RATE_LIMIT_PEPPER: randomBytes(32).toString('hex'),
      ZIMAGE_ALLOWED_ORIGINS: allowedOrigins, NODE_USE_ENV_PROXY: '1', NO_PROXY: '127.0.0.1,localhost',
      HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
    } });
    let readiness;
    for (let attempt = 0; attempt < 40; attempt++) {
      require(appProc.exitCode === null, 'Exact candidate process exited');
      readiness = await request(origin, '/api/health/ready').catch(() => null);
      if (readiness?.ok) break;
      await delay(250);
    }
    require(readiness?.ok && (await readiness.json()).version === commit, 'Exact local candidate readiness failed');
    const unauth = await request(origin, '/api/auth/session');
    require(unauth.status === 401, `Anonymous session must be rejected (HTTP ${unauth.status})`);
    const headers = { 'content-type': 'application/json', origin, 'x-real-ip': '127.0.0.1' };
    const bad = await request(origin, '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ email, password: 'Wrong-password-32!' }) });
    require(bad.status === 401, `Wrong password must be rejected (HTTP ${bad.status})`);
    const login = await request(origin, '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ email, password }) });
    require(login.ok && (await login.json()).authenticated === true, `Local password login failed (HTTP ${login.status})`);
    const jar = new Map();
    storeCookies(jar, login.headers);
    require(jar.size > 0, 'No application auth cookie');
    const cookie = () => [...jar].map(([key, value]) => key + '=' + value).join('; ');
    const auth = await request(origin, '/api/auth/session', { headers: { cookie: cookie() } });
    require(auth.ok && (await auth.json()).id === userId, `Local live authenticated RPC failed (HTTP ${auth.status})`);
    storeCookies(jar, auth.headers);
    const logout = await request(origin, '/api/auth/logout', { method: 'POST', headers: { ...headers, cookie: cookie() }, body: '{}' });
    require(logout.ok && (await logout.json()).signedOut === true, `Local sign-out failed (HTTP ${logout.status})`);
    storeCookies(jar, logout.headers);
    const signedOut = await request(origin, '/api/auth/session', { headers: { cookie: cookie() } });
    require(signedOut.status === 401, 'Logged-out replay cookie jar must not authorize');
    let retained;
    if (selected && process.env.ZIMAGE_RECONSTRUCTED_PAIR) {
      const base = await realpath(process.env.TMPDIR);
      const reconstructed = await realpath(process.env.ZIMAGE_RECONSTRUCTED_PAIR);
      require(reconstructed.startsWith(base + '/'), 'Reconstructed artifact is outside scratch');
      const commit = '7a811b326aa4b344cee08bc5a33c04e44a780fd4';
      const frontend = path.join(reconstructed, 'web');
      const oldApp = path.join(reconstructed, 'app/apps/web');
      const marker = (await regular(path.join(reconstructed, 'RECONSTRUCTION_ONLY'))).toString().trim().split('\n');
      const old = JSON.parse((await regular(path.join(frontend, '.release/candidate.json'))).toString());
      const digest = marker[2];
      require(marker.length === 3 && marker[0] === 'source-reconstructed-nonpromotable' && marker[1] === commit
        && /^[a-f0-9]{64}$/.test(digest) && (await regular(path.join(oldApp, '.next/BUILD_ID'))).toString().trim() === commit
        && old.sourceIdentity?.sourceSHA === commit && old.sourceIdentity?.dirty === false
        && old.allowedBackendReleases?.length === 1 && old.allowedBackendReleases[0] === commit
        && /^rehearsal-7a811b326aa4b344cee08bc5a33c04e44a780fd4-[0-9]+-[0-9]+$/.test(old.namespace),
        'Invalid nonpromotable reconstructed pair');
      const oldPort = await freePort();
      require(oldPort !== ingressPort && oldPort !== port, 'Reconstructed port collision');
      retainedProc = spawn(process.execPath, ['server.js'], { cwd: oldApp, stdio: 'ignore', env: {
        LANG: 'C.UTF-8', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
        HOSTNAME: '127.0.0.1', PORT: String(oldPort),
        NEXT_PUBLIC_SUPABASE_URL: LOCAL_API, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishable,
        SUPABASE_SECRET_KEY: status.secret, AUTH_RATE_LIMIT_PEPPER: randomBytes(32).toString('hex'),
        ZIMAGE_ALLOWED_ORIGINS: allowedOrigins, NODE_USE_ENV_PROXY: '1', NO_PROXY: '127.0.0.1,localhost',
        HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
        ZIMAGE_SHARED_FONT_DIR: path.join(reconstructed, 'resources', digest, 'fonts'),
        ZIMAGE_STATIC_ASSET_SHA256: digest,
      } });
      let ready;
      for (let i = 0; i < 40; i++) {
        require(retainedProc.exitCode === null, 'Reconstructed candidate process exited');
        ready = await request('http://127.0.0.1:' + oldPort, '/api/health/ready').catch(() => null);
        if (ready?.ok) break;
        await delay(250);
      }
      require(ready?.ok && (await ready.json()).version === commit, 'Reconstructed candidate readiness failed');
      retained = { commit, frontend, port: oldPort, namespace: old.namespace };
    }
    if (selected) await browserAuth({ project, frontend, scratch, namespace: candidate.namespace, backendPort: port, ingressPort, email, password, userId, commit, retained });
    verifyLedger();
    const dbEvidence = expectedLedger ? { dbProfile: 'm6-diagnostics-no-m7', migrationCount: 43,
      migrationLedgerSha256: createHash('sha256').update(expectedLedger + '\n').digest('hex') } : {};
    return { commit, ...dbEvidence, scope: selected ? 'loopback-nginx-browser-and-http' : 'loopback-http-only', browserUiTested: selected, productionReady: false,
      credentialMode: 'synthetic', ...(retained ? { reconstructedBrowserRecovery: true, reconstructedCommit: retained.commit } : {}), checks: ['frontend-shell', 'candidate-health', 'anonymous-session-denied', 'wrong-password-denied', 'password-login', 'live-session-rpc', 'logout', ...(selected ? ['browser-home-login-workspace-logout'] : [])] };
  } finally {
    if (retainedProc && retainedProc.exitCode === null) retainedProc.kill('SIGTERM');
    if (appProc && appProc.exitCode === null) appProc.kill('SIGTERM');
    try {
      if (stackAttempted) command(cli, ['stop', '--no-backup', '--workdir', scratch], project, cliEnv, 120_000, 'Disposable Supabase cleanup');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run(process.argv.slice(2)))); }
  catch (error) {
    // All explicit harness errors contain a fixed description and HTTP status.
    // Arbitrary SDK, process and filesystem errors can contain credentials.
    const known = error instanceof Error && /^([A-Z][A-Za-z -]+)( \(HTTP [0-9]{3}\)| \(command output suppressed\))?$/.test(error.message);
    console.error('Isolated HTTP authentication unverified:', known ? error.message : 'unexpected local prerequisite or verifier failure');
    process.exitCode = 1;
  }
}
