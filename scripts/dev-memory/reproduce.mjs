import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const GiB = 1024 ** 3;
export function parseArgs(args) {
  const options = { bundler: 'webpack', element: 'static', cycles: 3, output: undefined, assertCollected: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--assert-collected') { options.assertCollected = true; continue; }
    if (!['--bundler', '--element', '--cycles', '--output'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${flag}`);
    options[flag.slice(2)] = args[++i];
  }
  if (!['webpack', 'turbopack'].includes(options.bundler) || !['static', 'render'].includes(options.element) || !/^[1-4]$/.test(String(options.cycles))) throw new Error('Use --bundler webpack|turbopack --element static|render --cycles 1..4');
  if (!options.output || !isAbsolute(options.output)) throw new Error('--output must be an absolute directory outside the repository');
  options.cycles = Number(options.cycles);
  return options;
}
async function canonical(path) {
  try { return await realpath(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return join(await canonical(dirname(path)), basename(path)); }
}
export async function validateOutput(output, repository = repo) {
  if (!isAbsolute(output)) throw new Error('Output must be absolute');
  const path = await canonical(resolve(output));
  const rel = relative(await canonical(repository), path);
  if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw new Error('Output must be outside the repository');
  return path;
}
function processes() {
  return readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
    try {
      const fields = readFileSync(`/proc/${name}/stat`, 'utf8').split(/\) /).at(-1).split(' ');
      if (fields[0] === 'Z') return [];
      const cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ');
      const rss = Number(readFileSync(`/proc/${name}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
      return [{ pid: Number(name), group: Number(fields[2]), ticks: Number(fields[11]) + Number(fields[12]), rss, cmd }];
    } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return []; throw error; }
  });
}
export function assertNoNextServer() {
  const active = processes().filter(p => /\bnext-server\b|next\/dist\/bin\/next\s+dev\b/.test(p.cmd));
  if (active.length) throw new Error(`Existing Next process(es): ${active.map(p => p.pid).join(', ')}. Stop the owned development server before reproducing.`);
}
function killGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
export async function supervise(command, args, options, work, limits = {}) {
  limits.checkBudget?.();
  const controller = new AbortController();
  const child = spawn(command, args, { ...options, detached: true });
  const abort = reason => controller.abort(reason);
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => abort(new Error(`Received ${signal}`))]);
  for (const [signal, handler] of signals) process.on(signal, handler);
  child.once('error', abort);
  child.once('exit', (code, signal) => abort(new Error(`Next process exited: ${code ?? signal}`)));
  const timeout = setTimeout(() => abort(new Error('Experiment total timeout')), limits.timeoutMs ?? 600_000);
  const watchdog = setInterval(() => { try { limits.checkBudget?.(child.pid); } catch (error) { abort(error); } }, limits.intervalMs ?? 1000);
  const stopped = new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
    killGroup(child.pid, 'SIGTERM'); reject(controller.signal.reason);
  }, { once: true }));
  try { return await Promise.race([work(child, controller.signal), stopped]); }
  finally {
    clearTimeout(timeout); clearInterval(watchdog);
    controller.abort(new Error('Experiment finished'));
    killGroup(child.pid, 'SIGTERM');
    await delay(limits.killGraceMs ?? 1500);
    killGroup(child.pid, 'SIGKILL');
    for (const [signal, handler] of signals) process.removeListener(signal, handler);
  }
}
function cgroupMemory() {
  const membership = readFileSync('/proc/self/cgroup', 'utf8');
  const v2 = membership.match(/^0::(.*)$/m)?.[1];
  const v1 = membership.match(/^\d+:[^:\n]*\bmemory\b[^:\n]*:(.*)$/m)?.[1];
  const base = v2 !== undefined ? '/sys/fs/cgroup' : '/sys/fs/cgroup/memory';
  if (v2 === undefined && v1 === undefined) return null;
  for (const directory of new Set([join(base, v2 ?? v1), base])) {
    try {
      const used = Number(readFileSync(join(directory, v2 !== undefined ? 'memory.current' : 'memory.usage_in_bytes'), 'utf8'));
      const max = Number(readFileSync(join(directory, v2 !== undefined ? 'memory.max' : 'memory.limit_in_bytes'), 'utf8'));
      return { used, budget: Math.min(8 * GiB, Number.isFinite(max) ? max * 0.8 : Infinity) };
    } catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error; }
  }
  return null;
}
async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const port = server.address().port;
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  return port;
}
async function until(check, deadline, signal) {
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const value = await check();
    if (value) return value;
    await delay(250, undefined, { signal });
  }
  throw new Error('Experiment phase exceeded its timeout');
}
async function jsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
export async function readVersionResponse(response, version) {
  const body = await response.text();
  return response.ok && body.includes(`<p>memory-version-${version}</p>`);
}
async function fixture(output, element, bundler) {
  const root = join(output, 'fixture');
  let turboRoot = root;
  if (bundler === 'turbopack') {
    while (relative(turboRoot, repo).startsWith('..')) turboRoot = dirname(turboRoot);
    if (turboRoot === '/') throw new Error('Turbopack symlink resolution would require filesystem root. Use --output beside the repository under a shared directory (for example /workspace/memory-evidence).');
  }
  await mkdir(join(root, 'app'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'vendor-fixture'), { recursive: true });
  for (const name of ['next', 'react', 'react-dom']) await symlink(await realpath(join(repo, 'apps/web/node_modules', name)), join(root, 'node_modules', name));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'next-memory-reproduction', private: true }));
  await writeFile(join(root, 'next.config.mjs'), `export default {devIndicators:false,experimental:{turbopackFileSystemCacheForDev:false},turbopack:{root:${JSON.stringify(turboRoot)}}};\n`);
  await writeFile(join(root, 'app/layout.jsx'), 'export default function Layout({children}) { return <html><body>{children}</body></html>; }\n');
  await writeFile(join(root, 'app/client.jsx'), '"use client";\nimport Vendor from "vendor-fixture";\nexport default function Client(){return <Vendor/>;}\n');
  await writeFile(join(root, 'node_modules/vendor-fixture/package.json'), JSON.stringify({ name: 'vendor-fixture', version: '1.0.0', type: 'module', main: 'index.js' }));
  const icon = "createElement('span',null,'Static icon')";
  await writeFile(join(root, 'node_modules/vendor-fixture/index.js'), `import {createElement} from 'react';\n${element === 'static' ? `const icon=${icon};\nexport default function Vendor(){return icon;}` : `export default function Vendor(){return ${icon};}`}\n`);
  await copyFile(new URL('./probe.cjs', import.meta.url), join(output, 'probe.cjs'));
  return root;
}
export async function main(args = process.argv.slice(2)) {
  const started = Date.now();
  if (process.platform !== 'linux') throw new Error('This controlled runner requires Linux /proc');
  const options = parseArgs(args);
  const output = await validateOutput(options.output);
  assertNoNextServer();
  await mkdir(output, { mode: 0o700 }); // Exclusive creation preserves previous evidence.
  const root = await fixture(output, options.element, options.bundler);
  const port = await freePort();
  const log = await open(join(output, 'server.log'), 'wx', 0o600);
  const records = [];
  const metrics = { node: process.version, options: { ...options, output }, port, records, status: 'running' };
  const save = () => writeFile(join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  const page = version => writeFile(join(root, 'app/page.jsx'), `import {connection} from 'next/server';\nimport Client from './client';\nexport default async function Page(){await connection();return <><p>memory-version-${version}</p><Client/></>;}\n`);
  await page(0);
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { NODE_OPTIONS: '', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', NEXT_DISABLE_MEM_OVERRIDE: '1', ZIMAGE_MEMORY_OUTPUT: output });
  try {
    assertNoNextServer();
    await supervise(process.execPath, ['--expose-gc', '--max-old-space-size=2048', '--require', join(output, 'probe.cjs'), join(root, 'node_modules/next/dist/bin/next'), 'dev', `--${options.bundler}`, '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: ['ignore', log.fd, log.fd] }, async (child, signal) => {
      const handshakeFile = join(output, `worker-${child.pid}.json`);
      const worker = await until(() => jsonFile(handshakeFile), Date.now() + 60_000, signal);
      if (!Number.isSafeInteger(worker.pid) || worker.parent !== child.pid || !worker.gc) throw new Error('Invalid worker handshake or GC unavailable');
      metrics.workerPid = worker.pid;
      async function sample(stage, version) {
        const deadline = Date.now() + 120_000;
        const phaseSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
        if (version !== undefined) {
          await page(version);
          await until(async () => {
            try {
              const response = await fetch(`http://127.0.0.1:${port}/`, { signal: phaseSignal });
              return await readVersionResponse(response, version);
            } catch (error) { if (phaseSignal.aborted || Date.now() >= deadline) throw error; return false; }
          }, deadline, phaseSignal);
        }
        const coolStart = Date.now(); let quietSince = coolStart;
        let previous = processes().filter(p => p.group === child.pid).reduce((n, p) => n + p.ticks, 0);
        await until(async () => {
          await delay(2000, undefined, { signal: phaseSignal });
          const current = processes().filter(p => p.group === child.pid).reduce((n, p) => n + p.ticks, 0);
          if (current - previous > 5 || current < previous) quietSince = Date.now();
          previous = current;
          return Date.now() - coolStart >= 30_000 && Date.now() - quietSince >= 10_000;
        }, deadline, phaseSignal);
        if ((await jsonFile(handshakeFile))?.pid !== worker.pid || !processes().some(p => p.pid === worker.pid && p.group === child.pid)) throw new Error('Worker disappeared or restarted');
        const previousSample = await jsonFile(join(output, `sample-${worker.pid}.json`));
        process.kill(worker.pid, 'SIGUSR2');
        const value = await until(async () => { const s = await jsonFile(join(output, `sample-${worker.pid}.json`)); return s?.sequence > (previousSample?.sequence ?? 0) && s; }, Math.min(deadline, Date.now() + 15_000), phaseSignal);
        records.push({ stage, time: new Date().toISOString(), cooldownMs: Date.now() - coolStart, ...value, cgroup: cgroupMemory() });
        await save(); console.log(JSON.stringify(records.at(-1)));
      }
      await sample('warm', 0);
      for (let version = 1; version <= options.cycles; version++) await sample(`hmr-${version}`, version);
      await sample('extra-gc-1'); await sample('extra-gc-2');
      const final = records.at(-1);
      metrics.status = final.totalVmGenerations === 0 ? 'untracked' : final.liveVmGenerations.length <= 1 ? 'collected' : 'retained';
      if (options.assertCollected && metrics.status !== 'collected') throw new Error(metrics.status === 'untracked' ? 'Unsupported assertion: this bundler emitted no VM manifest generations tracked by the probe' : 'Old manifest VM generations remain after final GC');
    }, { timeoutMs: Math.max(1, 600_000 - (Date.now() - started)), checkBudget: group => {
      if (processes().some(p => p.group === group && p.rss >= 3 * GiB)) throw new Error('A server process exceeded the 3 GiB RSS budget');
      const cgroup = cgroupMemory();
      if (cgroup && cgroup.used >= cgroup.budget) throw new Error('Cgroup memory budget exceeded');
    } });
  } catch (error) { metrics.error = error.message; if (metrics.status === 'running') metrics.status = 'aborted'; throw error; }
  finally { await log.close(); await save(); }
  console.log(`Result: ${metrics.status}; raw evidence: ${output}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
