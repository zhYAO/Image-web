#!/usr/bin/env node
// Reports mutually exclusive logical file bytes for exactly the inputs that
// ops/aliyun/package-release.mjs ships. It does not follow symlinks, does not
// read build caches or the raw .next tree, and never reports compressed sizes.
//
// Usage:
//   node apps/web/scripts/measure-dist.mjs
//   node apps/web/scripts/measure-dist.mjs --dist apps/web/.next --json report.json
//   node apps/web/scripts/measure-dist.mjs --assert-slim
//
// --assert-slim exits nonzero when the trace still contains Next development
// entrypoints or esbuild, i.e. when ZIMAGE_BUILD_SLIM=1 did not take effect.

import { lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// package-release.mjs drops these source images from the public layer, so they
// must not appear in the reported runtime bytes either.
const policy = JSON.parse(await readFile(path.join(repoRoot, 'ops/aliyun/release-public-policy.json'), 'utf8'));
const EXCLUDED_PUBLIC = new Set(policy.excludedSourceFiles.map(file => `apps/web/public/${file}`));

const DEV_LEAK_MARKERS = [
  'node_modules/next/dist/server/dev/next-dev-server.js',
  'node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js',
  // pnpm lays esbuild out as .pnpm/@esbuild+linux-x64@<version>/..., so the
  // scope separator is '+', not '/'.
  '@esbuild+',
  'node_modules/next/dist/compiled/babel/bundle.js',
  'node_modules/next/dist/server/capsize-font-metrics.json',
];

function parseArgs(argv) {
  const options = { dist: 'apps/web/.next', publicDir: 'apps/web/public', json: undefined, assertSlim: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dist') options.dist = argv[++index];
    else if (arg === '--public') options.publicDir = argv[++index];
    else if (arg === '--json') options.json = argv[++index];
    else if (arg === '--assert-slim') options.assertSlim = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function walk(root, prefix, files, links) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.env')) continue;
    const absolute = path.join(root, entry.name);
    // An empty prefix means the directory already is the release root, which is
    // the case for standalone: outputFileTracingRoot keeps the apps/web/... paths.
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(absolute, relative, files, links);
      continue;
    }
    if (entry.isSymbolicLink()) {
      // The runtime ships the link itself; only its target text has bytes.
      links.push({ path: relative, bytes: Buffer.byteLength(await readlink(absolute), 'utf8') });
      continue;
    }
    const stat = await lstat(absolute);
    if (stat.isFile()) files.push({ path: relative, bytes: stat.size });
  }
  return true;
}

// Release-relative paths mirror the assembled deployment layout so that a
// single file is counted once, under the same name the server will see.
const CATEGORY_PREFIXES = [
  ['apps/web/server/apparel/fonts/', 'fonts'],
  ['apps/web/public/', 'publicAssets'],
  ['apps/web/.next/static/', 'clientStatic'],
];

function categorize(relative) {
  for (const [prefix, category] of CATEGORY_PREFIXES) {
    if (relative.startsWith(prefix)) return category;
  }
  if (relative.split('/').includes('node_modules')) return 'runtimeDependencies';
  return 'serverBusiness';
}

const isDiagnostic = relative =>
  (relative.startsWith('apps/web/.next/server/') || relative.startsWith('apps/web/.next/static/'))
  && (relative.endsWith('.map') || relative.endsWith('.js.nft.json'));

const format = bytes => (bytes / 1_000_000).toFixed(2);

function table(rows) {
  const width = Math.max(...rows.map(row => row.label.length));
  return rows
    .map(({ label, bytes, ratio }) =>
      `${label.padEnd(width)}  ${String(bytes).padStart(12)}  ${format(bytes).padStart(8)} MB  ${(ratio * 100).toFixed(2).padStart(6)}%`)
    .join('\n');
}

const options = parseArgs(process.argv.slice(2));
const dist = path.resolve(repoRoot, options.dist);
const standalone = path.join(dist, 'standalone');

const files = [];
const links = [];
const missing = [];

// standalone already preserves the outputFileTracingRoot-relative paths, so the
// release root is the directory itself and no extra prefix may be prepended.
if (!await walk(standalone, '', files, links)) missing.push('standalone');
if (!await walk(path.join(dist, 'static'), 'apps/web/.next/static', files, links)) missing.push('static');
if (!await walk(path.resolve(repoRoot, options.publicDir), 'apps/web/public', files, links)) missing.push('public');

