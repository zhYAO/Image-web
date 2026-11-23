import { compositeOnWhite, decodeRaster, fitInsideRaster, opaqueRasterPng, orientRaster, whiteRaster, withRasterWork } from '../images/raster-engine';
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
    return await withRasterWork(async () => {
      const {pixels,meta} = await decodeRaster(source, {maxPixels:MAX_PIXELS, maxEdge:MAX_EDGE, maxBytes:MAX_BYTES});
      const oriented = orientRaster(pixels,meta.orientation);
      const {width,height} = oriented;
      const innerWidth = width - 2 * Math.ceil(width * .08), innerHeight = height - 2 * Math.ceil(height * .08);
      if (innerWidth < 1 || innerHeight < 1) throw invalidSafeImage();
      const resized = fitInsideRaster(oriented,innerWidth,innerHeight);
      const canvas = whiteRaster(width,height);
      compositeOnWhite(canvas,resized,Math.floor((width-resized.width)/2),Math.floor((height-resized.height)/2));
      return {bytes: opaqueRasterPng(canvas),width,height};
    });
  } catch (error) {
    if (error instanceof ApiRouteError) throw error;
    throw invalidSafeImage();
  }
}
