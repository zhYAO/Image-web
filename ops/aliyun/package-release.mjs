import { cp, mkdir, readdir, lstat, readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [dist = 'apps/web/.next', destination = '/tmp/zimage-release'] = process.argv.slice(2);
const { excludedSourceFiles, generatedSourcemapRoots } = JSON.parse(await readFile(new URL('./release-public-policy.json', import.meta.url), 'utf8'));
const excluded = new Set(excludedSourceFiles.map(file => `apps/web/public/${file}`));
const archive = path.resolve(destination + '.tgz');
const debugArchive = path.resolve(destination + '.debug-maps.tgz');
for (const output of [archive, debugArchive]) {
  try {
    await lstat(output);
    throw new Error('Release archive already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
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
const maps = [];
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    if (name.startsWith('.env')) throw new Error('Environment file in release');
    const full = path.join(directory, name);
    const entry = relative(destination, full);
    if (excluded.has(entry)) throw new Error('Excluded source image in release');
    const stat = await lstat(full);
    if (stat.isDirectory()) await inspect(full);
    else if (entry.endsWith('.map') && generatedSourcemapRoots.some(root => entry.startsWith(root))) maps.push(`./${entry}`);
  }
}
await inspect(destination);
const config = JSON.parse(await readFile(path.join(dist, 'required-server-files.json'), 'utf8')).config;
if (config.distDir !== '.next') throw new Error('Deployment requires the canonical .next distDir');
async function writeArchive(file, args, input) {
  const output = await open(file, 'wx');
  let result;
  try {
    result = spawnSync('tar', ['--hard-dereference', '-czf', '-', '-C', destination, ...args], {
      input, stdio: [input ? 'pipe' : 'ignore', output.fd, 'inherit'],
    });
  } finally {
    await output.close();
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (maps.length) {
  await writeArchive(debugArchive, ['--null', '-T', '-'], Buffer.from(maps.sort().join('\0') + '\0'));
  console.log(`Retained ${maps.length} generated source maps in separate debug archive.`);
}
// Exclude the collected files, not whole .map-suffixed route directories.
// GNU tar exclusion arguments are patterns, so quote literal glob characters.
const literalPattern = entry => [...entry].map(character => '*?[]\\'.includes(character) ? '\\' + character : character).join('');
await writeArchive(archive, [...maps.map(entry => `--exclude=${literalPattern(entry)}`), '.']);
console.log('Standalone runtime package ready; environment files excluded, generated source maps retained separately.');
