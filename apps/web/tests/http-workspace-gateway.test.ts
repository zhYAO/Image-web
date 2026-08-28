import { describe, expect, it, vi } from 'vitest';

import { HttpWorkspaceGateway } from '@/gateways/http-workspace-gateway';

const sessionId = '10000000-0000-4000-8000-0000000000a1';
const batchId = '30000000-0000-4000-8000-0000000000a1';
const generationId = '40000000-0000-4000-8000-0000000000a1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

describe('HttpWorkspaceGateway', () => {
  it('preserves the browser receiver when using the global fetch implementation', async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(json({ sessions: [] }));
    });
    vi.stubGlobal('fetch', browserFetch);

    try {
      const gateway = new HttpWorkspaceGateway();

      await expect(gateway.listSessions()).resolves.toEqual([]);
      expect(browserFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parses the session API contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ sessions: [{
      createdAt: '2026-08-24T00:00:00.000Z',
      id: sessionId,
      status: 'active',
      title: '会话',
      updatedAt: '2026-08-24T00:00:00.000Z',
    }] }));
    const gateway = new HttpWorkspaceGateway({ fetcher });

    await expect(gateway.listSessions()).resolves.toMatchObject([{ id: sessionId, title: '会话' }]);
    expect(fetcher).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'GET' }));
  });

  it('uploads references before submitting the fixed idempotent image request', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        expiresAt: '2026-09-23T00:00:00.000Z',
        height: 1,
        id: '50000000-0000-4000-8000-0000000000a1',
        mimeType: 'image/png',
        name: 'reference.png',
        size: 3,
        width: 1,
      }, 201))
      .mockResolvedValueOnce(json({ batchId, sessionId, status: 'pending' }, 202))
      .mockResolvedValueOnce(json({ batch: {
        assets: [{ id: '40000000-0000-4000-8000-0000000000a1', status: 'pending' }],
        config: { aspectRatio: '1:1', count: 1, resolution: '1K' },
        createdAt: '2026-08-24T00:00:00.000Z',
        id: batchId,
        model: 'gemini-3-pro-image',
        prompt: '商品图',
        provider: 'gemini',
        sessionId,
        source: 'direct',
        status: 'pending',
      } }));
    const gateway = new HttpWorkspaceGateway({ fetcher });
    const file = new File(['png'], 'reference.png', { type: 'image/png' });

    await expect(gateway.submitImage({
      aspectRatio: '1:1',
      count: 1,
      prompt: '商品图',
      references: [{ file, mimeType: file.type, name: file.name, size: file.size }],
      resolution: '1K',
      sessionId,
    })).resolves.toMatchObject({ id: batchId, status: 'pending' });

    const uploadBody = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(uploadBody.get('file')).toBe(file);
    const imageCall = fetcher.mock.calls[1];
    expect(imageCall?.[0]).toBe('/api/image');
    expect(new Headers(imageCall?.[1]?.headers).get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(imageCall?.[1]?.body))).toMatchObject({
      params: { referenceIds: ['50000000-0000-4000-8000-0000000000a1'] },
      prompt: '商品图',
      sessionId,
    });
  });

  it.each([
    {
      expected: { batchId, generationId, mode: 'single' },
      request: { batchId, generationId, scope: 'single' as const },
    },
    {
      expected: { batchId, mode: 'failed' },
      request: { batchId, scope: 'failed' as const },
    },
    {
      expected: { batchId, mode: 'all' },
      request: { batchId, scope: 'all' as const },
    },
  ])('sends the $request.scope recreation contract without extra fields', async ({ expected, request }) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ batchId, sessionId, status: 'pending' }, 202))
      .mockResolvedValueOnce(json({ batch: {
        assets: [{ id: generationId, status: 'pending' }],
        config: { aspectRatio: '1:1', count: 1, resolution: '2K' },
        createdAt: '2026-08-24T00:00:00.000Z',
        id: batchId,
        model: 'seedream-4.5',
        prompt: '商品图',
        provider: 'seedream',
        sessionId,
        source: 'direct',
        status: 'pending',
      } }));
    const gateway = new HttpWorkspaceGateway({ fetcher });

    await expect(gateway.recreateGeneration(request)).resolves.toMatchObject({ id: batchId, status: 'pending' });

    const recreateCall = fetcher.mock.calls[0];
    expect(recreateCall?.[0]).toBe('/api/image/recreate');
    expect(JSON.parse(String(recreateCall?.[1]?.body))).toEqual(expected);
  });
});
