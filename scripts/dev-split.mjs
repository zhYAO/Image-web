import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chooseNode } from './dev.mjs';
import { localBackendOrigin, readDevRuntime } from '../apps/frontend/build/dev-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = (value, name) => {
  if (!/^[0-9]+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error(`${name} 必须是 1024–65535 的整数。`);
  return Number(value);
};

export function parseSplitOptions(args) {
  const { values } = parseArgs({ args, options: {
    'frontend-port': { type: 'string', default: '5173' }, 'backend-port': { type: 'string' },
    'backend-origin': { type: 'string' }, 'backend-sha': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) return { help: true };
  const frontendPort = port(values['frontend-port'], 'frontend-port');
  const external = Boolean(values['backend-origin']);
  if (external && (values['backend-port'] || !/^[a-f0-9]{40}$/.test(values['backend-sha'] ?? ''))) throw new Error('已有后端必须同时指定 --backend-origin 和完整 --backend-sha，不能再指定 backend-port。');
  if (!external && values['backend-sha']) throw new Error('自启后端的 SHA 来自当前 Git HEAD，不接受 backend-sha 覆盖。');
  const backendPort = port(values['backend-port'] ?? '7788', 'backend-port');
  const backendOrigin = localBackendOrigin(values['backend-origin'] ?? `http://127.0.0.1:${backendPort}`);
  if (Number(new URL(backendOrigin).port) === frontendPort) throw new Error('前后端必须使用不同端口。');
  return { external, frontendPort, backendPort, backendOrigin, expectedSHA: values['backend-sha'], frontendOrigin: `http://127.0.0.1:${frontendPort}` };
}

export async function assertPortAvailable(portNumber) {
  await new Promise((resolveAvailable, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`127.0.0.1:${portNumber} 已占用或无法监听；请指定其他端口，不会停止现有进程。`)));
    server.listen(portNumber, '127.0.0.1', () => server.close(resolveAvailable));
  });
}

