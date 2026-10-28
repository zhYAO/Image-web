import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Offline prototype: sources and the output parent must remain unchanged during a run.
// The exclusive sibling lock coordinates this CLI only. Node's rename is atomic, but
// does not provide RENAME_NOREPLACE against uncooperative concurrent filesystem writers.
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const sharp = require('sharp');
const fontNames = ['LICENSE.txt', 'NotoSansCJKsc-Bold.otf', 'NotoSansCJKsc-Regular.otf', 'README.md'];
const mimeTypes = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.json', 'application/json'], ['.md', 'text/markdown'], ['.txt', 'text/plain'], ['.otf', 'font/otf'],
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function safePath(value) {
  if (typeof value !== 'string' || !value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ||
      value.split('/').some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) || part === '.' || part === '..'))
    throw new Error(`Unsafe asset path: ${value}`);
  return value;
}
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function noSymlinkAncestors(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlink input or output ancestor: ${current}`);
    if (!stat.isDirectory()) throw new Error(`Expected directory: ${current}`);
  }
}
async function mustNotExist(target) {
  try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Output already exists: ${target}`);
}
async function checkedRead(target) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`Expected regular source file: ${target}`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.size !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new Error(`Source changed while reading: ${target}`);
    return bytes;
  } finally { await handle.close(); }
}
async function walk(directory, prefix = '') {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink()) throw new Error(`Symlink source: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`Expected source directory: ${directory}`);
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const relative = safePath(prefix ? `${prefix}/${name}` : name);
    const full = path.join(directory, name), entry = await lstat(full);
    if (entry.isSymbolicLink()) throw new Error(`Symlink source: ${full}`);
    if (entry.isDirectory()) files.push(...await walk(full, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unsupported source file type: ${full}`);
  }
  return files;
}
async function setPublishedModes(directory) {
  for (const name of await readdir(directory)) {
    const target = path.join(directory, name), stat = await lstat(target);
    if (stat.isDirectory()) await setPublishedModes(target);
    else if (stat.isFile()) await chmod(target, 0o644);
    else throw new Error(`Unsupported staged file type: ${target}`);
  }
  // Explicit chmod is required: mkdir/writeFile modes are restricted by umask.
  // This tree is newly created staging output; source and existing paths are untouched.
  await chmod(directory, 0o755);
}
function provenanceFor(file, publicPaths) {
  let directory = path.posix.dirname(file);
  while (true) {
    const found = ['manifest.json', 'README.md'].map(name => directory === '.' ? name : `${directory}/${name}`)
      .filter(candidate => candidate !== file && publicPaths.has(candidate));
    if (found.length) return found;
    if (directory === '.') return [];
    directory = path.posix.dirname(directory);
  }
}
async function packageAssets(project, output) {
  if (contains(project, output) || contains(output, project)) throw new Error('Output and project paths overlap');
  await noSymlinkAncestors(project);
  const publicRoot = path.join(project, 'apps/web/public'), fontRoot = path.join(project, 'apps/web/server/apparel/fonts');
  await noSymlinkAncestors(publicRoot);
  await noSymlinkAncestors(fontRoot);
  await noSymlinkAncestors(path.dirname(output));
  await mustNotExist(output);
  const lock = path.join(path.dirname(output), `.${path.basename(output)}.static-assets.lock`);
  await mkdir(lock, { mode: 0o700 }); // EEXIST rejects cooperating concurrent runs; never remove another run's lock.
  let stage;
  try {
    await mustNotExist(output);
    const policy = JSON.parse(await checkedRead(fileURLToPath(new URL('./release-public-policy.json', import.meta.url))));
    const excluded = new Set(policy.excludedSourceFiles.map(safePath));
    // Any change to the exclusion list must be a deliberate policy edit, not a typo.
    if (excluded.size !== 4 || policy.excludedSourceFiles.length !== 4) throw new Error('Expected exactly four source exclusions');
    const publicFiles = (await walk(publicRoot)).filter(file => !excluded.has(file));
    const fonts = await walk(fontRoot);
    if (JSON.stringify(fonts) !== JSON.stringify(fontNames)) throw new Error('Font directory must contain exactly the two fonts, LICENSE.txt and README.md');
    const publicPaths = new Set(publicFiles), assets = [];
    for (const [kind, sourceRoot, files] of [['public', publicRoot, publicFiles], ['font', fontRoot, fonts]]) {
      for (const relative of files) {
        if (kind === 'public' && (relative === 'asset-manifest.json' || relative === 'fonts' || relative.startsWith('fonts/')))
          throw new Error(`Reserved asset path: ${relative}`);
        const extension = path.posix.extname(relative), mime = mimeTypes.get(extension);
        if (!mime || (kind === 'public' && extension === '.otf')) throw new Error(`Unknown resource type: ${relative}`);
        const assetPath = safePath(kind === 'font' ? `fonts/${relative}` : relative);
        const bytes = await checkedRead(path.join(sourceRoot, relative));
        const entry = { path: assetPath, kind, bytes: bytes.length, sha256: hash(bytes), mime };
        if (mime.startsWith('image/')) {
          const metadata = await sharp(bytes, { failOn: 'warning' }).metadata(); // Metadata only: no resize, encode or rotate.
          const expected = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' }[extension];
          if (metadata.format !== expected || !metadata.width || !metadata.height) throw new Error(`Invalid image metadata: ${relative}`);
          Object.assign(entry, { width: metadata.width, height: metadata.height, hasAlpha: Boolean(metadata.hasAlpha), orientation: metadata.orientation ?? null, blurDataURL: null });
        }
        if (kind === 'font' && extension === '.otf') Object.assign(entry, { license: 'fonts/LICENSE.txt', provenance: ['fonts/README.md'] });
        if (kind === 'public') {
          const provenance = provenanceFor(relative, publicPaths);
          if (provenance.length) entry.provenance = provenance;
        }
        assets.push({ entry, bytes });
      }
    }
    assets.sort((a, b) => a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0);
    const manifestBytes = Buffer.from(`${JSON.stringify({ schema: 1, productionReady: false, files: assets.map(asset => asset.entry) }, null, 2)}\n`);
    const manifestSha256 = hash(manifestBytes);
    stage = await mkdtemp(path.join(path.dirname(output), `.${path.basename(output)}.static-assets.tmp-`));
    const version = path.join(stage, manifestSha256);
    await mkdir(version);
    for (const asset of assets) {
      const destination = path.join(version, asset.entry.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, asset.bytes, { flag: 'wx', mode: 0o644 });
    }
    await writeFile(path.join(version, 'asset-manifest.json'), manifestBytes, { flag: 'wx', mode: 0o644 });
    // Read back every written byte before publishing the entire output in one rename.
    for (const { entry } of assets) {
      const bytes = await checkedRead(path.join(version, entry.path));
      if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Written asset hash mismatch: ${entry.path}`);
    }
    if (hash(await checkedRead(path.join(version, 'asset-manifest.json'))) !== manifestSha256) throw new Error('Written manifest hash mismatch');
    await noSymlinkAncestors(path.dirname(output));
    await mustNotExist(output);
    await setPublishedModes(stage);
    await rename(stage, output);
    stage = undefined;
    const sum = kind => assets.filter(asset => asset.entry.kind === kind).reduce((total, asset) => total + asset.entry.bytes, 0);
    const rawPublicBytes = sum('public'), rawFontBytes = sum('font');
    return { productionReady: false, manifestSha256, versionDirectory: path.join(output, manifestSha256), files: assets.length,
      imageFiles: assets.filter(asset => asset.entry.mime.startsWith('image/')).length,
      rawPublicBytes, rawFontBytes, rawManifestBytes: manifestBytes.length, rawTotalBytes: rawPublicBytes + rawFontBytes + manifestBytes.length,
      concurrency: 'Exclusive cooperative lock; uncooperative concurrent source/output changes are unsupported.' };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}
function argumentsFor(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--project', '--output'].includes(key) || !value || value.startsWith('--') || options.has(key)) throw new Error('Usage: node package-static-assets.mjs [--project REPO] --output NEW_DIRECTORY');
    options.set(key, value);
  }
  if (!options.has('--output')) throw new Error('--output NEW_DIRECTORY is required');
  return { project: path.resolve(options.get('--project') ?? fileURLToPath(new URL('../../', import.meta.url))), output: path.resolve(options.get('--output')) };
}
try {
  const { project, output } = argumentsFor(process.argv.slice(2));
  console.log(JSON.stringify(await packageAssets(project, output), null, 2));
} catch (error) {
  console.error(`Static asset package failed: ${error.message}`);
  process.exitCode = 1;
}
