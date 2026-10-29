import { preflightCandidate } from './package-preflight.mjs';
import { cp, mkdir, readdir, lstat, readFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const { excludedSourceFiles, generatedSourcemapRoots, generatedBuildTraceRoots } = JSON.parse(
  await readFile(new URL('./release-public-policy.json', import.meta.url), 'utf8'));
const excluded = new Set(excludedSourceFiles.map(file => `apps/web/public/${file}`));
const relative = (root, source) => path.relative(root, source).split(path.sep).join('/');

export function diagnosticKind(entry, kind) {
  if (kind === 'directory') return null;
  if (entry.endsWith('.map') && generatedSourcemapRoots.some(root => entry.startsWith(root))) {
    // Python's layered inventory retains links. Reject diagnostic links in the
    // shared stage before either format can publish an inconsistent graph.
    if (kind === 'symlink') throw new Error(`Generated diagnostic symlink is unsupported: ${entry}`);
    return 'map';
  }
  if (kind === 'file' && entry.endsWith('.js.nft.json') && generatedBuildTraceRoots.some(root => entry.startsWith(root))) return 'trace';
  return null;
}

export async function mustNotExist(target) {
  try { await lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Release output already exists: ${target}`);
}

export async function stageCandidate({ dist, destination, project = process.cwd() }) {
  dist = path.resolve(project, dist);
  destination = path.resolve(destination);
  const config = JSON.parse(await readFile(path.join(dist, 'required-server-files.json'), 'utf8')).config;
  if (config?.distDir !== '.next') throw new Error('Deployment requires the canonical .next distDir');
  await mustNotExist(destination);
  await mkdir(destination);
  const safe = source => !path.basename(source).startsWith('.env');
  const standalone = path.join(dist, 'standalone');
  const publicRoot = path.join(project, 'apps/web/public');
  await cp(standalone, destination, { recursive: true, verbatimSymlinks: true,
    filter: source => safe(source) && !excluded.has(relative(standalone, source)) });
  await cp(publicRoot, path.join(destination, 'apps/web/public'), { recursive: true,
    filter: source => safe(source) && !excluded.has(`apps/web/public/${relative(publicRoot, source)}`) });
  await cp(path.join(dist, 'static'), path.join(destination, 'apps/web/.next/static'), {
    recursive: true, filter: safe,
  });
  const maps = [], traces = [];
  async function inspect(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (name.startsWith('.env')) throw new Error('Environment file in release');
      const full = path.join(directory, name), entry = relative(destination, full);
      if (entry.startsWith('apps/web/server/apparel/fonts/') || /NotoSansCJKsc-(Regular|Bold)\.otf$/.test(entry))
        throw new Error('Application packages require external font resources; rebuild without traced apparel fonts.');
      if (excluded.has(entry)) throw new Error('Excluded source image in release');
      const stat = await lstat(full);
      if (stat.isDirectory()) await inspect(full);
      else {
        const diagnostic = diagnosticKind(entry, stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other');
        if (diagnostic === 'map') maps.push(`./${entry}`);
        else if (diagnostic === 'trace') traces.push(`./${entry}`);
      }
    }
  }
  await inspect(destination);
  // Check the graph after diagnostics are omitted, then load the candidate's
  // own Sharp closure. Every format uses this mandatory gate.
  const nativeReport = await preflightCandidate(destination, [...maps, ...traces]);
  return { destination, maps, traces, nativeReport };
}

export async function writeArchive(file, destination, args, input) {
  const output = await open(file, 'wx');
  let result;
  try {
    result = spawnSync('tar', ['--hard-dereference', '-czf', '-', '-C', destination, ...args], {
      input, stdio: [input ? 'pipe' : 'ignore', output.fd, 'pipe'],
    });
  } finally { await output.close(); }
  if (result.error || result.status !== 0) {
    await unlink(file);
    throw new Error(`Archive command failed: ${result.error?.message || result.stderr?.toString().trim() || result.signal || result.status}`);
  }
}

export async function writeSidecars(stage, debugArchive, traceArchive) {
  const artifacts = { debugMaps: null, buildTraces: null };
  for (const [entries, file, key] of [[stage.maps, debugArchive, 'debugMaps'], [stage.traces, traceArchive, 'buildTraces']]) {
    if (!entries.length) continue;
    await writeArchive(file, stage.destination, ['--null', '-T', '-'], Buffer.from(entries.sort().join('\0') + '\0'));
    artifacts[key] = file;
  }
  return artifacts;
}

export async function writeFullArchive(stage, archive) {
  // GNU tar exclusion arguments are patterns: preserve literal route brackets.
  const literalPattern = entry => [...entry].map(character => '*?[]\\'.includes(character) ? '\\' + character : character).join('');
  await writeArchive(archive, stage.destination,
    [...[...stage.maps, ...stage.traces].map(entry => `--exclude=${literalPattern(entry)}`), '.']);
}
