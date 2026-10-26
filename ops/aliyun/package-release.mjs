import { cp, mkdir, readdir, lstat, readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [dist = 'apps/web/.next', destination = '/tmp/zimage-release'] = process.argv.slice(2);
const { excludedSourceFiles } = JSON.parse(await readFile(new URL('./release-public-policy.json', import.meta.url), 'utf8'));
const excluded = new Set(excludedSourceFiles.map(file => `apps/web/public/${file}`));
const archive = path.resolve(destination + '.tgz');
try {
  await lstat(archive);
  throw new Error('Release archive already exists');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(destination);
const safe = source => !path.basename(source).startsWith('.env');
const relative = (root, source) => path.relative(root, source).split(path.sep).join('/');
const standalone = path.join(dist, 'standalone');
await cp(standalone, destination, { recursive: true, verbatimSymlinks: true,
  filter: source => safe(source) && !excluded.has(relative(standalone, source)) });
await cp('apps/web/public', path.join(destination, 'apps/web/public'), { recursive: true,
  filter: source => !excluded.has(`apps/web/public/${relative('apps/web/public', source)}`) });
await cp(path.join(dist, 'static'), path.join(destination, 'apps/web/.next/static'), { recursive: true });
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    if (name.startsWith('.env')) throw new Error('Environment file in release');
    const full = path.join(directory, name);
    if (excluded.has(relative(destination, full))) throw new Error('Excluded source image in release');
    const stat = await lstat(full);
    if (stat.isDirectory()) await inspect(full);
  }
}
await inspect(destination);
const config = JSON.parse(await readFile(path.join(dist, 'required-server-files.json'), 'utf8')).config;
if (config.distDir !== '.next') throw new Error('Deployment requires the canonical .next distDir');
const output = await open(archive, 'wx');
let result;
try {
  result = spawnSync('tar', ['--hard-dereference', '-czf', '-', '-C', destination, '.'], { stdio: ['ignore', output.fd, 'inherit'] });
} finally {
  await output.close();
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Standalone package ready; environment files excluded.');
