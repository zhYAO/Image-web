import { readFile } from 'node:fs/promises';
import { dirname, extname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regularFiles } from './static-files.mjs';
import { assertStageSource } from './build-source-identity.mjs';
import { validateCandidateMetadata } from './candidate-metadata.mjs';

const resourceExtension = /\.(?:js|mjs|css|webp|png|jpe?g|gif|svg|ico|woff2?)(?:[?#].*)?$/i;
const allowed = /\.(?:html|js|mjs|css|webp|png|jpe?g|gif|svg|ico|json|md|txt)$/i;
const forbiddenMarker = /SUPABASE_SERVICE_ROLE_KEY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|next\/dist|__NEXT_DATA__|require\(["']sharp["']\)|NEXT_PUBLIC_(?:PHASE2_AUTH|DATA_MODE|TURNSTILE_SITE_KEY)/;

function resourcePath(value, owner, namespace) {
  if (!value || value.startsWith('#') || /^(?:data:|blob:|https?:|\/\/)/i.test(value) || value.includes('${')) return null;
  if (!resourceExtension.test(value)) return null;
  let path;
  try { path = decodeURIComponent(value.split(/[?#]/)[0]); } catch { throw new Error('Invalid static resource URL'); }
  if (path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('Invalid static resource URL');
  if (path.startsWith('/frontend-assets/')) {
    const prefix = `/frontend-assets/${namespace}/`;
    if (!path.startsWith(prefix)) throw new Error('Unexpected frontend namespace');
    path = path.slice(prefix.length);
  } else if (path.startsWith('/')) {
    if (!path.startsWith('/commerce/')) throw new Error('Unversioned static resource URL');
    path = path.slice(1);
  } else if (path.startsWith('assets/')) {
    // Vite's preload table paths are relative to the output root.
  } else path = posix.join(posix.dirname(owner), path);
  const normalized = posix.normalize(path);
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized.split('/').some(part => part.startsWith('.'))) throw new Error('Escaping static resource URL');
  return normalized;
}

/** Local resource closure and browser-payload checks; not a release authorization. */
export async function checkStaticResources({ dist, namespace }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(namespace ?? '')) throw new Error('Explicit namespace required');
  const files = await regularFiles(dist);
  const names = new Set(files.map(file => file.path));
  if (!names.has('.release/candidate.json')) throw new Error('Missing frontend candidate metadata');
  if (!names.has('index.html')) throw new Error('Missing static homepage');
  for (const file of files) {
    const internal = file.path === '.release/candidate.json';
    if (file.path.startsWith('.release/') && !internal) throw new Error('Unexpected frontend candidate metadata file');
    if (internal) {
      if (file.bytes > 128 * 1024) throw new Error('Oversized frontend candidate metadata');
      const content = await readFile(resolve(dist, file.path), 'utf8');
      if (forbiddenMarker.test(content)) throw new Error('Forbidden browser payload marker');
      validateCandidateMetadata(JSON.parse(content), namespace);
      continue;
    }
    if ((!internal && file.path.split('/').some(part => part.startsWith('.'))) || !allowed.test(file.path) || /(?:^|\/)(?:node_modules|server|fonts)(?:\/|$)/.test(file.path)) throw new Error('Forbidden static payload file');
    if (!['.html', '.js', '.mjs', '.css', '.json'].includes(extname(file.path))) continue;
    const content = await readFile(resolve(dist, file.path), 'utf8');
    if (forbiddenMarker.test(content) || /sourceMappingURL\s*=/.test(content)) throw new Error('Forbidden browser payload marker');
    const references = [];
    if (file.path.endsWith('.html')) {
      for (const match of content.matchAll(/\b(?:src|href|poster)=["']([^"']+)["']/gi)) references.push(match[1].replaceAll('&amp;', '&'));
      for (const match of content.matchAll(/\bsrcset=["']([^"']+)["']/gi)) references.push(...match[1].split(',').map(item => item.trim().split(/\s+/)[0]));
    } else if (file.path.endsWith('.css')) {
      for (const match of content.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)|@import\s+["']([^"']+)["']/g)) references.push(match[1] ?? match[2]);
    } else if (/\.m?js$/.test(file.path)) {
      for (const match of content.matchAll(/["']((?:\.{1,2}\/|\/frontend-assets\/|\/commerce\/|assets\/)[^"'\n]+)["']/g)) references.push(match[1]);
    }
    for (const reference of references) {
      const target = resourcePath(reference, file.path, namespace);
      if (target && !names.has(target)) throw new Error(`Missing static resource: ${target}`);
    }
  }
  const payload = files.filter(file => file.path !== '.release/candidate.json');
  return { files: payload.length, bytes: payload.reduce((sum, file) => sum + file.bytes, 0) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const stage = { project: resolve(root, '../..'), snapshotPath: resolve(root, '.prerender/source-snapshot.json'), candidatePath: resolve(root, 'dist/.release/candidate.json'), namespace: process.env.ZIMAGE_ASSET_NAMESPACE };
  assertStageSource(stage);
  const result = await checkStaticResources({ dist: resolve(root, 'dist'), namespace: process.env.ZIMAGE_ASSET_NAMESPACE });
  assertStageSource(stage);
  process.stdout.write(JSON.stringify(result) + '\n');
}
