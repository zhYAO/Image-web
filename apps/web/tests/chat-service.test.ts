import type { ChatEvent, Session } from '@zimage/domain';
import { describe, expect, it, vi } from 'vitest';

import { ChatProviderFailure } from '@/server/chat/chat-providers';
import { createChatTurnRunner } from '@/server/chat/chat-service';

const session: Session = {
  createdAt: '2026-08-24T00:00:00.000Z',
  id: '10000000-0000-4000-8000-000000000001',
  status: 'active',
  title: '会话',
  updatedAt: '2026-08-24T00:00:00.000Z',
};

async function collect(events: AsyncIterable<ChatEvent>) {
  const values: ChatEvent[] = [];
  for await (const event of events) values.push(event);
  return values;
}

describe('chat service', () => {
  it('persists and completes a reply even if provider health recording fails', async () => {
    const complete = vi.fn().mockResolvedValue(crypto.randomUUID());
    const recordProviderResult = vi.fn().mockRejectedValue(new Error('stats unavailable'));
    const streamProvider = vi.fn(async function* () { yield '完整回复'; });
    const runner = createChatTurnRunner({ complete, recordProviderResult, start: vi.fn().mockResolvedValue({ created: false, session }), streamProvider, submitImage: vi.fn() });
    const events = await collect(runner({ chatModel: 'doubao', message: '你好', tools: [], userId: crypto.randomUUID() }));
    expect(events.map((event) => event.type)).toEqual(['message.delta', 'message.completed']);
    expect(complete).toHaveBeenCalledOnce();
    expect(streamProvider).toHaveBeenCalledOnce();
    expect(recordProviderResult).toHaveBeenCalledExactlyOnceWith('doubao', false);
  });

  it('reports persistence failure separately without retrying or marking the provider unhealthy', async () => {
    const recordProviderResult = vi.fn();
    const streamProvider = vi.fn(async function* () { yield '完整回复'; });
    const runner = createChatTurnRunner({ complete: vi.fn().mockRejectedValue(new Error('save unavailable')), recordProviderResult, start: vi.fn().mockResolvedValue({ created: false, session }), streamProvider, submitImage: vi.fn() });
    const events = await collect(runner({ chatModel: 'doubao', message: '你好', tools: [], userId: crypto.randomUUID() }));
    expect(events.at(-1)).toMatchObject({ type: 'stream.failed', error: { code: 'NETWORK', message: '聊天记录保存失败，已保留收到的回复。', retryable: false } });
    expect(streamProvider).toHaveBeenCalledOnce();
    expect(recordProviderResult).not.toHaveBeenCalledWith('doubao', true);
  });

  it('preserves the original interruption when error statistics also fail', async () => {
    const runner = createChatTurnRunner({ complete: vi.fn(), recordProviderResult: vi.fn().mockRejectedValue(new Error('stats unavailable')), start: vi.fn().mockResolvedValue({ created: false, session }), streamProvider: async function* () { yield '部分'; throw new ChatProviderFailure('stream_interrupted', false); }, submitImage: vi.fn() });
    const events = await collect(runner({ message: '你好', tools: [], userId: crypto.randomUUID() }));
    expect(events.at(-1)).toMatchObject({ type: 'stream.failed', error: { code: 'STREAM_INTERRUPTED' } });
  });

  it('persists the user first, retries one transient pre-content failure, then persists the full assistant', async () => {
    let attempt = 0;
    const complete = vi.fn().mockResolvedValue('20000000-0000-4000-8000-000000000002');
    const runner = createChatTurnRunner({
      complete,
      recordProviderResult: vi.fn(),
      start: vi.fn().mockResolvedValue({ created: true, session }),
      streamProvider: async function* () {
        attempt += 1;
        if (attempt === 1) throw new ChatProviderFailure('provider_unavailable', true);
        yield '你';
        yield '好';
      },
      submitImage: vi.fn(),
    });

    await expect(collect(runner({
      imageProvider: 'gemini', message: '你好', tools: [], userId: crypto.randomUUID(),
    }))).resolves.toMatchObject([
      { type: 'session.created' },
      { delta: '你', type: 'message.delta' },
      { delta: '好', type: 'message.delta' },
      { content: '你好', type: 'message.completed' },
    ]);
    expect(attempt).toBe(2);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ content: '你好', sessionId: session.id }));
  });

  it('keeps a plan request with trailing discussion out of image tools', async () => {
    const submitImage=vi.fn();
    const runner=createChatTurnRunner({complete:vi.fn().mockResolvedValue(crypto.randomUUID()),recordProviderResult:vi.fn(),start:vi.fn().mockResolvedValue({created:false,session}),streamProvider:async function*(){yield '先讨论构图。';},submitImage});
    await collect(runner({message:'生成商品主图的方案，先讨论构图',tools:['generate_image'],imageProvider:'seedream',userId:crypto.randomUUID()}));
    expect(submitImage).not.toHaveBeenCalled();
  });

  it('does not retry or persist a partial assistant after content was emitted', async () => {
    const complete = vi.fn();
    const streamProvider = vi.fn(async function* () {
      yield '半';
      throw new ChatProviderFailure('stream_interrupted', false);
    });
    const runner = createChatTurnRunner({
      complete,
      recordProviderResult: vi.fn(),
      start: vi.fn().mockResolvedValue({ created: false, session }),
      streamProvider,
      submitImage: vi.fn(),
    });

    const events = await collect(runner({ message: '继续', tools: [], userId: crypto.randomUUID() }));
    expect(events.map((event) => event.type)).toEqual(['message.delta', 'stream.failed']);
    expect(streamProvider).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it('maps moderation failures to the public MODERATION contract without leaking provider details', async () => {
    const rawDetail = 'prompt=https://private.example/image.png token=provider-secret';
    const providerFailure = Object.assign(new ChatProviderFailure('moderation', false), { rawDetail });
    const runner = createChatTurnRunner({
      complete: vi.fn(),
      recordProviderResult: vi.fn(),
      start: vi.fn().mockResolvedValue({ created: false, session }),
      streamProvider: async function* () {
        throw providerFailure;
      },
      submitImage: vi.fn(),
    });

    const events = await collect(runner({ message: 'unsafe input', tools: [], userId: crypto.randomUUID() }));
    expect(events).toEqual([{
      error: {
        code: 'MODERATION',
        message: '内容未通过安全检查，请调整后重试。',
        retryable: false,
      },
      type: 'stream.failed',
    }]);
    expect(JSON.stringify(events)).not.toContain(rawDetail);
    expect(JSON.stringify(events)).not.toContain('private.example');
    expect(JSON.stringify(events)).not.toContain('provider-secret');
  });

  it('does not let a legacy Skill bypass commerce plan confirmation', async () => {
    const submitImage = vi.fn();
    const runner = createChatTurnRunner({
      complete: vi.fn().mockResolvedValue(crypto.randomUUID()), recordProviderResult: vi.fn(),
      start: vi.fn().mockResolvedValue({created:false,session}),
      streamProvider: async function*(){yield '请先查看方案。';}, submitImage,
    });
    const events = await collect(runner({message:'生成白底商品图',skillId:'white-background',tools:['generate_image'],userId:crypto.randomUUID()}));
    expect(submitImage).not.toHaveBeenCalled();
    expect(events.some(event=>event.type==='tool.queued')).toBe(false);
  });

  it('queues explicit image intent through the shared image transaction only when the tool is enabled', async () => {
    const submitImage = vi.fn().mockResolvedValue({
      batchId: '30000000-0000-4000-8000-000000000003',
      sessionId: session.id,
      status: 'pending',
    });
    const runner = createChatTurnRunner({
      complete: vi.fn().mockResolvedValue('20000000-0000-4000-8000-000000000002'),
      recordProviderResult: vi.fn(),
      start: vi.fn().mockResolvedValue({ created: false, session }),
      streamProvider: vi.fn(async function* () { yield '不会调用'; }),
      submitImage,
    });

    const events = await collect(runner({
      imageProvider: 'seedream',
      message: '帮我生成一张白底商品图',
      tools: ['generate_image'],
      userId: crypto.randomUUID(),
    }));
    expect(events).toContainEqual({
      batchId: '30000000-0000-4000-8000-000000000003', type: 'tool.queued',
    });
    expect(submitImage).toHaveBeenCalledWith(expect.objectContaining({ source: 'chat_tool' }));
  });
});
