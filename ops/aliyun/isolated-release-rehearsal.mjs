#!/usr/bin/env node
// Hosted branch-only publication rehearsal with two separately verified commits.
// There are no production controllers, approval records or external HTTP requests.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, symlink } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const branch = 'refs/heads/codex/zimage-github-actions-review-20261120';
const repo = 'zhYAO/Image-web';
const baselineSha = '532d953cdd8fb4cc2446b83de77f435e13041315';
let phase = 'runner-provenance';
function requireCheck(value, message) {
  if (!value) throw new Error(message);
}
async function port(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'exit');
  child.kill('SIGTERM');
  if (!(await Promise.race([closed.then(() => true), delay(1500, false)]))) {
    child.kill('SIGKILL');
    await closed;
  }
}
const request = (url, options) => fetch(url, {
  ...options, redirect: 'error', signal: AbortSignal.timeout(3000),
});
async function run() {
  const e = process.env, sha = e.GITHUB_SHA;
  requireCheck(process.platform === 'linux' && process.versions.node === '24.19.0' && process.argv.length === 6
    && e.RUNNER_ENVIRONMENT === 'github-hosted' && e.RUNNER_OS === 'Linux' && e.GITHUB_REPOSITORY === repo
    && e.GITHUB_EVENT_NAME === 'push' && e.GITHUB_REF === branch
    && e.GITHUB_WORKFLOW_REF === repo + '/.github/workflows/review-branch-diagnostic.yml@' + branch
    && /^[a-f0-9]{40}$/.test(sha ?? ''), 'Hosted exact review-branch context required');
  phase = 'canonical-input-paths';
  const temp = await realpath(e.TMPDIR);
  requireCheck(baselineSha !== sha, 'Distinct protected rehearsal commits required');
  async function inspect(backendPath, frontendPath, version) {
    phase = 'canonical-input-paths';
    const [backend, frontend] = await Promise.all([backendPath, frontendPath].map(item => realpath(item)));
    requireCheck(backend.startsWith(temp + '/') && frontend !== backend, 'Expected inspected backend under the private temporary directory');
    phase = 'exact-input-identities';
    const namespace = 'rehearsal-' + version + '-' + e.GITHUB_RUN_ID + '-' + e.GITHUB_RUN_ATTEMPT;
    const meta = JSON.parse(await readFile(path.join(frontend, '.release/candidate.json'), 'utf8'));
    requireCheck(meta.namespace === namespace && meta.sourceIdentity?.sourceSHA === version
      && meta.sourceIdentity?.dirty === false && meta.allowedBackendReleases?.length === 1
      && meta.allowedBackendReleases[0] === version, 'Frontend identity is not the exact candidate');
    requireCheck((await readFile(path.join(backend, 'apps/web/.next/BUILD_ID'), 'utf8')).trim() === version,
      'Backend identity is not the exact candidate');
    return { backend, frontend, version, namespace };
  }
  const retained = await inspect(process.argv[2], process.argv[3], baselineSha);
  const candidate = await inspect(process.argv[4], process.argv[5], sha);
  requireCheck(retained.backend !== candidate.backend && retained.frontend !== candidate.frontend,
    'Baseline and candidate outputs must be independent');
  const root = await mkdtemp(path.join(temp, 'local-release.'));
  const slots = new Map();
  let listener;
  let sealed = true;
  async function install(slot, pair) {
    phase = 'install-' + slot;
    const destination = path.join(root, slot);
    await mkdir(destination);
    await cp(pair.backend, path.join(destination, 'backend'), { recursive: true, verbatimSymlinks: true });
    await cp(pair.frontend, path.join(destination, 'frontend'), { recursive: true, verbatimSymlinks: true });
    const reserved = net.createServer();
    const endpoint = await port(reserved);
    await new Promise(resolve => reserved.close(resolve));
    const app = path.join(destination, 'backend/apps/web');
    const child = spawn(process.execPath, ['server.js'], { cwd: app, stdio: 'ignore', env: {
      LANG: 'C.UTF-8', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: '127.0.0.1', PORT: String(endpoint), ZIMAGE_BUILD_SHA: pair.version,
      NEXT_PUBLIC_DATA_MODE: 'http', NEXT_PUBLIC_PHASE2_AUTH: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rehearsal_only',
      ZIMAGE_ALLOWED_ORIGINS: 'http://127.0.0.1:' + endpoint,
      NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost',
    } });
    child.on('error', () => {});
    const record = { child, origin: 'http://127.0.0.1:' + endpoint, destination, pair, writes: 0 };
    slots.set(slot, record);
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      const check = await request(record.origin + '/api/health/ready').catch(() => null);
      if (check?.ok && (await check.json()).version === pair.version) return;
      await delay(200);
    }
    throw new Error('Installed standalone candidate did not become ready');
  }

  async function select(slot) {
    phase = 'select-' + slot;
    requireCheck(sealed && slots.has(slot), 'Pair selection requires a sealed known slot');
    const next = path.join(root, 'current.next');
    await symlink(slot, next);
    await rename(next, path.join(root, 'current'));
    requireCheck((await lstat(path.join(root, 'current'))).isSymbolicLink()
      && await readlink(path.join(root, 'current')) === slot, 'Selected pair pointer differs');
  }

  try {
    listener = http.createServer(async (req, res) => {
      try {
        const slot = await readlink(path.join(root, 'current'));
        const selected = slots.get(slot);
        requireCheck(selected, 'Unknown local pair');
        res.setHeader('x-fixture-slot', slot);
        if (req.method === 'POST' && req.url === '/fixture-write') {
          res.statusCode = sealed ? 503 : 204;
          if (!sealed) selected.writes++;
          res.end();
        } else if (req.method === 'GET' && req.url === '/api/health/ready') {
          const ready = await request(selected.origin + req.url);
          res.statusCode = ready.status;
          res.end(await ready.text());
        } else if (req.method === 'GET' && req.url === '/app.html') {
          res.end(await readFile(path.join(selected.destination, 'frontend/app.html')));
        } else {
          res.statusCode = 404; res.end();
        }
      } catch { res.statusCode = 503; res.end(); }
    });
    const origin = 'http://127.0.0.1:' + await port(listener);
    const write = () => request(origin + '/fixture-write', { method: 'POST' });
    async function verify(slot) {
      const { version, namespace } = slots.get(slot).pair;
      const ready = await request(origin + '/api/health/ready');
      requireCheck(ready.ok && ready.headers.get('x-fixture-slot') === slot && (await ready.json()).version === version,
        'Selected backend failed health');
      const front = await request(origin + '/app.html');
      requireCheck(front.ok && front.headers.get('x-fixture-slot') === slot
        && (await front.text()).includes('/frontend-assets/' + namespace + '/'), 'Selected frontend differs');
    }
    await install('baseline', retained);
    await select('baseline');
    await verify('baseline');
    sealed = false;
    requireCheck((await write()).status === 204, 'Baseline write gate did not open');
    const oldPid = slots.get('baseline').child.pid;

    await install('candidate', candidate);
    requireCheck(oldPid !== slots.get('candidate').child.pid, 'Process identities must differ');
    sealed = true;
    requireCheck((await write()).status === 503, 'Publish transition did not seal writes');
    await select('candidate');
    await verify('candidate');
    await stop(slots.get('candidate').child);
    phase = 'observe-injected-failure';
    const failed = await request(origin + '/api/health/ready');
    requireCheck(failed.status === 503 && failed.headers.get('x-fixture-slot') === 'candidate'
      && (await write()).status === 503, 'Injected post-switch failure was not observed with writes sealed');
    await select('baseline');
    await verify('baseline');
    sealed = false;
    requireCheck((await write()).status === 204 && slots.get('baseline').child.pid === oldPid
      && slots.get('baseline').writes === 2 && slots.get('candidate').writes === 0,
      'Rollback did not restore the same healthy baseline process and write gate');

    // Fresh diagnostic install, not a replay of the failed operation or a
    // weaker production rule. Never open writes on the failed process.
    await install('clean-candidate', candidate);
    sealed = true;
    requireCheck((await write()).status === 503, 'Fresh publish transition did not seal writes');
    await select('clean-candidate');
    await verify('clean-candidate');
    sealed = false;
    requireCheck((await write()).status === 204 && slots.get('clean-candidate').writes === 1,
      'Fresh candidate write gate did not open');
    return { baseline: baselineSha, commit: sha, scope: 'disposable-loopback-pair', productionReady: false,
      checks: ['distinct-verified-builds', 'baseline-ready', 'sealed-candidate-switch', 'candidate-ready',
        'post-switch-http-503', 'exact-prior-commit-and-process-restored', 'baseline-writes-reopened',
        'fresh-candidate-ready-and-open'] };
  } finally {
    if (listener?.listening) await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });
    try { await Promise.all([...slots.values()].map(record => stop(record.child))); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
}
try { console.log(JSON.stringify(await run())); }
catch (error) {
  const controlled = error instanceof Error && /^[A-Za-z -]+$/.test(error.message);
  const code = error instanceof Error && /^[A-Z0-9_]{1,40}$/.test(error.code ?? '') ? error.code : 'NO_CODE';
  console.error('Local publication rehearsal failed at ' + phase + ' [' + code + ']: '
    + (controlled ? error.message : 'unexpected local prerequisite or verifier failure'));
  process.exitCode = 1;
}
