import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderCommerceImage } from '@/server/commerce/commerce-export';

describe('local synthetic 2K safe export resource budget', () => {
  it('bounds sequential renderer latency, CPU and incremental RSS without external I/O', async () => {
    const width = 2048, height = 2048;
    const pixels = Buffer.alloc(width * height * 3);
    let state = 20261014;
    for (let index = 0; index < pixels.length; index++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      pixels[index] = state & 255;
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
    const measurements: Array<{ elapsedMs: number; cpuMs: number; incrementalRssMiB: number; peakRssMiB: number; outputBytes: number }> = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      const baseline = process.memoryUsage().rss;
      let peak = baseline;
      const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
      const cpu = process.cpuUsage(), started = performance.now();
      try {
        const result = await renderCommerceImage(source, 'png', undefined, undefined, 'ec03-white-8');
        const used = process.cpuUsage(cpu);
        peak = Math.max(peak, process.memoryUsage().rss);
        const measured = { elapsedMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000,
          incrementalRssMiB: (peak - baseline) / 1024 / 1024, peakRssMiB: peak / 1024 / 1024, outputBytes: result.bytes.length };
        measurements.push(measured);
        expect([result.width, result.height]).toEqual([width, height]);
        // Local admission budgets, not production SLAs or a concurrency benchmark.
        expect(measured.elapsedMs).toBeLessThan(5000);
        expect(measured.cpuMs).toBeLessThan(5000);
        expect(measured.incrementalRssMiB).toBeLessThan(192);
      } finally { clearInterval(sampler); }
    }
    console.info('SYNTHETIC_SAFE_EXPORT_BUDGET', JSON.stringify({ inputBytes: source.length, measurements }));
  });
});
