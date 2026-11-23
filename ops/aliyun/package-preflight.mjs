import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const within = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };

export async function validateCandidateLinks(candidate, archiveExclusions = []) {
  const root = await realpath(candidate);
  const excludedPaths = new Set(archiveExclusions.map(entry => path.resolve(root, entry)));
  const excludedTargets = new Set(await Promise.all([...excludedPaths].map(file => realpath(file))));
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) {
        const target = await readlink(file);
        if (path.isAbsolute(target) || path.win32.isAbsolute(target) || !within(root, path.resolve(directory, target)))
          throw new Error(`Non-portable or escaping release link: ${file} -> ${target}`);
        let resolved;
        try { resolved = await realpath(file); }
        catch (error) { throw new Error(`Dangling or cyclic release link: ${file} -> ${target}`, { cause: error }); }
        if (!within(root, resolved)) throw new Error(`Escaping release link chain: ${file} -> ${resolved}`);
        if (!excludedPaths.has(file) && excludedTargets.has(resolved))
          throw new Error(`Release link targets archive-excluded file: ${file} -> ${resolved}`);
      } else if (stat.isDirectory()) await walk(file);
    }
  }
  await walk(root);
}

// Run from apps/web with no inherited Node configuration or application secrets.
// Restrict CommonJS resolution before loading Sharp, including its transitive native imports.
const nativeProbe = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = fs.realpathSync(process.argv[1]);
const inside = file => { const r = path.relative(root, fs.realpathSync(file)); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
const original = Module._resolveFilename;
Module._resolveFilename = function (...args) {
  const resolved = original.apply(this, args);
  if (!Module.isBuiltin(resolved) && !inside(resolved)) throw new Error('Dependency resolved outside release: ' + resolved);
  return resolved;
};
(async () => {
  const req = Module.createRequire(path.join(root, 'apps/web/package.json'));
  const sharp = req('sharp');
  const codecs = [];
  for (const format of ['jpeg', 'webp', 'avif']) {
    const encoded = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } })[format]().toBuffer();
    const { info, data } = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 2 || info.height !== 2 || data.length < 12) throw new Error(format + ' round trip failed');
    codecs.push(format);
  }
  const native = Object.keys(require.cache).filter(file => file.endsWith('.node'));
  if (!native.length) throw new Error('Sharp did not load a native dependency');
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch,
    libc: process.platform === 'linux' ? (process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl') : null,
    codecs, native: native.map(file => path.relative(root, file)) }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
`;

export async function preflightCandidate(candidate, archiveExclusions = []) {
  await validateCandidateLinks(candidate, archiveExclusions);
  return probeCandidateSharp(candidate);
}

export async function probeCandidateSharp(candidate) {
  const root = await realpath(candidate);
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(process.execPath, ['-e', nativeProbe, root], {
    cwd: path.join(root, 'apps/web'), env, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Sharp native preflight failed for ${process.platform}/${process.arch}. Rebuild the standalone package with its host-native Sharp dependency and package-internal aliases. ${result.error?.message || result.stderr?.trim() || 'Probe failed'}`);
  try { return JSON.parse(result.stdout.trim()); }
  catch (error) { throw new Error('Sharp native preflight failed: invalid probe report', { cause: error }); }
}

// Explicit model-only preflight. Staged codecs and bytes must resolve inside the
// release; a missing or host-supplied codec is never equivalent to the old native probe.
export async function probeCandidateWasm(candidate, archiveExclusions = []) {
  const root = await realpath(candidate);
  await validateCandidateLinks(root, archiveExclusions);
  const require = createRequire(path.join(root, 'apps/web/package.json'));
  const binaries = new Map();
  async function get(entry, binary) {
    const moduleFile = await realpath(require.resolve(entry));
    const wasmFile = await realpath(require.resolve(binary));
    if (!within(root, moduleFile) || !within(root, wasmFile)) throw new Error('Codec resolved outside candidate: ' + entry);
    let compiled = binaries.get(wasmFile);
    if (!compiled) {
      compiled = WebAssembly.compile(await readFile(wasmFile));
      binaries.set(wasmFile, compiled);
    }
    const codec = await import(pathToFileURL(moduleFile).href);
    await codec.init(await compiled);
    return codec.default;
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  }
  const encJpeg = await get('@jsquash/jpeg/encode.js', '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm');
  const decJpeg = await get('@jsquash/jpeg/decode.js', '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm');
  const encPng = await get('@jsquash/png/encode.js', '@jsquash/png/codec/pkg/squoosh_png_bg.wasm');
  const decPng = await get('@jsquash/png/decode.js', '@jsquash/png/codec/pkg/squoosh_png_bg.wasm');
  const decWebp = await get('@jsquash/webp/decode.js', '@jsquash/webp/codec/dec/webp_dec.wasm');
  const image = { width: 2, height: 2, data: new Uint8ClampedArray([51,102,153,255,51,102,153,255,51,102,153,255,51,102,153,255]) };
  const webp = Uint8Array.from(Buffer.from('UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoCAAIAAUAmJaACdLoB+AAETAAA/u+9V/43bjDfgu/33oDeBgAAAA==','base64')).buffer;
  for (const [name, output] of [
    ['jpeg', await decJpeg(await encJpeg(image,{quality:92}))],
    ['png', await decPng(await encPng(image))],
    ['webp', await decWebp(webp)],
  ]) {
    if (output.width !== 2 || output.height !== 2 || output.data.length !== 16 || output.data[3] !== 255)
      throw new Error('Candidate WASM codec failed: ' + name);
  }
  return { platform: process.platform, arch: process.arch, engine: 'jsquash',
    codecs: ['jpeg', 'png', 'webp'], wasm: [...binaries.keys()].map(file => path.relative(root, file)), native: [] };
}
