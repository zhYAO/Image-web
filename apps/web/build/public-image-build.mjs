import { createHash } from 'node:crypto';
import { readFileSync, constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import path from 'node:path';
import { validatePublicImageBase } from './public-image-base.mjs';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const imagePolicyVersion = bytes => hash(Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n')));

export function readPinnedPublicImages() {
  const raw = readFileSync(new URL('../../../ops/aliyun/public-images.json', import.meta.url));
  const policy = JSON.parse(raw);
  const shared = JSON.parse(readFileSync(new URL('../features/commerce/public-image-paths.json', import.meta.url)));
  if (Object.keys(policy).sort().join(',') !== 'files,kind,schema' || policy.schema !== 1 || policy.kind !== 'public-images'
    || policy.files?.length !== 62 || policy.files.some(entry => Object.keys(entry).sort().join(',') !== 'bytes,contentType,path,sha256'
      || !/^commerce\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:jpg|webp)$/.test(entry.path)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > 16 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || entry.contentType !== (entry.path.endsWith('.jpg') ? 'image/jpeg' : 'image/webp'))
    || new Set(policy.files.map(entry => entry.path)).size !== 62
    || JSON.stringify(policy.files.map(entry => entry.path).sort()) !== JSON.stringify([...shared].sort())) throw new Error('Public image policies differ');
  return { files: policy.files, manifestSha256: imagePolicyVersion(raw) };
}

export function requirePinnedImageBase(raw, options) {
  const base = validatePublicImageBase(raw, options);
  const policy = readPinnedPublicImages();
  if (!base || new URL(base).pathname !== '/static-assets/' + policy.manifestSha256) throw new Error('Image base differs from the pinned image manifest');
  return { base, ...policy };
}

export const publicImageMetadataPath = 'public-image-contract.json';
export function publicImageContract(base) {
  const { files, manifestSha256 } = requirePinnedImageBase(base);
  return { schema: 1, baseUrl: base, manifestSha256, files };
}

export function validatePublicImageContract(value) {
  const expected = publicImageContract(value?.baseUrl);
  // Exact fields, ordered paths and per-file digests. A contract is identity,
  // not a claim of successful live acceptance or release authorization.
  if (!value || Object.keys(value).sort().join(',') !== 'baseUrl,files,manifestSha256,schema'
    || value.schema !== 1 || value.manifestSha256 !== expected.manifestSha256 || !Array.isArray(value.files) || value.files.length !== expected.files.length
    || value.files.some(file => !file || Object.keys(file).sort().join(',') !== 'bytes,contentType,path,sha256')
    || JSON.stringify(value.files.map(({ path, bytes, sha256, contentType }) => ({ path, bytes, sha256, contentType }))) !== JSON.stringify(expected.files)) {
    throw new Error('Public image contract differs from pinned policy');
  }
  return expected;
}

export function compiledPublicImageContract(config) {
  const env = config?.env ?? {};
  if (!env.ZIMAGE_PUBLIC_IMAGE_CONTRACT && !env.ZIMAGE_PUBLIC_IMAGE_BASE_URL) return undefined;
  if (typeof env.ZIMAGE_PUBLIC_IMAGE_CONTRACT !== 'string' || Buffer.byteLength(env.ZIMAGE_PUBLIC_IMAGE_CONTRACT) > 128 * 1024) throw new Error('Missing or oversized compiled public image contract');
  let value;
  try { value = JSON.parse(env.ZIMAGE_PUBLIC_IMAGE_CONTRACT); } catch { throw new Error('Missing compiled public image contract'); }
  const images = validatePublicImageContract(value);
  const patterns = [{ protocol: 'https', hostname: 'www.zimage.store', port: '',
    pathname: '/static-assets/' + images.manifestSha256 + '/commerce/**', search: '' }];
  if (env.ZIMAGE_PUBLIC_IMAGE_BASE_URL !== images.baseUrl
    || (env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL && env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL !== images.baseUrl)
    || !Array.isArray(config.images?.remotePatterns) || config.images.remotePatterns.length !== 1
    || Object.keys(config.images.remotePatterns[0]).sort().join(',') !== Object.keys(patterns[0]).sort().join(',')
    || Object.entries(patterns[0]).some(([key, value]) => config.images.remotePatterns[0][key] !== value)) throw new Error('Compiled public image configuration conflict');
  return images;
}

export async function verifyPublicImageSources(root, images) {
  validatePublicImageContract(images);
  for (const file of images.files) {
    let directory = root;
    for (const part of ['', ...file.path.split('/').slice(0, -1)]) {
      directory = path.join(directory, part);
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Public image source directory mismatch');
    }
    const target = path.join(root, file.path), original = await lstat(target);
    if (original.isSymbolicLink() || !original.isFile() || original.nlink !== 1) throw new Error('Public image source mismatch');
    const input = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await input.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size !== file.bytes
        || before.dev !== original.dev || before.ino !== original.ino) throw new Error('Public image source mismatch');
      const bytes = await input.readFile();
      const after = await input.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error('Public image source mismatch');
    } finally { await input.close(); }
  }
}

