import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { GenerationBatch } from '@zimage/domain';
import { downloadImages } from '../../web/features/workspace/download-images';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('never creates a blob URL or clicks a download when the owner expires while reading private bytes', async () => {
  let finish!: (blob: Blob) => void;
  const body = new Promise<Blob>(done => { finish = done; });
  const response = new Response('private');
  vi.spyOn(response, 'blob').mockReturnValue(body);
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  const create = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let current = true;
  const batch = { id: 'a-private-batch', assets: [
    { id: 'a', status: 'succeeded', url: 'https://storage.example/a.png' },
    { id: 'b', status: 'succeeded', url: 'https://storage.example/b.png' },
  ] } as GenerationBatch;
  const result = downloadImages(batch, () => current);
  await waitFor(() => expect(response.blob).toHaveBeenCalled());
  current = false;
  finish(new Blob(['private owner A image']));
  expect(await result).toEqual({ downloaded: 0, failed: 0 });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
});
