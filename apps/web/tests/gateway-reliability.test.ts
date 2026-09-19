import { describe, expect, it } from 'vitest';
import type { ImageRequest } from '@zimage/domain';
import { HttpWorkspaceGateway } from '@/gateways/http-workspace-gateway';

const sessionId = '10000000-0000-4000-8000-000000000001';
const batchId = '30000000-0000-4000-8000-000000000001';
const messageId = '20000000-0000-4000-8000-000000000001';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const request = (): ImageRequest => ({ sessionId, prompt: '商品图', count: 1, aspectRatio: '1:1', resolution: '2K' });
const batch = { id: batchId, sessionId, source: 'direct', status: 'pending', prompt: '商品图', provider: 'seedream', model: 'seedream-4.5', config: { count: 1, aspectRatio: '1:1', resolution: '2K' }, createdAt: '2026-09-06T00:00:00.000Z', assets: [{ id: messageId, status: 'pending' }] };

describe('gateway recovery boundaries', () => {
  it('recovers messages beyond the first timeline page', async () => {
    const items = Array.from({ length: 101 }, (_, n) => ({ id: `20000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`, sessionId, sequence: n + 1, type: 'message', role: 'user', content: String(n + 1), createdAt: '2026-09-06T00:00:00.000Z' }));
    const gateway = new HttpWorkspaceGateway({ fetcher: async (url) => json(String(url).includes('after=100') ? { items: items.slice(100) } : { items: items.slice(0, 100), nextCursor: 100 }) });
    expect((await gateway.getTimeline(sessionId)).map((item) => item.sequence)).toEqual(items.map((item) => item.sequence));
  });

  it('does not POST again when the accepted batch could not be read', async () => {
    let posts = 0;
    let reads = 0;
    const gateway = new HttpWorkspaceGateway({ fetcher: async (url) => {
      if (url === '/api/image') { posts++; return json({ batchId, sessionId, status: 'pending' }, 202); }
      return ++reads === 1 ? json({}, 503) : json({ batch });
    } });
    const input = request();
    await expect(gateway.submitImage(input)).rejects.toThrow();
    expect(await gateway.submitImage(input)).toMatchObject({ id: batchId });
    expect(posts).toBe(1);
  });

  it('reuses a submission key after an ambiguous network failure', async () => {
    const keys: Array<string | null> = [];
    const gateway = new HttpWorkspaceGateway({ fetcher: async (url, init) => {
      if (url === '/api/image') {
        keys.push(new Headers(init?.headers).get('idempotency-key'));
        if (keys.length === 1) throw new TypeError('network lost after send');
        return json({ batchId, sessionId, status: 'pending' }, 202);
      }
      return json({ batch });
    } });
    const input = request();
    await expect(gateway.submitImage(input)).rejects.toThrow();
    await gateway.submitImage(input);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await gateway.submitImage(request());
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('reports an interrupted response when SSE ends without a terminal event', async () => {
    const gateway = new HttpWorkspaceGateway({ fetcher: async () => new Response(`data: ${JSON.stringify({ type: 'message.delta', messageId, delta: 'partial' })}\n\n`) });
    const events = [];
    for await (const event of gateway.streamChat({ sessionId, message: 'hello', imageToolEnabled: false })) events.push(event);
    expect(events).toMatchObject([{ type: 'message.delta' }, { type: 'stream.failed', error: { code: 'STREAM_INTERRUPTED' } }]);
  });
});
