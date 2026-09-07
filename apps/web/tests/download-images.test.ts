import type { GenerationBatch } from '@zimage/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadImages } from '@/features/workspace/download-images';

const batch = { id: 'batch-test', assets: [
  { id: 'a', status: 'succeeded', url: 'https://storage.example/generated/a.jpg' },
  { id: 'b', status: 'failed', url: 'https://storage.example/generated/b.png' },
  { id: 'c', status: 'succeeded', expired: true, url: 'https://storage.example/generated/c.webp' },
] } as GenerationBatch;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('image downloads', () => {
  it('downloads a local blob URL instead of navigating to the cross-origin image', async () => {
    vi.useFakeTimers();
    const fetchImage = vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchImage);
    const create = vi.fn().mockReturnValue('blob:download-test');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const clicks: {href: string; download: string}[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push({href: this.href, download: this.download}); });
    expect(await downloadImages(batch)).toEqual({ downloaded: 1, failed: 0 });
    expect(fetchImage).toHaveBeenCalledOnce();
    expect(fetchImage).toHaveBeenCalledWith(batch.assets[0]!.url, expect.objectContaining({ credentials: 'omit' }));
    expect(clicks).toEqual([{href: 'blob:download-test', download: 'zimage-batch-test-1.jpg'}]);
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledWith('blob:download-test');
  });

  it.each([new Response('expired', {status: 403}), new TypeError('Failed to fetch')])('reports a failed signed URL without navigating or claiming success', async (result) => {
    vi.stubGlobal('fetch', result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(await downloadImages(batch)).toEqual({ downloaded: 0, failed: 1 });
    expect(click).not.toHaveBeenCalled();
  });
});