if (!files.length) {
  console.error(`No release files found under ${path.relative(repoRoot, dist)}. Build first (see next.config.ts output: 'standalone').`);
  process.exit(1);
}
if (missing.length) {
  console.error(`Incomplete release inputs, missing: ${missing.join(', ')}. Refusing to report partial totals.`);
  process.exit(1);
}

const totals = Object.create(null);
const diagnostics = { files: 0, bytes: 0 };
const seen = new Set();
let excludedPublic = { files: 0, bytes: 0 };

// Later static/public copies replace standalone files, as in package-release.mjs.
const finalFiles = new Map(files.map(file => [file.path, file]));
const finalLinks = new Map(links.map(link => [link.path, link]));
for (const name of finalLinks.keys()) {
  if (finalFiles.has(name)) throw new Error('Conflicting file/link release inputs: ' + name);
}
const runtimeLinks = [...finalLinks.values()].filter(link => !EXCLUDED_PUBLIC.has(link.path) && !isDiagnostic(link.path));
const symlinkTargetBytes = runtimeLinks.reduce((sum, link) => sum + link.bytes, 0);

for (const file of finalFiles.values()) {
  seen.add(file.path);
  if (EXCLUDED_PUBLIC.has(file.path)) {
    excludedPublic.files += 1;
    excludedPublic.bytes += file.bytes;
    continue;
  }
  if (isDiagnostic(file.path)) {
    diagnostics.files += 1;
    diagnostics.bytes += file.bytes;
    continue;
  }
  const category = categorize(file.path);
  const bucket = totals[category] ??= { files: 0, bytes: 0 };
  bucket.files += 1;
  bucket.bytes += file.bytes;
}

const runtime = totals.runtimeDependencies?.bytes ?? 0;
const fonts = totals.fonts?.bytes ?? 0;
const publicAssets = totals.publicAssets?.bytes ?? 0;
const serverBusiness = totals.serverBusiness?.bytes ?? 0;
const clientStatic = totals.clientStatic?.bytes ?? 0;
const business = serverBusiness + clientStatic;
const total = business + runtime + fonts + publicAssets;

const rows = [
  { label: 'server business', bytes: serverBusiness, ratio: serverBusiness / total },
  { label: 'client static (JS/CSS)', bytes: clientStatic, ratio: clientStatic / total },
  { label: 'business subtotal', bytes: business, ratio: business / total },
  { label: 'runtime dependencies', bytes: runtime, ratio: runtime / total },
  { label: 'fonts and licenses', bytes: fonts, ratio: fonts / total },
  { label: 'public assets', bytes: publicAssets, ratio: publicAssets / total },
  { label: 'complete runtime', bytes: total, ratio: 1 },
];

const leaked = DEV_LEAK_MARKERS.filter(marker => seenEntries(seen, marker));

function seenEntries(set, marker) {
  for (const entry of set) {
    if (entry.includes(marker)) return entry;
  }
  return undefined;
}

console.log(`Release inputs: ${path.relative(repoRoot, dist)} (standalone + static + public)`);
console.log(`Regular files: ${seen.size}, symlinks: ${runtimeLinks.length} (not followed, ${symlinkTargetBytes} bytes of target text)`);
console.log('');
console.log(table(rows));
console.log('');
console.log(`Excluded diagnostics: ${diagnostics.files} files, ${diagnostics.bytes} bytes (source maps and .js.nft.json, archived separately by package-release.mjs)`);
console.log(`Excluded public policy: ${excludedPublic.files} files, ${excludedPublic.bytes} bytes (release-public-policy.json)`);
console.log(`Slim trace check: ${leaked.length ? `FAIL — development output present: ${leaked.join(', ')}` : 'PASS — no development entrypoint or esbuild in the trace'}`);

if (options.json) {
  await writeFile(path.resolve(repoRoot, options.json), JSON.stringify({
    dist: path.relative(repoRoot, dist).split(path.sep).join('/'),
    // Unique input files include separately reported diagnostics and exclusions.
    regularFiles: seen.size,
    runtimeRegularFiles: Object.values(totals).reduce((sum, bucket) => sum + bucket.files, 0),
    symlinks: runtimeLinks.length,
    symlinkTargetBytes,
    categories: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, { ...value }])),
    businessBytes: business,
    completeRuntimeBytes: total,
    diagnostics: { ...diagnostics },
    excludedPublicPolicy: { ...excludedPublic },
    slimTracePassed: leaked.length === 0,
  }, null, 2) + '\n', 'utf8');
  console.log(`Report written to ${options.json}`);
}

if (options.assertSlim && leaked.length) {
  console.error('ZIMAGE_BUILD_SLIM=1 did not take effect for this build; production packaging must not ship it.');
  process.exit(1);
}
