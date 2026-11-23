import { decodeRaster, RASTER_LIMITS, withRasterWork } from '../images/raster-engine';
import type { RasterFormat } from '../images/raster-header';

import { ApiRouteError } from '@/server/api-error';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 16_384;

const allowedExtensions: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

interface ReferenceUploadInput {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
  size: number;
}

function invalidUpload(message: string) {
  return new ApiRouteError({
    code: 'bad_request',
    details: { field: 'file' },
    message,
    retryable: false,
    status: 400,
  });
}

function hasExpectedMagic(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

export async function validateReferenceUpload(input: ReferenceUploadInput) {
  if (!input.name.trim() || input.name.length > 255) {
    throw invalidUpload('参考图文件名长度无效。');
  }
  if (input.size < 1 || input.size > MAX_UPLOAD_BYTES || input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw invalidUpload('参考图必须小于或等于 10 MB。');
  }

  const extension = input.name.split('.').at(-1)?.toLowerCase() ?? '';
  const extensions = allowedExtensions[input.mimeType];
  if (!extensions?.includes(extension) || !hasExpectedMagic(input.bytes, input.mimeType)) {
    throw invalidUpload('仅支持内容与扩展名一致的 PNG、JPEG 或 WebP 图片。');
  }

  try {
    const { meta: metadata } = await withRasterWork(() => decodeRaster(input.bytes, {
      ...RASTER_LIMITS, maxBytes: MAX_UPLOAD_BYTES, maxEdge: MAX_DIMENSION,
      expectedFormat: input.mimeType.slice(6) as RasterFormat,
    }));
    return {
      extension: extension === 'jpeg' ? 'jpg' : extension,
      height: metadata.height,
      width: metadata.width,
    };
  } catch (error: unknown) {
    if (error instanceof ApiRouteError) throw error;
    throw invalidUpload('参考图损坏或无法安全解码。');
  }
}