function terminateOwned(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function ownedGroupAlive(child) {
  if (!child.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try { process.kill(-child.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

/** Only detached process groups spawned by this invocation enter the supervisor. */
export function createSupervisor({ signals = process, terminate = terminateOwned, alive = ownedGroupAlive, graceMs = 5000 } = {}) {
  const children = new Set();
  const controller = new AbortController();
  let stopping = false;
  let complete;
  const done = new Promise(resolveDone => { complete = resolveDone; });
  const stop = async (code = 0) => {
    if (stopping) return done;
    stopping = true;
    controller.abort();
    for (const child of children) { try { terminate(child, 'SIGTERM'); } catch { code = 1; } }
    const deadline = Date.now() + graceMs;
    while ([...children].some(alive) && Date.now() < deadline) await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    for (const child of children) if (alive(child)) { try { terminate(child, 'SIGKILL'); } catch { code = 1; } }
    signals.off('SIGINT', interrupt); signals.off('SIGTERM', end);
    complete(code);
    return done;
  };
  const interrupt = () => { void stop(130); };
  const end = () => { void stop(143); };
  signals.on('SIGINT', interrupt); signals.on('SIGTERM', end);
  return {
    signal: controller.signal, done, stop,
    track(child) {
      if (stopping) throw new Error('开发进程已停止，不能再启动子进程。');
      children.add(child);
      child.once('error', () => { void stop(1); });
      child.once('exit', () => { if (!stopping) void stop(1); });
      return child;
    },
  };
}

function installedCli(workspace, packageName, command) {
  const require = createRequire(join(workspace, 'package.json'));
  const manifest = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));
  const dependencyPath = require.resolve(`${packageName}/package.json`);
  const installed = JSON.parse(readFileSync(dependencyPath, 'utf8'));
  const expected = manifest.dependencies?.[packageName] ?? manifest.devDependencies?.[packageName];
  if (installed.version !== expected) throw new Error(`${packageName} 已安装版本与锁定声明不符，请先 pnpm install --frozen-lockfile。`);
  return join(dirname(dependencyPath), command);
}

function mainNode() {
  const candidates = process.env.ZIMAGE_NODE_BIN ? [process.env.ZIMAGE_NODE_BIN] : [process.execPath,
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path, process.platform === 'win32' ? 'node.exe' : 'node')),
    ...['/opt/homebrew', '/usr/local'].flatMap(prefix => ['node@24', 'node@26', 'node'].map(name => join(prefix, 'opt', name, 'bin', 'node'))),
  ];
  return chooseNode(candidates, readFileSync(join(root, '.node-version'), 'utf8').trim(), candidate => {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return result.status === 0 ? result.stdout.trim() : undefined;
  });
}

export async function main(args = process.argv.slice(2)) {
  const options = parseSplitOptions(args);
  if (options.help) {
    console.log('pnpm dev:split [--frontend-port 5173] [--backend-port 7788]\npnpm dev:split --backend-origin http://127.0.0.1:7788 --backend-sha <40位SHA>\n仅监听本机；使用 apps/web/.env.local 的真实服务配置，真实业务操作仍会消费额度。');
    return 0;
  }
  const node = mainNode();
  const web = join(root, 'apps/web'), frontend = join(root, 'apps/frontend');
  const vite = installedCli(frontend, 'vite', 'bin/vite.js');
  const frontendEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'LANG', 'LC_ALL'].includes(key)));
  frontendEnvironment.PATH = `${dirname(node.path)}${delimiter}${process.env.PATH ?? ''}`;
  let next, backendEnvironment;
  let expectedSHA = options.expectedSHA;
  if (!options.external) {
    next = installedCli(web, 'next', 'dist/bin/next');
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    if (git.status !== 0 || !/^[a-f0-9]{40}$/.test(git.stdout.trim())) throw new Error('无法读取当前 Git HEAD；不能创建假的后端身份。');
    expectedSHA = git.stdout.trim();
    const { loadEnvConfig } = createRequire(next)('@next/env');
    const { combinedEnv } = loadEnvConfig(web, true, { info() {}, error() {} }, true);
    const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'].filter(key => !combinedEnv[key]?.trim());
    if (missing.length) throw new Error(`apps/web/.env.local 缺少真实配置：${missing.join(', ')}；不会使用假值或 Mock。`);
    backendEnvironment = { ...combinedEnv, PATH: frontendEnvironment.PATH, NODE_ENV: 'development', ZIMAGE_DEPLOYMENT_ENV: 'development',
      NEXT_PUBLIC_DATA_MODE: 'http', NEXT_PUBLIC_PHASE2_AUTH: 'true', ZIMAGE_BUILD_SHA: expectedSHA, ZIMAGE_ALLOWED_ORIGINS: options.frontendOrigin };
  }
  await assertPortAvailable(options.frontendPort);
  if (!options.external) await assertPortAvailable(options.backendPort);
  const supervisor = createSupervisor();
  const start = (command, arguments_, cwd, env) => supervisor.track(spawn(node.path, [command, ...arguments_], {
    cwd, env, stdio: 'inherit', detached: process.platform !== 'win32',
  }));
  try {
    if (next) start(next, ['dev', '--hostname', '127.0.0.1', '--port', String(options.backendPort)], web, backendEnvironment);
    else console.log(`[dev:split] 验证已有本地后端；其 ZIMAGE_ALLOWED_ORIGINS 需包含 ${options.frontendOrigin}。退出不会停止该后端。`);
    const descriptor = await readDevRuntime(options.backendOrigin, expectedSHA, { signal: supervisor.signal });
    supervisor.signal.throwIfAborted();
    start(vite, ['--host', '127.0.0.1', '--port', String(options.frontendPort), '--strictPort'], frontend, {
      ...frontendEnvironment, ZIMAGE_DEV_BACKEND_ORIGIN: options.backendOrigin, ZIMAGE_DEV_BACKEND_SHA: expectedSHA,
      ZIMAGE_FRONTEND_COMPATIBILITY: JSON.stringify(descriptor),
    });
    console.log(`[dev:split] ${options.frontendOrigin} → ${options.backendOrigin} · ${expectedSHA} · Node ${node.version}\n已核对运行时身份；这不代表数据库、模型或正式发布验收通过。`);
    return await supervisor.done;
  } catch (error) {
    if (!supervisor.signal.aborted) console.error(`[dev:split] ${error.message}`);
    return await supervisor.stop(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(`[dev:split] ${error.message}`); process.exitCode = 1; });
}
