import sharp from 'sharp';
import { ApiRouteError } from '@/server/api-error';

// Only the explicit EC03 export uses these bounds. Ordinary exports keep their contract.
const MAX_PIXELS = 2048 * 2048;
const MAX_EDGE = 4096;
const MAX_BYTES = 20 * 1024 * 1024;

function invalidSafeImage() {
  return new ApiRouteError({ code: 'bad_request', status: 400, retryable: false,
    message: '安全导出仅支持不超过 20MB、可解码的单帧、2K 范围图片（最多 4194304 像素，单边最多 4096 像素）；图片尺寸也须足够补边。' });
}

export async function readCommerceSafeSource(response: Response): Promise<Uint8Array> {
  if (!response.body) throw invalidSafeImage();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw invalidSafeImage();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally { reader.releaseLock(); }
}

export async function renderCommerceSafePng(source: Uint8Array) {
  if (source.byteLength > MAX_BYTES) throw invalidSafeImage();
  try {
    const image = sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'warning' }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) !== 1 || meta.width * meta.height > MAX_PIXELS || Math.max(meta.width, meta.height) > MAX_EDGE) throw invalidSafeImage();
    const rotated = meta.orientation && meta.orientation >= 5 && meta.orientation <= 8;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    const marginX = Math.ceil(width * .08), marginY = Math.ceil(height * .08);
    const innerWidth = width - marginX * 2, innerHeight = height - marginY * 2;
    if (innerWidth < 1 || innerHeight < 1) throw invalidSafeImage();
    // Fit the entire bitmap. Use Sharp's actual dimensions to centre integer pixels.
    const resized = await image.resize(innerWidth, innerHeight, { fit: 'inside' })
      .flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const left = Math.floor((width - resized.info.width) / 2);
    const top = Math.floor((height - resized.info.height) / 2);
    const bytes = await sharp({ create: { width, height, channels: 3, background: '#ffffff' }, limitInputPixels: MAX_PIXELS })
      .composite([{ input: resized.data, raw: { width: resized.info.width, height: resized.info.height, channels: resized.info.channels }, left, top }])
      .removeAlpha().png().toBuffer();
    return { bytes, width, height };
  } catch (error) {
    if (error instanceof ApiRouteError) throw error;
    throw invalidSafeImage();
  }
}
