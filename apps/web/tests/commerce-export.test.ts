import { describe, expect, it } from 'vitest';
import { solid, rgb } from './raster-fixture';
import { decodeRaster } from '@/server/images/raster-engine';
import { renderCommerceImage, stitchCommerceImages, zipCommerceImages } from '@/server/commerce/commerce-export';

describe('commerce exports', () => {
  it('renders exact A+ pixels without stretching the source, then stitches in slot order', async () => {
    const red = await solid(400, 400, '#e00000');
    const blue = await solid(400, 400, '#0000e0');
    const first = await renderCommerceImage(red, 'png', { width: 970, height: 600 });
    const second = await renderCommerceImage(blue, 'png', { width: 970, height: 600 });
    expect([first.width, first.height]).toEqual([970, 600]);
    expect((await decodeRaster(first.bytes)).meta).toMatchObject({ width: 970, height: 600 });
    const long = await stitchCommerceImages([{ ...first, name: '01.png' }, { ...second, name: '02.png' }], 'png');
    expect((await decodeRaster(long)).meta).toMatchObject({ width: 970, height: 1200 });
    const top = (await rgb(long)).data.subarray((100 * 970 + 200) * 3, (100 * 970 + 200) * 3 + 3);
    const bottom = (await rgb(long)).data.subarray((700 * 970 + 200) * 3, (700 * 970 + 200) * 3 + 3);
    expect(top[0]!).toBeGreaterThan(top[2]!);
    expect(bottom[2]!).toBeGreaterThan(bottom[0]!);
  });
  it('writes a standard ZIP with separate desktop and mobile entries', () => {
    const zip = zipCommerceImages([{ name: 'desktop/01.jpg', bytes: new Uint8Array([1,2,3]) }, { name: 'mobile/01.jpg', bytes: new Uint8Array([4,5]) }]);
    expect(Buffer.from(zip).readUInt32LE(0)).toBe(0x04034b50);
    expect(Buffer.from(zip).readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(Buffer.from(zip).readUInt16LE(zip.length - 22 + 10)).toBe(2);
    expect(Buffer.from(zip).includes(Buffer.from('desktop/01.jpg'))).toBe(true);
    expect(Buffer.from(zip).includes(Buffer.from('mobile/01.jpg'))).toBe(true);
  });
});
