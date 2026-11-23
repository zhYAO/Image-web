import { beginWork, trackFinalizer } from '@/server/lifecycle/request-lifecycle';
import { compositeOnWhite, decodeRaster, fitCoverRaster, MAX_RASTER_PIXELS, opaqueRasterPng, orientRaster, whiteRaster, withRasterWork, writeRaster } from '../images/raster-engine';
import { ApiRouteError } from '@/server/api-error';
import { renderCommerceSafePng } from './commerce-safe-export';

export type ExportFormat = 'jpg' | 'png';
export interface ExportImage { name: string; bytes: Uint8Array; width: number; height: number }

export async function renderCommerceImage(source: Uint8Array, format: ExportFormat, target?: { width: number; height: number }, focus = { x: 0.5, y: 0.5 }, safeExport?: 'ec03-white-8'): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  if (safeExport) {
    if (format !== 'png' || target) throw new ApiRouteError({ code: 'bad_request', status: 400, retryable: false, message: '安全导出只支持无裁切的单张 PNG。' });
    return renderCommerceSafePng(source);
  }
  return withRasterWork(async () => {
    const { pixels, meta } = await decodeRaster(source);
    const oriented = orientRaster(pixels, meta.orientation);
    const output = target ? fitCoverRaster(oriented, target.width, target.height, focus) : oriented;
    return { bytes: await writeRaster(output, format), width: output.width, height: output.height };
  });
}

export async function stitchCommerceImages(images: ExportImage[], format: ExportFormat) {
  if (!images.length) throw new Error('empty_export');
  if (images.some(({width,height}) => !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)) throw new Error('invalid_image_dimensions');
  const width = Math.max(...images.map(image => image.width));
  const height = images.reduce((sum, image) => sum + image.height, 0);
  if (width > 8192 || height > 60000 || width * height > MAX_RASTER_PIXELS) throw new Error('long_image_too_large');
  return withRasterWork(async () => {
    const canvas = whiteRaster(width, height);
    let top = 0;
    for (const image of images) {
      const {pixels,meta} = await decodeRaster(image.bytes);
      const oriented = orientRaster(pixels,meta.orientation);
      if (oriented.width !== image.width || oriented.height !== image.height) throw new Error('invalid_image_dimensions');
      compositeOnWhite(canvas, oriented, 0, top);
      top += image.height;
    }
    return format === 'png' ? opaqueRasterPng(canvas) : writeRaster(canvas, format);
  });
}

// ZIP STORE keeps generated JPG/PNG bytes intact and avoids a second quality loss.
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipCommerceImages(files: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const checksum = crc32(file.bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(file.bytes.length, 18); local.writeUInt32LE(file.bytes.length, 22); local.writeUInt16LE(name.length, 26);
    local.set(name, 30);
    const directory = Buffer.alloc(46 + name.length);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(file.bytes.length, 20); directory.writeUInt32LE(file.bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    directory.set(name, 46);
    chunks.push(local, file.bytes); central.push(directory);
    offset += local.length + file.bytes.length;
  }
  const directoryBytes = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directoryBytes, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

export function zipCommerceStream(files: AsyncIterable<{ name: string; bytes: Uint8Array }>): ReadableStream<Uint8Array> {
  async function* chunks() {
    const directory: Uint8Array[] = [];
    let offset = 0, count = 0;
    for await (const file of files) {
      const name = new TextEncoder().encode(file.name);
      const checksum = crc32(file.bytes);
      const local = Buffer.alloc(30 + name.length);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
      local.writeUInt32LE(checksum, 14); local.writeUInt32LE(file.bytes.length, 18); local.writeUInt32LE(file.bytes.length, 22); local.writeUInt16LE(name.length, 26); local.set(name, 30);
      const central = Buffer.alloc(46 + name.length);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
      central.writeUInt32LE(checksum, 16); central.writeUInt32LE(file.bytes.length, 20); central.writeUInt32LE(file.bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); central.set(name, 46);
      yield local; yield file.bytes; directory.push(central);
      offset += local.length + file.bytes.length; count++;
    }
    const directoryBytes = directory.reduce((sum, chunk) => sum + chunk.length, 0);
    for (const chunk of directory) yield chunk;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directoryBytes, 12); end.writeUInt32LE(offset, 16);
    yield end;
  }
  const iterator = chunks();
  const endExport = beginWork('activeExports');
  const closeIterator = () => trackFinalizer(async () => {
    try { await iterator.return(undefined); } finally { endExport(); }
  });
  return new ReadableStream({
    async pull(controller) {
      try { const result = await iterator.next(); if (result.done) { controller.close(); endExport(); } else controller.enqueue(result.value); }
      catch (cause) { try { await closeIterator(); } finally { controller.error(cause); } }
    },
    async cancel() { await closeIterator(); },
  });
}
