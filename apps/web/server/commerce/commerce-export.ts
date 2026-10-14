import sharp from 'sharp';
import { ApiRouteError } from '@/server/api-error';
import { renderCommerceSafePng } from './commerce-safe-export';

export type ExportFormat = 'jpg' | 'png';
export interface ExportImage { name: string; bytes: Uint8Array; width: number; height: number }

export async function renderCommerceImage(source: Uint8Array, format: ExportFormat, target?: { width: number; height: number }, focus = { x: 0.5, y: 0.5 }, safeExport?: 'ec03-white-8'): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  if (safeExport) {
    if (format !== 'png' || target) throw new ApiRouteError({ code: 'bad_request', status: 400, retryable: false, message: '安全导出只支持无裁切的单张 PNG。' });
    return renderCommerceSafePng(source);
  }
  const image = sharp(source, { limitInputPixels: 100_000_000 }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('invalid_image_dimensions');
  const rotated = meta.orientation && meta.orientation >= 5 && meta.orientation <= 8;
  const sourceWidth = rotated ? meta.height : meta.width;
  const sourceHeight = rotated ? meta.width : meta.height;
  let transformed = image;
  if (target) {
    const scale = Math.max(target.width / sourceWidth, target.height / sourceHeight);
    const scaledWidth = Math.ceil(sourceWidth * scale);
    const scaledHeight = Math.ceil(sourceHeight * scale);
    const left = Math.max(0, Math.min(scaledWidth - target.width, Math.round((scaledWidth - target.width) * focus.x)));
    const top = Math.max(0, Math.min(scaledHeight - target.height, Math.round((scaledHeight - target.height) * focus.y)));
    transformed = transformed.resize(scaledWidth, scaledHeight).extract({ left, top, width: target.width, height: target.height });
  }
  const bytes = await (format === 'png' ? transformed.png() : transformed.jpeg({ quality: 92 })).toBuffer();
  return { bytes, width: target?.width ?? sourceWidth, height: target?.height ?? sourceHeight };
}

export async function stitchCommerceImages(images: ExportImage[], format: ExportFormat) {
  if (!images.length) throw new Error('empty_export');
  const width = Math.max(...images.map(image => image.width));
  const height = images.reduce((sum, image) => sum + image.height, 0);
  if (width > 8192 || height > 60000 || width * height > 150_000_000) throw new Error('long_image_too_large');
  const composites = images.map((image, index) => ({ input: Buffer.from(image.bytes), left: 0, top: images.slice(0, index).reduce((sum, previous) => sum + previous.height, 0) }));
  const output = sharp({ create: { width, height, channels: 3, background: '#ffffff' }, limitInputPixels: 150_000_000 }).composite(composites);
  return format === 'png' ? output.png().toBuffer() : output.jpeg({ quality: 92 }).toBuffer();
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
  return new ReadableStream({
    async pull(controller) {
      try { const result = await iterator.next(); if (result.done) controller.close(); else controller.enqueue(result.value); }
      catch (cause) { controller.error(cause); }
    },
    async cancel() { await iterator.return(undefined); },
  });
}
