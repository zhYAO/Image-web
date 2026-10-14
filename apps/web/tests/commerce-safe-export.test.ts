import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderCommerceImage } from '@/server/commerce/commerce-export';

const safe = (bytes: Uint8Array, format: 'png' | 'jpg' = 'png', target?: { width: number; height: number }) =>
  renderCommerceImage(bytes, format, target, undefined, 'ec03-white-8');

async function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#123456' } }).png().toBuffer();
}

async function assertWhiteInsets(bytes: Uint8Array, width: number, height: number) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([width, height]);
  const mx = Math.ceil(width * .08), my = Math.ceil(height * .08);
  let invalid = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= mx && x < width - mx && y >= my && y < height - my) continue;
    const offset = (y * width + x) * 3;
    if (data[offset] !== 255 || data[offset + 1] !== 255 || data[offset + 2] !== 255) invalid++;
  }
  expect(invalid).toBe(0);
  return { data, info };
}

describe('EC03 safe PNG geometry (synthetic pixels)', () => {
  it.each([[1728, 2304], [301, 401], [401, 301], [2048, 2048]])('preserves %ix%i canvas with ceil(8%%) white on every edge', async (width, height) => {
    const result = await safe(await solid(width, height));
    expect([result.width, result.height]).toEqual([width, height]);
    const { data } = await assertWhiteInsets(result.bytes, width, height);
    const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
    expect([...data.subarray(center, center + 3)]).toEqual([18, 52, 86]);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 3] === 255) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const contentWidth = maxX - minX + 1, contentHeight = maxY - minY + 1;
    expect(Math.abs(minX - (width - 1 - maxX))).toBeLessThanOrEqual(1);
    expect(Math.abs(minY - (height - 1 - maxY))).toBeLessThanOrEqual(1);
    // Full contain fit, with only integer-rounding tolerance on either axis.
    const scale = Math.min((width - 2 * Math.ceil(width * .08)) / width, (height - 2 * Math.ceil(height * .08)) / height);
    expect(Math.abs(contentWidth - width * scale)).toBeLessThanOrEqual(1);
    expect(Math.abs(contentHeight - height * scale)).toBeLessThanOrEqual(1);
  });

  it('keeps all four corner marks and a central text-like stripe without stretching or cropping', async () => {
    const width = 600, height = 800;
    const source = await sharp(await solid(width, height)).composite([
      { input: await sharp({ create: { width: 60, height: 60, channels: 3, background: '#ff0000' } }).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp({ create: { width: 60, height: 60, channels: 3, background: '#00ff00' } }).png().toBuffer(), left: 540, top: 0 },
      { input: await sharp({ create: { width: 60, height: 60, channels: 3, background: '#0000ff' } }).png().toBuffer(), left: 0, top: 740 },
      { input: await sharp({ create: { width: 60, height: 60, channels: 3, background: '#ffff00' } }).png().toBuffer(), left: 540, top: 740 },
      { input: await sharp({ create: { width: 240, height: 20, channels: 3, background: '#000000' } }).png().toBuffer(), left: 180, top: 390 },
    ]).png().toBuffer();
    const result = await safe(source);
    const { data } = await assertWhiteInsets(result.bytes, width, height);
    const pixel = (x: number, y: number) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
    expect(pixel(73, 89)).toEqual([255, 0, 0]);
    expect(pixel(527, 89)).toEqual([0, 255, 0]);
    expect(pixel(73, 711)).toEqual([0, 0, 255]);
    expect(pixel(527, 711)).toEqual([255, 255, 0]);
    expect(pixel(200, 400)).toEqual([0, 0, 0]);
    // Sample inside the stripe; its rightmost pixel is blended by resampling.
    expect(pixel(390, 400)).toEqual([0, 0, 0]);
  });

  it.each([6, 8])('uses displayed dimensions and orientation %i before adding padding', async orientation => {
    const source = await sharp(await solid(400, 300)).withMetadata({ orientation }).jpeg().toBuffer();
    const result = await safe(source);
    expect([result.width, result.height]).toEqual([300, 400]);
    await assertWhiteInsets(result.bytes, 300, 400);
    expect((await sharp(result.bytes).metadata()).orientation).toBeUndefined();
  });
  it.each([6, 8])('preserves the displayed corner order for JPEG EXIF %i', async orientation => {
    const marks = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
    const composites = await Promise.all(marks.map(async (background, index) => ({
      input: await sharp({ create: { width: 60, height: 60, channels: 3, background } }).png().toBuffer(),
      left: index % 2 ? 540 : 0, top: index > 1 ? 740 : 0,
    })));
    const source = await sharp(await solid(600, 800)).composite(composites).withMetadata({ orientation }).jpeg().toBuffer();
    const result = await safe(source);
    const { data } = await assertWhiteInsets(result.bytes, 800, 600);
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    const order = orientation === 6 ? [2, 0, 3, 1] : [1, 3, 0, 2];
    for (const [index, [x, y]] of [[89, 73], [711, 73], [89, 527], [711, 527]].entries()) {
      const offset = (y! * 800 + x!) * 3;
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(data[offset + channel]! - colors[order[index]!]![channel]!)).toBeLessThan(25);
    }
  });

  it('flattens transparent source pixels onto white', async () => {
    const source = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const result = await safe(source);
    const { data } = await assertWhiteInsets(result.bytes, 100, 100);
    expect(data.every(value => value === 255)).toBe(true);
  });

  it('rejects JPEG, A+ crop targets, tiny canvases, malformed bytes and inputs beyond 2K pixel budget', async () => {
    const source = await solid(300, 400);
    await expect(safe(source, 'jpg')).rejects.toThrow();
    await expect(safe(source, 'png', { width: 970, height: 600 })).rejects.toThrow();
    await expect(safe(await solid(2, 2))).rejects.toThrow();
    await expect(safe(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await expect(safe(await solid(3000, 2000))).rejects.toThrow();
    await expect(safe(await solid(5000, 10))).rejects.toThrow();
    await expect(safe(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"><rect width="10000" height="10000" fill="red"/></svg>'))).rejects.toThrow();
  });

  it('does not alter ordinary PNG or JPG export when the strategy is absent', async () => {
    const source = await solid(300, 400);
    const png = await renderCommerceImage(source, 'png');
    expect(await sharp(png.bytes).raw().toBuffer()).toEqual(await sharp(source).raw().toBuffer());
    expect((await sharp((await renderCommerceImage(source, 'jpg')).bytes).metadata()).format).toBe('jpeg');
  });
});
