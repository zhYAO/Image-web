import type { RasterFormat } from './raster-header';
export interface RasterPixels { width: number; height: number; data: Uint8ClampedArray }
export function decodeRasterPixels(bytes: Uint8Array, format: RasterFormat): Promise<RasterPixels>;
export function encodeRasterPixels(pixels: RasterPixels, format: 'jpeg' | 'png', quality?: number): Promise<Buffer>;
