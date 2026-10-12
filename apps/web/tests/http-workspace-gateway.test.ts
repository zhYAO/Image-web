import type { ChatEvent } from '@zimage/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpWorkspaceGateway, resetAuthRequiredNotification } from '@/gateways/http-workspace-gateway';
import { readReferenceBytes, referencePng, stubReferenceBitmap } from './reference-file-fixtures';
beforeEach(() => stubReferenceBitmap());
afterEach(() => vi.unstubAllGlobals());

const sessionId = '10000000-0000-4000-8000-0000000000a1';
const batchId = '30000000-0000-4000-8000-0000000000a1';
const generationId = '40000000-0000-4000-8000-0000000000a1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

function sse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`${frame}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    status: 200,
  });
}

describe('HttpWorkspaceGateway', () => {
  it('normalizes the upload copy used by direct images while retaining the original reference', async () => {
    const file = new File([referencePng], 'reference.jpg', { type: 'image/jpeg' });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (path === '/api/uploads') {
        const uploaded = (init!.body as FormData).get('file') as File;
        expect(uploaded.name).toBe('reference.png');
        expect(uploaded.type).toBe('image/png');
        expect(await readReferenceBytes(uploaded)).toEqual(referencePng);
        return json({ id: generationId, name: uploaded.name, mimeType: uploaded.type, size: uploaded.size, width: 64, height: 48, expiresAt: '2026-11-01T00:00:00Z' }, 201);
      }
      if (path === '/api/image') return json({ batchId, sessionId, status: 'pending' }, 202);
      return json({ batch: { id: batchId, sessionId, provider: 'seedream', model: 'doubao-seedream-5.0-pro', prompt: '商品图', source: 'direct', status: 'pending', config: { aspectRatio: '1:1', count: 1, resolution: '2K' }, createdAt: '2026-10-12T00:00:00Z', assets: [{ id: generationId, status: 'pending' }] } });
    });
    const gateway = new HttpWorkspaceGateway({ fetcher });
    await expect(gateway.submitImage({ sessionId, prompt: '商品图', aspectRatio: '1:1', resolution: '2K', count: 1, references: [{ file, name: file.name, mimeType: file.type, size: file.size }] })).resolves.toMatchObject({ id: batchId });
    expect(file.name).toBe('reference.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('stops at completion even if the same transport chunk contains a late failure', async () => {
    const completed: ChatEvent = { type: 'message.completed', messageId: crypto.randomUUID(), content: '完整回复' };
    const failure: ChatEvent = { type: 'stream.failed', error: { code: 'NETWORK', message: 'late failure', retryable: true } };
    const response = new Response(`data: ${JSON.stringify(completed)}\n\ndata: ${JSON.stringify(failure)}\n\n`);
    const gateway = new HttpWorkspaceGateway({ fetcher: vi.fn().mockResolvedValue(response) });
    const events = [];
    for await (const event of gateway.streamChat({ message: '你好', sessionId, imageToolEnabled: false })) events.push(event);
    expect(events).toEqual([completed]);
  });

  it('parses a completion in the final unterminated frame', async () => {
    const completed: ChatEvent = { type: 'message.completed', messageId: crypto.randomUUID(), content: '完整回复' };
    const gateway = new HttpWorkspaceGateway({ fetcher: vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(completed)}`)) });
    const events = [];
    for await (const event of gateway.streamChat({ message: '你好', sessionId, imageToolEnabled: false })) events.push(event);
    expect(events).toEqual([completed]);
  });

  it('emits one auth-required event for concurrent unauthorized responses', async () => {
    resetAuthRequiredNotification();
    const onAuthRequired = vi.fn();
    window.addEventListener('zimage:auth-required', onAuthRequired);
    const gateway = new HttpWorkspaceGateway({ fetcher: vi.fn().mockResolvedValue(json({ code: 'unauthorized', message: 'expired', retryable: false }, 401)) });

    await Promise.all([
      expect(gateway.listSessions()).rejects.toThrow(),
      expect(gateway.listSessions()).rejects.toThrow(),
    ]);

    expect(onAuthRequired).toHaveBeenCalledOnce();
    window.removeEventListener('zimage:auth-required', onAuthRequired);
    resetAuthRequiredNotification();
  });

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

  it('keeps batch status reads unsigned and signs an opened image once', async () => {
    let signatures = 0;
    const batch = {
      assets: [{ id: generationId, status: 'succeeded' }, { id: '40000000-0000-4000-8000-0000000000a2', status: 'processing' }],
      config: { aspectRatio: '1:1', count: 2, resolution: '2K' },
      createdAt: '2026-09-16T09:00:00.000Z',
      id: batchId,
      model: 'seedream-5.0-flash',
      prompt: '商品图',
      provider: 'seedream',
      sessionId,
      source: 'direct',
      status: 'processing',
    };
    const fetcher = vi.fn(async (path: RequestInfo | URL) => {
      if (String(path) === `/api/image/${batchId}`) return json({ batch });
      if (String(path) === `/api/generations/${generationId}/asset-url`) {
        signatures += 1;
        return json({ generationId, expiresAt: new Date(Date.now() + 60_000).toISOString(), url: `https://example.invalid/image.jpg?token=${signatures}` });
      }
      throw new Error(`Unexpected request: ${String(path)}`);
    });
    const gateway = new HttpWorkspaceGateway({ fetcher });

    const first = await gateway.getGenerationBatch(batchId);
    const second = await gateway.getGenerationBatch(batchId);

    expect(first.assets[0]?.url).toBeUndefined();
    expect(second.assets[0]?.url).toBeUndefined();
    expect(signatures).toBe(0);
    expect(await gateway.getGenerationAssetUrl?.(generationId)).toBe('https://example.invalid/image.jpg?token=1');
    expect(await gateway.getGenerationAssetUrl?.(generationId)).toBe('https://example.invalid/image.jpg?token=1');
    expect(signatures).toBe(1);
  });

  it('does not reuse a signature resolved after the account cache is cleared', async () => {
    let resolveFirst!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(json({ generationId, expiresAt: new Date(Date.now() + 60_000).toISOString(),
        url: 'https://example.invalid/new-owner.jpg' }));
    const gateway = new HttpWorkspaceGateway({ fetcher });
    const old = gateway.getGenerationAssetUrl(generationId);
    gateway.clearAssetCaches();
    resolveFirst(json({ generationId, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      url: 'https://example.invalid/old-owner.jpg' }));
    await expect(old).rejects.toThrow('Asset owner changed');
    expect(await gateway.getGenerationAssetUrl(generationId)).toBe('https://example.invalid/new-owner.jpg');
    expect(fetcher).toHaveBeenCalledTimes(2);
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
        config: { aspectRatio: '1:1', count: 1, resolution: '2K' },
        createdAt: '2026-08-24T00:00:00.000Z',
        id: batchId,
        model: 'doubao-seedream-5.0-pro',
        prompt: '商品图',
        provider: 'seedream',
        sessionId,
        source: 'direct',
        status: 'pending',
      } }));
    const gateway = new HttpWorkspaceGateway({ fetcher });
    const file = new File([referencePng], 'reference.png', { type: 'image/png' });

    await expect(gateway.submitImage({
      aspectRatio: '1:1',
      count: 1,
      prompt: '商品图',
      references: [{ file, mimeType: file.type, name: file.name, size: file.size }],
      resolution: '2K',
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
        model: 'doubao-seedream-5.0-pro',
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

  it('forwards uploaded reference ids in the chat request body', async () => {
    const messageId = '20000000-0000-4000-8000-0000000000a1';
    const referenceId1 = '50000000-0000-4000-8000-0000000000a1';
    const referenceId2 = '50000000-0000-4000-8000-0000000000a2';
    const fetcher = vi.fn().mockResolvedValueOnce(sse([
      `data: ${JSON.stringify({ content: 'ok', messageId, type: 'message.completed' })}`,
    ]));
    const gateway = new HttpWorkspaceGateway({ fetcher });

    const events: ChatEvent[] = [];
    for await (const event of gateway.streamChat({
      imageToolEnabled: false,
      images: [referenceId1, referenceId2],
      message: '帮我分析这两张参考图',
      sessionId,
    })) events.push(event);

    expect(events).toEqual([{ content: 'ok', messageId, type: 'message.completed' }]);
    expect(fetcher).toHaveBeenCalledOnce();
    const [path, init] = fetcher.mock.calls[0]!;
    expect(path).toBe('/api/chat');
    expect(JSON.parse(String(init?.body))).toEqual({
      images: [referenceId1, referenceId2],
      message: '帮我分析这两张参考图',
      sessionId,
    });
  });

  it('omits the images key when no reference ids are attached', async () => {
    const messageId = '20000000-0000-4000-8000-0000000000a2';
    const fetcher = vi.fn().mockResolvedValueOnce(sse([
      `data: ${JSON.stringify({ content: 'ok', messageId, type: 'message.completed' })}`,
    ]));
    const gateway = new HttpWorkspaceGateway({ fetcher });

    const events: ChatEvent[] = [];
    for await (const event of gateway.streamChat({
      imageToolEnabled: false,
      message: '普通聊天',
      sessionId,
    })) events.push(event);

    expect(events).toEqual([{ content: 'ok', messageId, type: 'message.completed' }]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      message: '普通聊天',
      sessionId,
    });
  });
});