function immutablePublicCache(value) {
  const tokens = new Set(value.toLowerCase().split(',').map(token => token.trim()));
  return tokens.has('public') && tokens.has('immutable') && !['no-store', 'private', 'no-cache'].some(token => tokens.has(token))
    && [...tokens].some(token => /^max-age=\d+$/.test(token) && Number(token.slice(8)) >= 86400);
}

export async function verifyPublishedImages(raw, { request = globalThis.fetch } = {}) {
  const policy = requirePinnedImageBase(raw);
  const deadline = Date.now() + 150_000;
  // Cold TLS/proxy connections can exceed five seconds. Use bounded parallel
  // reads for the exact reviewed inventory; no partial result can be accepted.
  async function verifyOne(entry) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Public image acceptance failed: total-time-limit');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(20_000, remaining));
    try {
      const response = await request(policy.base + '/' + entry.path, { method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { 'Accept-Encoding': 'identity' }, signal: controller.signal });
      if (response.status !== 200 || response.redirected) throw new Error('http-status-or-redirect');
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== entry.contentType) throw new Error('image-mime');
      if (!['', 'identity'].includes((response.headers.get('content-encoding') ?? '').toLowerCase())) throw new Error('encoded-body');
      if (response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff'
        || !immutablePublicCache(response.headers.get('cache-control') ?? '')) throw new Error('response-policy');
      if (!response.body) throw new Error('missing-body');
      const reader = response.body.getReader();
      const digest = createHash('sha256'); let bytes = 0;
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          bytes += result.value.byteLength;
          if (bytes > entry.bytes) throw new Error('image-bytes');
          digest.update(result.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (bytes !== entry.bytes || digest.digest('hex') !== entry.sha256) throw new Error('image-bytes-or-sha256');
    } catch {
      // Fail closed without logging response bodies, credential-bearing errors or runtime configuration.
      throw new Error('Public image acceptance failed; keep the safe bundled mode');
    } finally { controller.abort(); clearTimeout(timer); }
  }
  await verifyOne(policy.files[0]); // Fail early before fan-out on a stale/missing namespace.
  const batchSize = 6;
  for (let index = 1; index < policy.files.length; index += batchSize) {
    await Promise.all(policy.files.slice(index, index + batchSize).map(verifyOne));
  }
  return { baseUrl: policy.base, manifestSha256: policy.manifestSha256, images: policy.files.length, allImagesVerified: true };
}

const verifiedInThisProcess = new Map();
export function verifyBuildPublicImages(base) {
  const policy = requirePinnedImageBase(base);
  const key = policy.base + ':' + policy.manifestSha256;
  // Only an actual successful check in this process is reusable; no persisted self-attested report is trusted.
  if (!verifiedInThisProcess.has(key)) verifiedInThisProcess.set(key, verifyPublishedImages(base));
  return verifiedInThisProcess.get(key);
}
