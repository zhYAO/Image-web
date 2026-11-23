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

async function regular(file, maximum = 5_000_000) {
  const info = await lstat(file);
  require(info.isFile() && !info.isSymbolicLink() && info.size <= maximum, 'Expected regular bounded rehearsal file');
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

export function classifySupabaseStart(result) {
  if (result.error?.code === 'ETIMEDOUT') return 'startup deadline';
  if (result.error) return 'child execution error';
  if (result.signal) return 'child signal';
  const diagnostic = String(result.stderr ?? '') + '\n' + String(result.stdout ?? '');
  if (/address already in use|port is already allocated|failed to bind host port/i.test(diagnostic)) return 'port conflict';
  if (/overlap.*(?:pool|network)|(?:pool|network).*overlap/i.test(diagnostic)) return 'network address overlap';
  if (/failed to pull|pull access denied|manifest unknown|toomanyrequests|failed to resolve reference/i.test(diagnostic)) return 'image retrieval';
  if (/SQLSTATE|failed to apply migration|error applying migration/i.test(diagnostic)) return 'migration rejected';
  if (/is not healthy|unhealthy|health check.*(?:failed|timeout)/i.test(diagnostic)) {
    for (const service of ['kong', 'db', 'auth', 'rest', 'storage', 'mailpit']) {
      const pattern = new RegExp('supabase_' + service + '_[^\\s]*[^\\n]{0,48}(?:not healthy|unhealthy)', 'i');
      if (pattern.test(diagnostic)) return 'unhealthy ' + service;
    }
    return 'service unhealthy';
  }
  return 'unclassified child failure';
}

function command(file, args, cwd, env, timeout, name) {
  const done = spawnSync(file, args, { cwd, env, timeout, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (name === 'Disposable Supabase start and migrations' && (done.error || done.status !== 0))
    throw new Error('Disposable Supabase startup failed: ' + classifySupabaseStart(done));
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
  require(parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || (origin === 'http://172.31.219.2:3100' && route === '/api/health/ready')) && /^\/[a-z0-9/_-]+$/i.test(route)
    && !route.startsWith('//'), 'Only fixed loopback endpoints are allowed');
  return fetch(origin + route, { ...options, signal: AbortSignal.timeout(4000), redirect: 'error' });
}

export function readinessOutcome(response, body, commit) {
  if (response == null) return 'no HTTP response';
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) return 'invalid HTTP response';
  if (response.status !== 200) return 'HTTP ' + response.status;
  if (body?.version !== commit || body?.status !== 'ok') return 'wrong exact response identity';
  return 'exact ready';
}

function dockerState(name, project) {
  const r = spawnSync('/usr/bin/docker', ['inspect', '--format', '{{.State.Status}}', name], {
    cwd: project, env: localEnvironment, timeout: 3000, maxBuffer: 128, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const status = r.stdout?.trim();
  return r.status === 0 && ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(status)
    ? status : 'not observed';
}

async function run(args) {
  const observation = process.env.ZIMAGE_ISOLATED_OBSERVATION_MODE ?? 'diagnostic';
  require(observation === 'diagnostic' || (observation === 'protected-measurement' && args.length === 9),
    'Protected observation requires reconstructed isolated baseline');
  const selected = (args.length === 8 || args.length === 9) && args[3] === '--protected-main-shadow';
  require(process.platform === 'linux' && process.versions.node === '24.19.0' && selected && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN, 'Invalid isolated proof invocation');
  const paths = [...args.slice(0, 3), args[4], args[5], args[6]];
  require(paths.every(item => path.isAbsolute(item)), 'Expected absolute checkout and inspected artifact roots');
  const [project, backend, frontend, fixture, nodeBin, ca] = await Promise.all(paths.map(x => realpath(x)));
  if (selected) {
    require(process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_OS === 'Linux' && process.env.TMPDIR, 'No M7 fixture requires disposable hosted Linux');
    const base = await realpath(process.env.TMPDIR);
    const rel = path.relative(base, fixture);
    require(rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'), 'No M7 fixture is outside private scratch');
  }
  for (const root of [backend, '/opt/zimage/layer-cache']) {
    const mode = (await lstat(root)).mode;
    require((mode & 0o005) === 0o005 && !(mode & 0o022), 'Container mount must be readable and readonly');
  }
  const networkId = args[7];
  require(/^[a-f0-9]{64}$/.test(networkId), 'Expected fixed private bridge identity');
  const inspected = JSON.parse(command('/usr/bin/docker', ['network', 'inspect', networkId], project, localEnvironment, 10_000, 'Private bridge inspection'));
  const n = inspected[0];
  require(inspected.length === 1 && n.Id === networkId && n.Name === 'zimage-staging-internal' && n.Driver === 'bridge'
    && n.Internal === true && n.EnableIPv6 === false && n.Options?.['com.docker.network.bridge.name'] === 'zimg-netproof'
    && n.IPAM?.Config?.length === 1 && n.IPAM.Config[0].Subnet === '172.31.219.0/29' && n.IPAM.Config[0].Gateway === '172.31.219.1'
    && Object.keys(n.Containers).length === 0, 'Expected empty fixed internal bridge');
  require(createHash('sha256').update(await regular(nodeBin, 256 * 1024 * 1024)).digest('hex') === 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12',
    'Wrong pinned Node executable');
  const app = path.join(backend, 'apps/web');
  const commit = (await regular(path.join(app, '.next/BUILD_ID'))).toString().trim();
  const candidate = JSON.parse(await regular(path.join(frontend, '.release/candidate.json')));
  const trustedCommit = process.env.ZIMAGE_TRUSTED_ARCHIVE_COMMIT;
  require(ARCHIVE_ROOT.test(trustedCommit ?? '') && commit === trustedCommit && candidate.sourceIdentity?.sourceSHA === commit && candidate.sourceIdentity?.dirty === false
    && candidate.namespace === 'release-' + commit.slice(0, 12)
    && candidate.allowedBackendReleases?.length === 1 && candidate.allowedBackendReleases[0] === commit, 'Not an exact paired release');
  require((await regular(path.join(frontend, 'app.html'))).includes(Buffer.from('/frontend-assets/' + candidate.namespace + '/')),
    'Exact frontend shell does not bind its expected namespace');
  let baseline;
  const oldSha = '7a811b326aa4b344cee08bc5a33c04e44a780fd4';
  if (args[8]) {
    const root = await realpath(args[8]);
    const base = await realpath(process.env.TMPDIR);
    require(path.isAbsolute(args[8]) && root === path.join(base, 'baseline'), 'Wrong isolated baseline root');
    const [kind, source, digest, ...extra] = (await regular(path.join(root, 'RECONSTRUCTION_ONLY'))).toString().trimEnd().split('\n');
    const frontend = path.join(root, 'web'), app = path.join(root, 'app');
    const desc = JSON.parse((await regular(path.join(frontend, '.release/candidate.json'))).toString());
    require(kind === 'source-reconstructed-nonpromotable' && source === oldSha && !extra.length &&
      /^[a-f0-9]{64}$/.test(digest) && desc.sourceIdentity?.sourceSHA === oldSha && desc.sourceIdentity.dirty === false
      && desc.allowedBackendReleases?.length === 1 && desc.allowedBackendReleases[0] === oldSha
      && new RegExp('^rehearsal-' + oldSha + '-[1-9][0-9]*-[1-9][0-9]*$').test(desc.namespace)
      && (await regular(path.join(app, 'apps/web/.next/BUILD_ID'))).toString().trim() === oldSha
      && (await regular(path.join(frontend, 'app.html'))).includes(Buffer.from('/frontend-assets/' + desc.namespace + '/')),
      'Invalid reconstructed isolated baseline');
    const resources = path.join(root, 'resources', digest);
    require(await realpath(resources) === resources && (await lstat(path.join(resources, 'fonts'))).isDirectory(), 'Missing reconstructed fixture resources');
    baseline = { commit: oldSha, frontend, app, resources, digest, namespace: desc.namespace, port: 3100 };
  }
  require((await lstat('/var/run/docker.sock').catch(() => null))?.isSocket(), 'Local Docker socket unavailable - real authenticated rehearsal blocked');
  const docker = command('docker', ['version', '--format', '{{.Server.Version}}'], project, localEnvironment, 10_000, 'Local Docker runtime');
  require(docker.trim(), 'Local Docker daemon unavailable');
  const id = 'zimage_auth_' + randomBytes(6).toString('hex');
  const scratch = await mkdtemp('/tmp/zimage-auth-rehearsal-');
  const cli = path.join(project, 'node_modules/.bin/supabase');
  const cliEnv = { ...localEnvironment, HOME: scratch, XDG_CONFIG_HOME: scratch, SUPABASE_TELEMETRY_DISABLED: '1' };
  let stackAttempted = false;
  let appProc, failed = false;
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

    const port = 3100, origin = 'http://172.31.219.2:3100';
    const ingressPort = await freePort();
    const ingressOrigin = 'http://127.0.0.1:' + ingressPort;
    const candidateEnv = path.join(scratch, 'candidate.env');
    await writeFile(candidateEnv, [
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' + status.publishable,
      'SUPABASE_SECRET_KEY=' + status.secret,
      'AUTH_RATE_LIMIT_PEPPER=' + randomBytes(32).toString('hex'),
      'ZIMAGE_ALLOWED_ORIGINS=' + ingressOrigin,
    ].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    const start = async (target) => {
      const isOld = target === oldSha;
      require(target === commit || (isOld && baseline), 'Unexpected isolated release choice');
      const selectedApp = isOld ? baseline.app : backend;
      const oldMounts = isOld ? [
        '--mount', 'type=bind,src=' + baseline.resources + ',dst=/legacy-assets,readonly,bind-recursive=disabled',
        '--env', 'ZIMAGE_SHARED_FONT_DIR=/legacy-assets/fonts',
        '--env', 'ZIMAGE_STATIC_ASSET_SHA256=' + baseline.digest,
      ] : [];
      appProc = spawn('/usr/bin/docker', ['run', '--rm', '--pull=never', '--platform=linux/amd64',
        '--name', id, '--network', networkId, '--ip', '172.31.219.2', '--add-host', 'zimage-fixture-gateway:172.31.219.1',
        '--user=65532:65532', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--read-only',
        '--pids-limit', '96', '--memory', '1024m', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
        '--mount', 'type=bind,src=' + selectedApp + ',dst=/candidate,readonly,bind-recursive=disabled',
        '--mount', 'type=bind,src=/opt/zimage/layer-cache,dst=/opt/zimage/layer-cache,readonly,bind-recursive=disabled',
        '--mount', 'type=bind,src=' + nodeBin + ',dst=/node,readonly,bind-recursive=disabled',
        '--mount', 'type=bind,src=' + ca + ',dst=/fixture-ca.pem,readonly,bind-recursive=disabled',
        ...oldMounts, '--env-file', candidateEnv, '--env', 'NODE_EXTRA_CA_CERTS=/fixture-ca.pem',
        '--env', 'NEXT_PUBLIC_SUPABASE_URL=https://zimage-fixture-gateway:8443', '--env', 'NODE_ENV=production',
        '--env', 'NEXT_TELEMETRY_DISABLED=1', '--env', 'HOME=/tmp', '--env', 'HOSTNAME=0.0.0.0', '--env', 'PORT=3100',
        '--workdir', '/candidate/apps/web', 'docker.io/library/ubuntu@sha256:45e9ddc6895604674618a409ca9f73d301da8fdb75fe330e8e9a27b3b219e4ad',
        '/node', 'server.js'], { cwd: project, stdio: 'ignore', env: localEnvironment });
      let launchError = false, outcome = 'no HTTP response';
      appProc.on('error', () => { launchError = true; });
      const deadline = performance.now() + 20_000;
      while (performance.now() < deadline && appProc.exitCode === null && appProc.signalCode === null && !launchError) {
        const response = await request(origin, '/api/health/ready').catch(() => null);
        let body;
        if (response?.status === 200) body = await response.json().catch(() => null);
        outcome = readinessOutcome(response, body, target);
        if (outcome === 'exact ready') break;
        await delay(250);
      }
      if (outcome !== 'exact ready') {
        const child = launchError ? 'launch error' : appProc.signalCode ? 'child signalled' :
          appProc.exitCode === null ? 'child active' : 'child exit ' + appProc.exitCode;
        // Emit only controlled categories, never untrusted body, logs, or env.
        console.error('Candidate readiness diagnostic: ' + dockerState(id, project) + '; ' + child + '; ' + outcome);
        throw new Error('Exact local candidate readiness failed');
      }
    };
    const switchIsolatedBackend = async (target) => {
      require(baseline && (target === oldSha || target === commit), 'Unexpected isolated switch target');
      const prior = appProc;
      command('/usr/bin/docker', ['rm','-f',id], project, localEnvironment, 20_000, 'Stop exact isolated fixture process');
      for (let i = 0; i < 20 && prior.exitCode === null && prior.signalCode === null; i++) await delay(100);
      require(prior.exitCode !== null || prior.signalCode !== null, 'Old fixture process still exists');
      await start(target);
    };
    await start(commit);
    await browserAuth({ project, frontend, scratch, namespace: candidate.namespace, backendPort: port, ingressPort, email, password, userId, commit, shadow: true, isolatedUpstream: true,
      retained: baseline, switchIsolatedBackend });
    verifyLedger();
    const dbEvidence = expectedLedger ? { dbProfile: 'm6-diagnostics-no-m7', migrationCount: 43,
      migrationLedgerSha256: createHash('sha256').update(expectedLedger + '\n').digest('hex') } : {};
    return { commit, ...dbEvidence, scope: observation === 'diagnostic' ? 'isolated-container-browser-only' : 'unattested-protected-browser-observation', browserUiTested: true,
      productionReady: false, credentialMode: 'synthetic', ...(baseline ? { reconstructedIsolatedPairRecovery: true, reconstructedCommit: oldSha } : {}), checks: ['candidate-health', 'browser-home-login-workspace-logout'] };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (appProc) {
      spawnSync('/usr/bin/docker', ['rm', '-f', id], { env: localEnvironment, stdio: 'ignore', timeout: 20_000 });
      if (appProc.exitCode === null) appProc.kill('SIGTERM');
    }
    try {
      if (stackAttempted) command(cli, ['stop', '--no-backup', '--workdir', scratch], project, cliEnv, 120_000, 'Disposable Supabase cleanup');
    } catch (error) {
      if (!failed) throw error;
      console.error('Disposable Supabase cleanup also failed');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run(process.argv.slice(2)))); }
  catch (error) {
    // All explicit harness errors contain a fixed description and HTTP status.
    // Arbitrary SDK, process and filesystem errors can contain credentials.
    const known = error instanceof Error && /^([A-Z][A-Za-z -]+)( \(HTTP [0-9]{3}\)| \(command output suppressed\))?$/.test(error.message);
    const startup = error instanceof Error && /^Disposable Supabase startup failed: (?:startup deadline|child execution error|child signal|port conflict|network address overlap|image retrieval|migration rejected|service unhealthy|unhealthy (?:kong|db|auth|rest|storage|mailpit)|unclassified child failure)$/.test(error.message);
    console.error('Isolated HTTP authentication unverified:', (known || startup) ? error.message : 'unexpected local prerequisite or verifier failure');
    process.exitCode = 1;
  }
}
