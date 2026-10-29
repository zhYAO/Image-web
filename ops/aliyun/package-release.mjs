import { stageCandidate, mustNotExist, writeSidecars, writeFullArchive } from './package-stage.mjs';
import { lstat, readFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageManager = 'pnpm@11.19.0';
const assemblyCacheRoot = '/opt/zimage/layer-cache';
const maxInventoryBytes = 2_000_000_000;
const valuedFlags = new Set(['--format', '--assets', '--release-id', '--target', '--inventory', '--python']);
const switches = new Set(['--prepare-only', '--check-target']);

export function parseReleaseArgs(args) {
  const flags = new Map(), positional = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('-')) { positional.push(argument); continue; }
    if (!valuedFlags.has(argument) && !switches.has(argument)) throw new Error(`Unknown option: ${argument}`);
    if (flags.has(argument)) throw new Error(`Duplicate option: ${argument}`);
    if (switches.has(argument)) flags.set(argument, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith('-') || value.includes('\0')) throw new Error(`${argument} requires a value`);
      flags.set(argument, value);
    }
  }
  if (positional.length > 2 || positional.some(value => !value || value.includes('\0')))
    throw new Error('Expected at most two positional arguments: DIST DEST');
  const format = flags.get('--format') ?? 'layers';
  if (!['layers', 'full'].includes(format)) throw new Error('--format must be layers or full');
  const checkTarget = flags.has('--check-target');
  if (checkTarget && (positional.length || [...flags.keys()].some(key => !['--check-target', '--target'].includes(key))))
    throw new Error('--check-target accepts only --target FILE');
  if (format === 'full' && [...flags.keys()].some(key => key !== '--format'))
    throw new Error('--prepare-only and layer options require --format layers');
  if (format === 'layers') {
    if (!flags.has('--target')) throw new Error('--target FILE is required for layers and --check-target');
    if (!checkTarget) {
      if (positional.length !== 2) throw new Error('Layers require positional DIST DEST arguments');
      if (!flags.has('--assets')) throw new Error('--assets VERSION_DIR is required for layers');
      if (!/^[a-f0-9]{40}$/.test(flags.get('--release-id') ?? '')) throw new Error('--release-id must be a full lowercase SHA40');
    }
  }
  return { format, checkTarget, dist: positional[0] ?? 'apps/web/.next', destination: positional[1] ?? '/tmp/zimage-release',
    assets: flags.get('--assets'), releaseId: flags.get('--release-id'), target: flags.get('--target'),
    inventory: flags.get('--inventory'), python: flags.get('--python'), prepareOnly: flags.has('--prepare-only') };
}

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const overlaps = (left, right) => contains(left, right) || contains(right, left);

async function readJson(file) {
  if (!(await lstat(file)).isFile()) throw new Error(`Expected a regular JSON file: ${file}`);
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function checkTarget(file, project = process.cwd()) {
  const target = await readJson(path.resolve(project, file));
  const runtimeKeys = ['node', 'abi', 'platform', 'arch', 'libc'];
  if (!exactKeys(target, ['schema', 'runtime', 'toolchain', 'assemblyCacheRoot']) || target.schema !== 1 ||
      !exactKeys(target.runtime, runtimeKeys) || target.runtime.platform !== 'linux' ||
      typeof target.runtime.libc !== 'string' || !/^glibc-[0-9]+(?:\.[0-9]+)+$/.test(target.runtime.libc) ||
      runtimeKeys.some(key => typeof target.runtime[key] !== 'string' || !target.runtime[key]) ||
      !exactKeys(target.toolchain, ['packageManager']) || target.toolchain.packageManager !== packageManager ||
      target.assemblyCacheRoot !== assemblyCacheRoot)
    throw new Error('Invalid target schema, runtime, toolchain or assembly cache root');
  if ((await readJson(path.join(project, 'package.json'))).packageManager !== target.toolchain.packageManager)
    throw new Error('Project packageManager differs from target toolchain');
  const header = process.report.getReport().header;
  const runtime = { node: process.versions.node, abi: process.versions.modules, platform: process.platform,
    arch: process.arch, libc: header.glibcVersionRuntime ? `glibc-${header.glibcVersionRuntime}` : 'non-glibc' };
  if (runtimeKeys.some(key => runtime[key] !== target.runtime[key]))
    throw new Error(`Build host runtime fingerprint differs from target: ${JSON.stringify(runtime)}`);
  return target;
}

async function checkedDirectory(directory) {
  const absolute = path.resolve(directory);
  // Reject symlink ancestors rather than silently moving outputs into inputs.
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!(await lstat(current)).isDirectory()) throw new Error(`Expected real directory without symlinks: ${current}`);
  }
  return realpath(absolute);
}

