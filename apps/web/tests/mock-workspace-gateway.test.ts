import type { ChatEvent } from '@zimage/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWorkspaceGateway } from '@/gateways';
import { MockWorkspaceGateway, type StorageLike } from '@/gateways/mock-workspace-gateway';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

async function collect(stream: AsyncIterable<ChatEvent>) {
  const events: ChatEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('MockWorkspaceGateway', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('streams session, deltas and completion in a stable order', async () => {
    const gateway = new MockWorkspaceGateway({ storage: new MemoryStorage() });
    const eventsPromise = collect(
      gateway.streamChat({ imageToolEnabled: false, message: '帮我写商品图提示词' }),
    );

    await vi.runAllTimersAsync();
    const events = await eventsPromise;

    expect(events.map((event) => event.type)).toEqual([
      'session.created',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.completed',
    ]);
    const session = events[0];
    expect(session?.type).toBe('session.created');
    if (session?.type === 'session.created') {
      const timeline = await gateway.getTimeline(session.session.id);
      expect(timeline.map((item) => item.sequence)).toEqual([1, 2]);
      expect(timeline.at(-1)).toMatchObject({ role: 'assistant', streaming: false });
    }
  });

  it('injects one shared mock gateway for the mock data mode', () => {
    expect(getWorkspaceGateway()).toBeInstanceOf(MockWorkspaceGateway);
    expect(getWorkspaceGateway()).toBe(getWorkspaceGateway());
  });

  it('moves a partial image batch through pending and processing to partial', async () => {
    const gateway = new MockWorkspaceGateway({ storage: new MemoryStorage() });
    const session = await gateway.createSession();
    const batch = await gateway.submitImage({
      aspectRatio: '1:1',
      count: 3,
      prompt: 'partial result',
      resolution: '1K',
      scenario: 'partial',
      sessionId: session.id,
    });
    expect(batch.status).toBe('pending');

    await vi.advanceTimersByTimeAsync(950);
    expect((await gateway.getGenerationBatch(batch.id)).status).toBe('processing');
    await vi.runAllTimersAsync();
    expect(await gateway.getGenerationBatch(batch.id)).toMatchObject({
      status: 'partial',
      assets: [{ status: 'succeeded' }, { status: 'succeeded' }, { status: 'failed' }],
    });
  });

  it('restores persisted sessions and timelines in a new gateway instance', async () => {
    const storage = new MemoryStorage();
    const first = new MockWorkspaceGateway({ storage });
    const session = await first.createSession('可恢复会话');
    await first.submitImage({
      aspectRatio: '3:4',
      count: 1,
      prompt: '刷新后仍然存在',
      resolution: '2K',
      sessionId: session.id,
    });

    const restored = new MockWorkspaceGateway({ storage });
    expect(await restored.listSessions()).toContainEqual(expect.objectContaining({ title: '可恢复会话' }));
    expect(await restored.getTimeline(session.id)).toHaveLength(1);
  });

  it('backs up corrupt storage, resets fixtures and exposes an actionable notice', async () => {
    const storage = new MemoryStorage();
    storage.setItem('zimage:mock:v1', '{broken');
    const gateway = new MockWorkspaceGateway({ storage, now: () => new Date('2026-08-21T00:00:00Z') });

    expect(gateway.getRecoveryNotice()).toContain('已恢复初始数据');
    expect([...storage.values.keys()]).toContain('zimage:mock:v1:backup:2026-08-21T00:00:00.000Z');
    expect(await gateway.listSessions()).toHaveLength(1);
  });

  it('keeps a deleting session hidden and allows a reliable retry', async () => {
    const gateway = new MockWorkspaceGateway({ storage: new MemoryStorage() });
    const session = await gateway.createSession('普通会话');
    gateway.setScenario('delete-retry');

    await expect(gateway.deleteSession(session.id)).rejects.toMatchObject({
      safe: { code: 'DELETE_RETRY_REQUIRED' },
    });
    expect(await gateway.listSessions()).not.toContainEqual(expect.objectContaining({ id: session.id }));
    await expect(gateway.deleteSession(session.id)).resolves.toBeUndefined();
    await expect(gateway.getTimeline(session.id)).rejects.toMatchObject({
      safe: { code: 'SESSION_NOT_FOUND' },
    });
  });

  it('emits safe provider failures and queues chat-tool generations', async () => {
    const gateway = new MockWorkspaceGateway({ storage: new MemoryStorage() });
    const failedPromise = collect(
      gateway.streamChat({ imageToolEnabled: false, message: 'fail', scenario: 'provider-unavailable' }),
    );
    await vi.runAllTimersAsync();
    expect((await failedPromise).at(-1)).toMatchObject({
      error: { code: 'PROVIDER_UNAVAILABLE' },
      type: 'stream.failed',
    });

    const toolPromise = collect(gateway.streamChat({ imageToolEnabled: true, message: '生成商品图' }));
    await vi.runAllTimersAsync();
    expect((await toolPromise).at(-1)).toMatchObject({
      batch: { source: 'chat_tool' },
      type: 'tool.queued',
    });
  });

  it('supports session rename, recreation and metadata reads', async () => {
    const gateway = new MockWorkspaceGateway({ storage: new MemoryStorage() });
    const session = await gateway.createSession();
    expect(await gateway.renameSession(session.id, '新标题')).toMatchObject({ title: '新标题' });
    const batch = await gateway.submitImage({
      aspectRatio: '1:1',
      count: 1,
      prompt: '可重生成',
      resolution: '1K',
      sessionId: session.id,
    });
    await vi.runAllTimersAsync();
    expect(await gateway.recreateGeneration({ batchId: batch.id, scope: 'all' })).toMatchObject({ status: 'pending' });
    expect(await gateway.getSkills()).toHaveLength(3);
    expect(await gateway.getProviderCapabilities()).toHaveLength(1);
    expect(await gateway.getProviderHealth()).toHaveLength(1);
    expect(await gateway.getQuota()).toMatchObject({ limit: 100 });
  });
});
