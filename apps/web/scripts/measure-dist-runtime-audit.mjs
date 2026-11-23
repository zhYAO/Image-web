// Opt-in, read-only attribution for the deploy file set measured by measure-dist.
// NFT lists contain membership, not a direct import/require causation chain.
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const posix = file => file.split(path.sep).join('/');
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const sizeOrder = (a, b) => b.bytes - a.bytes || compare(a.name, b.name);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const maxTraceBytes = 8 * 1024 * 1024;
const maxTraceRecords = 1_000_000;
const maxTraceManifests = 5000;

function identity(file) {
  const parts = file.split('/');
  const begin = parts.lastIndexOf('node_modules') + 1;
  if (!begin || !parts[begin] || parts[begin].startsWith('.')) return { name: '(unowned node_modules metadata)', subpath: file };
  const width = parts[begin].startsWith('@') ? 2 : 1;
  if (parts.length <= begin + width - 1) return { name: '(unowned node_modules metadata)', subpath: file };
  return {
    name: parts.slice(begin, begin + width).join('/'),
    subpath: parts.slice(begin + width).join('/'),
    instance: parts.slice(0, begin + width).join('/'),
  };
}

function nextSubtree(subpath) {
  const parts = subpath.split('/');
  if (parts[0] !== 'dist') return parts.length > 1 ? parts[0] : '(package entry files)';
  if (parts.length < 3) return 'dist/(entry files)';
  const [, section, branch, file] = parts;
  // Expose individually bundled subsystems, not one giant dist/server bucket.
  if (section === 'compiled' || section === 'esm') return parts.slice(0, 3).join('/');
  if (section === 'server') return parts.slice(0, branch === 'lib' && file && parts.length > 4 ? 4 : parts.length > 3 ? 3 : 2).join('/');
  return parts.slice(0, 2).join('/');
}

async function traceManifestFiles(dist) {
  const paths = [];
  async function consider(relative, absolute, directory) {
    // Avoid symlinks and follow only actual build server directories (no cache).
    const st = await lstat(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (directory && st?.isDirectory() && !st.isSymbolicLink()) {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.nft.json'))) {
          await consider(relative + '/' + entry.name, path.join(absolute, entry.name), entry.isDirectory());
        }
      }
    } else if (st?.isFile() && !st.isSymbolicLink() && relative.endsWith('.nft.json')) {
      paths.push({ relative, absolute, bytes: st.size });
      if (paths.length > maxTraceManifests) throw new Error('Runtime audit trace manifest limit exceeded');
    }
  }
  for (const entry of await readdir(dist, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.nft.json') || entry.isDirectory() && entry.name === 'server') {
      await consider(entry.name, path.join(dist, entry.name), entry.isDirectory());
    }
  }
  return paths.sort((a, b) => compare(a.relative, b.relative));
}

async function matchTraces(dist, traceRoot, deploy) {
  const ownerByPath = new Map();
  const resolved = new Map();
  const aliases = await realpath(traceRoot);
  const summary = { manifestsFound: 0, manifestsRead: 0, inputEntries: 0, ignoredOutsideRoot: 0, invalidEntries: 0, unmatchedEntries: 0, manifestErrors: [] };
  const manifests = await traceManifestFiles(dist);
  summary.manifestsFound = manifests.length;
  for (const manifest of manifests) {
    let trace;
    try {
      if (manifest.bytes > maxTraceBytes) throw new Error('oversize');
      trace = JSON.parse(await readFile(manifest.absolute, 'utf8'));
      if (!trace || !Array.isArray(trace.files) || trace.version !== 1) throw new Error('format');
    } catch {
      // Report the relative owner only, no host paths / raw manifest contents.
      summary.manifestErrors.push(manifest.relative);
      continue;
    }
    summary.manifestsRead++;
    for (const entry of new Set(trace.files)) {
      if (++summary.inputEntries > maxTraceRecords) throw new Error('Runtime audit trace record limit exceeded');
      if (typeof entry !== 'string' || !entry || entry.includes('\0') || entry.includes('\\') || path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry)) {
        summary.invalidEntries++;
        continue;
      }
      const source = path.resolve(path.dirname(manifest.absolute), entry);
      if (!within(traceRoot, source)) { summary.ignoredOutsideRoot++; continue; }
      const direct = posix(path.relative(traceRoot, source));
      let matched = deploy.has(direct) ? direct : null;
      if (!matched && direct.split('/').includes('node_modules')) {
        if (!resolved.has(source)) {
          const real = await realpath(source).catch(error => ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code) ? null : Promise.reject(error));
          resolved.set(source, real && within(aliases, real) ? posix(path.relative(aliases, real)) : null);
        }
        const canonical = resolved.get(source);
        if (deploy.has(canonical)) matched = canonical;
      }
      if (!matched) { summary.unmatchedEntries++; continue; }
      const owners = ownerByPath.get(matched) ?? new Set();
      owners.add(manifest.relative);
      ownerByPath.set(matched, owners);
    }
  }
  return { summary, ownerByPath };
}

export async function runtimeDependencyAudit(files, { dist, traceRoot }) {
  const deploy = new Map(files.map(file => [file.path, file.bytes]));
  const { summary, ownerByPath } = await matchTraces(dist, traceRoot, deploy);
  const groups = new Map();
  const next = new Map();
  const largestNext = [];
  for (const [file, bytes] of deploy) {
    const { name, subpath, instance } = identity(file);
    const owners = [...(ownerByPath.get(file) ?? [])].sort(compare);
    const pack = groups.get(name) ?? { name, bytes: 0, files: 0, attributedBytes: 0, instances: new Set(), owners: new Map() };
    pack.bytes += bytes;
    pack.files++;
    if (instance) pack.instances.add(instance);
    if (owners.length) pack.attributedBytes += bytes;
    for (const owner of owners) pack.owners.set(owner, (pack.owners.get(owner) ?? 0) + bytes);
    groups.set(name, pack);
    if (name === 'next') {
      const bucket = nextSubtree(subpath);
      const tree = next.get(bucket) ?? { name: bucket, bytes: 0, files: 0, attributedBytes: 0, owners: new Map() };
      tree.bytes += bytes; tree.files++;
      if (owners.length) tree.attributedBytes += bytes;
      for (const owner of owners) tree.owners.set(owner, (tree.owners.get(owner) ?? 0) + bytes);
      next.set(bucket, tree);
      largestNext.push({ name: file, bytes, tracedBy: owners });
    }
  }
  function entries(map) {
    return [...map.values()].map(({ owners, instances, ...group }) => ({
      ...group,
      ...(instances ? { instances: [...instances].sort(compare) } : {}),
      // Owner sizes overlap, while group bytes always count a deploy path once.
      traceOwners: [...owners.entries()].map(([name, bytes]) => ({ name, bytes })).sort(sizeOrder),
    })).sort(sizeOrder);
  }
  return {
    method: 'Unique deployed regular path bytes; NFT trace presence is attribution, not proof of necessity or an import reason. Owner bytes overlap. Unattributed files are not automatically removable.',
    runtimeBytes: [...deploy.values()].reduce((sum, bytes) => sum + bytes, 0),
    runtimeFiles: deploy.size,
    trace: summary,
    packages: entries(groups),
    nextSubtrees: entries(next),
    largestNextFiles: largestNext.sort(sizeOrder).slice(0, 25),
  };
}
