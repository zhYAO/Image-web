import { cp, mkdir, readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [dist = 'apps/web/.next', destination = '/tmp/zimage-release'] = process.argv.slice(2);
await mkdir(destination, { recursive: true });
const safe = source => !path.basename(source).startsWith('.env');
await cp(path.join(dist, 'standalone'), destination, { recursive: true, verbatimSymlinks: true, filter: safe });
await cp('apps/web/public', path.join(destination, 'apps/web/public'), { recursive: true });
await cp(path.join(dist, 'static'), path.join(destination, 'apps/web/.next/static'), { recursive: true });
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    if (name.startsWith('.env')) throw new Error('Environment file in release');
    const full = path.join(directory, name);
    const stat = await lstat(full);
    if (stat.isDirectory()) await inspect(full);
  }
}
await inspect(destination);
const config = JSON.parse(await readFile(path.join(dist, 'required-server-files.json'), 'utf8')).config;
if (config.distDir !== '.next') throw new Error('Deployment requires the canonical .next distDir');
const result = spawnSync('tar', ['--hard-dereference', '-czf', path.resolve(destination + '.tgz'), '-C', destination, '.'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Standalone package ready; environment files excluded.');
