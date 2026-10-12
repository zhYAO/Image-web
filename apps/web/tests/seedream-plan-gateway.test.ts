import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageRequest } from '@zimage/domain';
import { MOCK_STORAGE_KEY, MockWorkspaceGateway, type StorageLike } from '@/gateways/mock-workspace-gateway';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('mock Plan image admissions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['seedream-4.5', 'seedream-5.0-flash', 'seedream-5.0-pro', 'gemini-3-pro-image'])('rejects a new request using %s before quota changes', async model => {
    const gateway = new MockWorkspaceGateway({ storage: new MemoryStorage() });
    const before = await gateway.getQuota();
    await expect(gateway.submitImage({ model, provider: model.startsWith('gemini') ? 'gemini' : 'seedream', prompt: 'new image', aspectRatio: '1:1', resolution: '2K', count: 1 })).rejects.toMatchObject({ safe: { code: 'BAD_REQUEST', message: expect.stringContaining('主动更新') } });
    expect(await gateway.getQuota()).toEqual(before);
  });

  it('recovers a persisted retired-model receipt before consulting current prices or models', async () => {
    const storage = new MemoryStorage();
    new MockWorkspaceGateway({ storage });
    const envelope = JSON.parse(storage.getItem(MOCK_STORAGE_KEY)!);
    const request: ImageRequest = { requestId: crypto.randomUUID(), sessionId: 'session-welcome', model: 'seedream-5.0-pro', provider: 'seedream', prompt: 'original image', aspectRatio: '1:1', resolution: '2K', count: 1, billing: { version: '2026-10-06.1', totalMinor: 30 } };
    const batchId = crypto.randomUUID();
    const batch = { id: batchId, sessionId: request.sessionId, model: request.model, provider: request.provider, prompt: request.prompt, source: 'direct', status: 'pending', createdAt: new Date().toISOString(), config: { aspectRatio: request.aspectRatio, resolution: request.resolution, count: 1 }, assets: [{ id: crypto.randomUUID(), status: 'pending' }] };
    envelope.state.batches[batchId] = batch;
    envelope.state.creditImageRequests = { [request.requestId!]: { hash: JSON.stringify(request), batchId } };
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(envelope));
    const gateway = new MockWorkspaceGateway({ storage });
    const before = await gateway.getQuota();
    expect(await gateway.submitImage(request)).toEqual(batch);
    await expect(gateway.submitImage({ ...request, prompt: 'changed image' })).rejects.toMatchObject({ safe: { code: 'CONFLICT' } });
    expect(await gateway.getQuota()).toEqual(before);
  });
});
