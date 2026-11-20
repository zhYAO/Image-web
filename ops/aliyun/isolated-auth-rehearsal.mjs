#!/usr/bin/env node
// Secretless runner: authenticated same-origin HTTP with a disposable Supabase
// stack. This is neither a browser test nor a production acceptance receipt.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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

export function disposableConfig(source, projectId) {
  require(/^zimage_auth_[a-f0-9]{12}$/.test(projectId), 'Invalid disposable project id');
  require(source.match(/^project_id = "[A-Za-z0-9_-]+"$/gm)?.length === 1, 'Expected one local project entry');
  require(/^major_version = 17$/m.test(source) && /^port = 54321$/m.test(source), 'Local database/API target changed');
  // Keep real migrations, Auth, Data API, and private pg_cron prerequisites.
  // No Edge workers or Studio/provider credentials are started.
  const disable = new Set(['edge_runtime', 'studio', 'analytics', 'realtime', 'storage.vector']);
  const lines = source.replace(/^project_id = "[A-Za-z0-9_-]+"$/m, `project_id = "${projectId}"`).split('\n');
  let section = '';
  return lines.map(line => {
    const header = line.match(/^\[([a-z_.-]+)\]$/);
    if (header) section = header[1];
    if ((disable.has(section) || section.startsWith('functions.')) && /^enabled = (?:true|false)$/.test(line)) return 'enabled = false';
    return line;
  }).join('\n');
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

async function prepare(project, scratch, id) {
  const src = path.join(project, 'supabase'), dst = path.join(scratch, 'supabase');
  require((await lstat(src)).isDirectory(), 'Invalid local Supabase source directory');
  await mkdir(dst, { mode: 0o700 });
  const config = await regular(path.join(src, 'config.toml'));
  await writeFile(path.join(dst, 'config.toml'), disposableConfig(config.toString(), id), { mode: 0o600, flag: 'wx' });
  for (const group of ['migrations', 'templates']) {
    require((await lstat(path.join(src, group))).isDirectory(), 'Invalid local Supabase source member directory');
    await mkdir(path.join(dst, group), { mode: 0o700 });
    const files = await readdir(path.join(src, group));
    require(files.length > 0 && files.length <= 100, 'Incomplete migration or template set');
    for (const file of files) {
      require((group === 'migrations' ? /^\d{14}_[A-Za-z0-9_]+\.sql$/ : /^[a-z-]+\.html$/).test(file), 'Unexpected migration/template member');
      await writeFile(path.join(dst, group, file), await regular(path.join(src, group, file)), { mode: 0o600, flag: 'wx' });
    }
  }
  await writeFile(path.join(dst, 'seed.sql'), await regular(path.join(src, 'seed.sql')), { mode: 0o600, flag: 'wx' });
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
  require(process.platform === 'linux' && process.versions.node === '24.19.0' && args.length === 3, 'Requires pinned Linux Node and three absolute inspected input paths');
  require(args.every(item => path.isAbsolute(item)), 'Expected absolute checkout and inspected artifact roots');
  const [project, backend, frontend] = await Promise.all(args.map(x => realpath(x)));
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
  let appProc;
  try {
    require(command(cli, ['--version'], project, cliEnv, 10000, 'Pinned Supabase CLI').trim() === CLI_VERSION, 'Supabase CLI differs from pinned workspace version');
    await prepare(project, scratch, id);
    stackAttempted = true;
    command(cli, ['start', '--workdir', scratch], project, cliEnv, 12 * 60_000, 'Disposable Supabase start and migrations');
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
    appProc = spawn(process.execPath, ['server.js'], { cwd: app, stdio: 'ignore', env: {
      LANG: 'C.UTF-8', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: '127.0.0.1', PORT: String(port),
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_API, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishable,
      SUPABASE_SECRET_KEY: status.secret, AUTH_RATE_LIMIT_PEPPER: randomBytes(32).toString('hex'),
      ZIMAGE_ALLOWED_ORIGINS: origin, NODE_USE_ENV_PROXY: '1', NO_PROXY: '127.0.0.1,localhost',
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
    return { commit, scope: 'loopback-http-only', browserUiTested: false, productionReady: false,
      credentialMode: 'synthetic', checks: ['frontend-shell', 'candidate-health', 'anonymous-session-denied', 'wrong-password-denied', 'password-login', 'live-session-rpc', 'logout'] };
  } finally {
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
