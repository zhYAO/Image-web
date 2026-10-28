import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const minimum = readFileSync(join(root, '.node-version'), 'utf8').trim();

export function supportsVersion(version, required) {
  const actual = version.replace(/^v/, '').split('.').map(Number);
  const expected = required.split('.').map(Number);
  if (actual.length !== 3 || actual.some(value => !Number.isInteger(value))) return false;
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== expected[index]) return actual[index] > expected[index];
  }
  return true;
}

export function chooseNode(candidates, required, inspect) {
  for (const candidate of new Set(candidates.filter(Boolean))) {
    const version = inspect(candidate);
    if (version && supportsVersion(version, required)) return { path: candidate, version };
  }
  throw new Error(`需要 Node.js ${required}+。请升级 Node，或设置 ZIMAGE_NODE_BIN 指向兼容的 Node 可执行文件。`);
}

function main() {
  const candidates = process.env.ZIMAGE_NODE_BIN ? [process.env.ZIMAGE_NODE_BIN] : [
    process.execPath,
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, process.platform === 'win32' ? 'node.exe' : 'node')),
    ...['/opt/homebrew', '/usr/local'].flatMap(prefix => ['node@24', 'node@26', 'node'].map(name => join(prefix, 'opt', name, 'bin', 'node'))),
  ];
  const node = chooseNode(candidates, minimum, candidate => {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return result.status === 0 ? result.stdout.trim() : undefined;
  });
  const web = join(root, 'apps/web');
  const require = createRequire(join(web, 'package.json'));
  const next = require.resolve('next/dist/bin/next');
  console.log(`[ZImage dev] Node ${node.version} · ${node.path}`);
  // Resolve the installed Next CLI directly: a globally installed pnpm 9 must
  // not take over a nested pnpm command in this pnpm 11 workspace.
  const child = spawn(node.path, [next, 'dev', '--hostname', '127.0.0.1', '--port', process.env.PORT || '7788', ...process.argv.slice(2)], {
    cwd: web,
    env: { ...process.env, PATH: `${dirname(node.path)}${delimiter}${process.env.PATH ?? ''}` },
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`[ZImage dev] ${error.message}`); process.exitCode = 1; }
}
