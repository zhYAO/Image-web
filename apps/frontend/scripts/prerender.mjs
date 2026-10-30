import { assertStageSource, readSourceSnapshot, assertBuildSourceUnchanged } from './build-source-identity.mjs';
import { readFile, writeFile, mkdir, unlink, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const escapeAttribute = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function renderDocument(template, page) {
  const replacements = [
    ['<!--zimage:root-->', page.html],
    [/<title>[^<]*<\/title>/g, `<title>${escapeAttribute(page.title)}</title>`],
    [/<meta name="description" content="[^"]*"\s*\/>/g, `<meta name="description" content="${escapeAttribute(page.description)}" />`],
    [/<meta name="robots" content="[^"]*"\s*\/>/g, `<meta name="robots" content="${escapeAttribute(page.robots)}" />`],
  ];
  let output = template;
  for (const [pattern, replacement] of replacements) {
    const count = typeof pattern === 'string' ? output.split(pattern).length - 1 : [...output.matchAll(pattern)].length;
    if (count !== 1) throw new Error('Invalid prerender template');
    output = output.replace(pattern, () => replacement);
  }
  return output;
}

export function collectStyles(manifest, roots) {
  const visited = new Set(), styles = new Set();
  const visit = key => {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry || typeof entry !== 'object') throw new Error('Missing prerender style entry');
    for (const css of entry.css ?? []) {
      if (typeof css !== 'string' || !/^assets\/[A-Za-z0-9._/-]+\.css$/.test(css) || css.split('/').includes('..')) throw new Error('Invalid prerender stylesheet');
      styles.add(css);
    }
    for (const dependency of entry.imports ?? []) visit(dependency);
  };
  roots.forEach(visit);
  return [...styles];
}

/** The coordinator builds browser and isolated render entries before this step. */
export async function prerender({ dist, entry }) {
  const renderEntry = await import(pathToFileURL(resolve(entry)).href);
  if (typeof renderEntry.renderPublicPage !== 'function' || !Array.isArray(renderEntry.publicPrerenderPaths)) throw new Error('Invalid prerender entry');
  const expectedPaths = ['/', '/home', '/terms', '/privacy', '/create'];
  if (JSON.stringify(renderEntry.publicPrerenderPaths) !== JSON.stringify(expectedPaths)) throw new Error('Unexpected public prerender routes');
  const template = await readFile(resolve(dist, 'index.html'), 'utf8');
  const viteManifestPath = resolve(dist, '.vite/manifest.json');
  const viteManifest = JSON.parse(await readFile(viteManifestPath, 'utf8'));
  const script = template.match(/<script\b[^>]*\bsrc="(\/frontend-assets\/[^/]+\/)assets\/[^"]+"/);
  if (!script) throw new Error('Missing versioned browser entry');
  const stylePrefix = script[1];
  // Render every page before writing; no private path or runtime API is queried.
  const files = expectedPaths.map(path => {
    const styles = path === '/create' ? collectStyles(viteManifest, ['src/pages/catalogue.tsx']) : [];
    const pageTemplate = styles.length ? template.replace('</head>', `${styles.map(css => `<link rel="stylesheet" href="${escapeAttribute(stylePrefix + css)}" />`).join('')}\n</head>`) : template;
    return { file: resolve(dist, path === '/' ? 'index.html' : `${path.slice(1)}/index.html`), html: renderDocument(pageTemplate, renderEntry.renderPublicPage(path)) };
  });
  // Preserve a separate noindex shell. Ingress may use it only for known client
  // routes; never use public index.html as a blanket file/API fallback.
  const shell = template.replace('<!--zimage:root-->', '');
  await writeFile(resolve(dist, 'app.html'), shell);
  for (const { file, html } of files) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, html); }
  // The build graph is input to prerender only. Final release metadata is
  // generated separately; do not serve or hash this as a public payload file.
  await unlink(viteManifestPath);
  await unlink(resolve(dist, '.vite/source-snapshot.json'));
  await rmdir(resolve(dist, '.vite'));
  return files.map(({ file }) => file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const stage = { project: resolve(root, '../..'), snapshotPath: resolve(root, '.prerender/source-snapshot.json'), candidatePath: resolve(root, 'dist/.release/candidate.json'), namespace: process.env.ZIMAGE_ASSET_NAMESPACE };
  const snapshot = assertStageSource(stage);
  assertBuildSourceUnchanged(snapshot, readSourceSnapshot(resolve(root, 'dist/.vite/source-snapshot.json')));
  const files = await prerender({ dist: resolve(root, 'dist'), entry: resolve(root, '.prerender/entry.js') });
  assertStageSource(stage);
  process.stdout.write(`Prerendered ${files.length} public pages; client shell app.html\n`);
}