export function validateInventory(inventory, releaseSha) {
  if (typeof releaseSha !== 'string' || !/^[a-f0-9]{40}$/.test(releaseSha) ||
      !exactKeys(inventory, ['schema', 'releaseSha', 'files']) || inventory.schema !== 1 || inventory.releaseSha !== releaseSha ||
      !inventory.files || typeof inventory.files !== 'object' || Array.isArray(inventory.files) || Object.keys(inventory.files).length > 7)
    throw new Error('Invalid inventory schema or release SHA');
  const slots = new Set();
  let totalBytes = 0;
  for (const [name, record] of Object.entries(inventory.files)) {
    const match = /^layers\/(code|runtime|assets)-([a-f0-9]{64})\.(json|tgz)$/.exec(name);
    const slot = match ? `${match[1]}.${match[3]}` : 'manifest';
    if ((!match && name !== `releases/${releaseSha}.json`) || slots.has(slot) ||
        !exactKeys(record, ['sha256', 'bytes']) || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) ||
        !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > maxInventoryBytes)
      throw new Error('Invalid inventory file path, digest or size');
    slots.add(slot);
    totalBytes += record.bytes;
  }
  if (totalBytes > maxInventoryBytes) throw new Error('Invalid inventory aggregate byte size');
}

function pythonJson(python, script, args, project) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  // The Python packer measures `node` too: pin it to this entry's executable.
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] ?? '');
  const result = spawnSync(python, ['-I', '-B', fileURLToPath(new URL(script, import.meta.url)), ...args], {
    cwd: project, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Python ${path.basename(script)} failed: ${result.error?.message || result.stderr?.trim() || result.signal || result.status}`);
  try { return JSON.parse(result.stdout); }
  catch (error) { throw new Error(`Python ${path.basename(script)} returned invalid JSON`, { cause: error }); }
}

export async function packageRelease(args, project = process.cwd()) {
  const options = parseReleaseArgs(args);
  project = await realpath(project);
  const inventoryFile = options.inventory ? path.resolve(project, options.inventory) : null;
  if (inventoryFile) validateInventory(await readJson(inventoryFile), options.releaseId);
  // No staging, archive, subprocess or output writes may precede this check.
  if (options.format === 'layers') await checkTarget(options.target, project);
  if (options.checkTarget) return { targetCompatible: true, productionReady: false };
  const dist = path.resolve(project, options.dist), destination = path.resolve(project, options.destination);
  if (options.format === 'full') {
    const archive = destination + '.tgz', debugArchive = destination + '.debug-maps.tgz', traceArchive = destination + '.build-traces.tgz';
    for (const output of [destination, archive, debugArchive, traceArchive]) await mustNotExist(output);
    const stage = await stageCandidate({ dist, destination, project });
    const sidecars = await writeSidecars(stage, debugArchive, traceArchive);
    await writeFullArchive(stage, archive);
    return { format: 'full', productionReady: false, nativePreflight: stage.nativeReport,
      artifacts: { staging: destination, archive, ...sidecars } };
  }
  const assets = await checkedDirectory(path.resolve(project, options.assets));
  await checkedDirectory(path.dirname(destination));
  await checkedDirectory(dist);
  if ([project, dist, assets].some(root => overlaps(root, destination)) || overlaps(project, assets) || overlaps(dist, assets))
    throw new Error('Layer output, project and asset input paths must be disjoint; DEST must be outside the project');
  await mustNotExist(destination);
  const targetFile = path.resolve(project, options.target);
  if ((await readJson(path.join(dist, 'required-server-files.json'))).config?.distDir !== '.next')
    throw new Error('Deployment requires the canonical .next distDir');
  const artifacts = { root: destination, staging: path.join(destination, 'staging'), store: path.join(destination, 'store'),
    manifest: path.join(destination, 'store/releases', options.releaseId + '.json'),
    inventoryRequest: path.join(destination, 'inventory-request.json'), report: path.join(destination, 'release-result.json'),
    transport: options.prepareOnly ? null : path.join(destination, 'transport.tgz') };
  await mkdir(destination);
  const stage = await stageCandidate({ dist, destination: artifacts.staging, project });
  const python = options.python ?? process.env.ZIMAGE_PYTHON_BIN ?? 'python3';
  const pack = pythonJson(python, './three-layer-release.py', ['pack', artifacts.staging, artifacts.store,
    '--project', project, '--assets', assets, '--release-id', options.releaseId, '--source-commit', options.releaseId,
    '--target', targetFile], project);
  const manifestArgs = [artifacts.store, artifacts.manifest, '--manifest-sha256', pack.manifestSha256];
  const request = pythonJson(python, './release-transport.py', ['request', ...manifestArgs], project);
  const inventoryArgs = inventoryFile ? ['--inventory', inventoryFile] : [];
  const transport = options.prepareOnly
    ? pythonJson(python, './release-transport.py', ['plan', ...manifestArgs, ...inventoryArgs], project)
    : pythonJson(python, './release-transport.py', ['bundle', artifacts.store, artifacts.manifest, artifacts.transport,
      '--manifest-sha256', pack.manifestSha256, ...inventoryArgs], project);
  Object.assign(artifacts, await writeSidecars(stage, path.join(destination, 'debug-maps.tgz'), path.join(destination, 'build-traces.tgz')));
  await writeFile(artifacts.inventoryRequest, JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
  const report = { schema: 1, format: 'layers', releaseSha: options.releaseId, prepareOnly: options.prepareOnly,
    productionReady: false, artifacts, nativePreflight: stage.nativeReport, pack, transport };
  await writeFile(artifacts.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await packageRelease(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error('Release packaging failed: ' + error.message); process.exitCode = 1; }
}
