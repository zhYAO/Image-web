import { deflateSync } from 'node:zlib';
import { crc32, inspectRaster, InvalidRaster, type RasterLimits } from './raster-header.ts';
import { decodeRasterPixels, encodeRasterPixels, type RasterPixels } from './raster-codecs.mjs';

export const MAX_RASTER_BYTES = 20 * 1024 * 1024;
export const MAX_RASTER_PIXELS = 36_000_000;
export const MAX_RASTER_EDGE = 16_384;
export const RASTER_LIMITS = { maxBytes: MAX_RASTER_BYTES, maxPixels: MAX_RASTER_PIXELS, maxEdge: MAX_RASTER_EDGE };

let active = false;
const waiters: Array<() => void> = [];
export async function withRasterWork<T>(work: () => Promise<T>): Promise<T> {
  if (active) {
    if (waiters.length >= 2) throw new Error('image_worker_busy');
    await new Promise<void>(resolve => waiters.push(resolve));
  } else active = true;
  try { return await work(); } finally {
    const next = waiters.shift();
    if (next) next(); else active = false;
  }
}

export async function decodeRaster(bytes: Uint8Array, limits: RasterLimits = RASTER_LIMITS) {
  const info = inspectRaster(bytes, limits);
  const image = await decodeRasterPixels(bytes, info.format);
  const size = info.width * info.height * 4;
  if (image.width !== info.width || image.height !== info.height || image.data.length !== size) throw new InvalidRaster('invalid');
  return { meta: info, pixels: image };
}

function allocate(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_RASTER_PIXELS) {
    throw new InvalidRaster('too-large');
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function orientRaster(input: RasterPixels, orientation: number) {
  if (orientation === 1) return input;
  const w = input.width, h = input.height;
  const output = orientation >= 5 ? allocate(h, w) : allocate(w, h);
  for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    let sx = x, sy = y;
    switch (orientation) {
      case 2: sx = w - 1 - x; break;
      case 3: sx = w - 1 - x; sy = h - 1 - y; break;
      case 4: sy = h - 1 - y; break;
      case 5: sx = y; sy = x; break;
      case 6: sx = y; sy = h - 1 - x; break;
      case 7: sx = w - 1 - y; sy = h - 1 - x; break;
      case 8: sx = w - 1 - y; sy = x; break;
    }
    const src = (sy * w + sx) * 4, dst = (y * output.width + x) * 4;
    for (let c = 0; c < 4; c++) output.data[dst + c] = input.data[src + c]!;
  }
  return output;
}

function sample(input: RasterPixels, output: RasterPixels, scaleX: number, scaleY: number, left: number, top: number) {
  const { width, height, data } = input;
  const out = output.data;
  for (let y = 0; y < output.height; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + top + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy), fy = sy - y0, y1 = Math.min(height - 1, y0 + 1);
    for (let x = 0; x < output.width; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + left + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(width - 1, x0 + 1);
      const i = (y0 * width + x0) * 4, j = (y0 * width + x1) * 4, k = (y1 * width + x0) * 4, l = (y1 * width + x1) * 4;
      const ai = (1 - fx) * (1 - fy) * data[i + 3]!;
      const aj = fx * (1 - fy) * data[j + 3]!;
      const ak = (1 - fx) * fy * data[k + 3]!;
      const al = fx * fy * data[l + 3]!;
      const a = ai + aj + ak + al, offset = (y * output.width + x) * 4;
      out[offset + 3] = a;
      if (a) for (let channel = 0; channel < 3; channel++) {
        out[offset + channel] = (ai * data[i + channel]! + aj * data[j + channel]! + ak * data[k + channel]! + al * data[l + channel]!) / a;
      }
    }
  }
  return output;
}

export function fitInsideRaster(source: RasterPixels, width: number, height: number, enlarge = true) {
  if (width < 1 || height < 1) throw new InvalidRaster('invalid');
  const scale = Math.min(width / source.width, height / source.height, enlarge ? Infinity : 1);
  const w = Math.max(1, Math.min(width, Math.round(source.width * scale)));
  const h = Math.max(1, Math.min(height, Math.round(source.height * scale)));
  if (w === source.width && h === source.height) return source;
  return sample(source, allocate(w, h), source.width / w, source.height / h, 0, 0);
}

export function fitCoverRaster(source: RasterPixels, width: number, height: number, focus: {x:number; y:number}) {
  const scale = Math.max(width / source.width, height / source.height);
  const w = Math.ceil(source.width * scale), h = Math.ceil(source.height * scale);
  const clamp = (v: number) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  const left = Math.round((w - width) * clamp(focus.x)), top = Math.round((h - height) * clamp(focus.y));
  // Compose resampling and crop without materializing a huge virtual canvas.
  return sample(source, allocate(width, height), source.width / w, source.height / h, left, top);
}

export function whiteRaster(width: number, height: number) {
  const canvas = allocate(width, height);
  canvas.data.fill(255);
  return canvas;
}

export function compositeOnWhite(canvas: RasterPixels, source: RasterPixels, left: number, top: number) {
  if (left < 0 || top < 0 || left + source.width > canvas.width || top + source.height > canvas.height) throw new InvalidRaster('invalid');
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const src = (y * source.width + x) * 4, dst = ((y + top) * canvas.width + x + left) * 4;
    const alpha = source.data[src + 3]! / 255;
    for (let c = 0; c < 3; c++) canvas.data[dst + c] = 255 + (source.data[src + c]! - 255) * alpha;
  }
}

function pngChunk(type: string, data: Buffer) {
  const out = Buffer.allocUnsafe(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}

export function opaqueRasterPng(image: RasterPixels) {
  const { width, height, data } = image;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // RGB without alpha, required by EC03.
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 4, dst = y * row + 1 + x * 3;
    raw[dst] = data[src]!; raw[dst + 1] = data[src + 1]!; raw[dst + 2] = data[src + 2]!;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

export async function writeRaster(image: RasterPixels, format: 'jpg' | 'png') {
  return encodeRasterPixels(image, format === 'jpg' ? 'jpeg' : 'png', 92);
}
