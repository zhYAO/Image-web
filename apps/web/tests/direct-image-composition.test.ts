import { describe, expect, it, vi } from 'vitest';
import { createImageService, hashCanonicalRequest } from '@/server/image/image-service';

const userId = crypto.randomUUID(), sessionId = crypto.randomUUID();
const request = { prompt: '成年女性穿米白衬衫和白裤，头到膝盖构图，右上只写“午后穿搭”',
  model: 'doubao-seedream-5.0-pro', provider: 'seedream', sessionId,
  params: { aspectRatio: '1:1' as const, resolution: '2K' as const, count: 1 } };

describe('direct image composition', () => {
  it('prepares the actual direct provider prompt with complete knees while hashing the unchanged user request', async () => {
    const service = createImageService({ submit: vi.fn() });
    const prepared = await service.prepare(userId, request, crypto.randomUUID(), crypto.randomUUID(), 'direct');
    expect(prepared.prompt).toContain(request.prompt);
    expect(prepared.prompt).toContain('双膝完整可见');
    expect(prepared.prompt).toContain('1:1');
    expect(prepared.prompt).toContain('缩小人物占比');
    expect(prepared.requestHash).toBe(await hashCanonicalRequest({ config: prepared.config,
      model: request.model, prompt: request.prompt, provider: request.provider, sessionId, source: 'direct', userId }));
    expect(prepared.model).toBe(request.model);
  });
  it('keeps chat_tool prompts and direct prompts without an explicit knee frame unchanged', async () => {
    const service = createImageService({ submit: vi.fn() });
    expect((await service.prepare(userId, request, crypto.randomUUID(), crypto.randomUUID(), 'chat_tool')).prompt)
      .toBe(request.prompt);
    for (const prompt of ['白底陶瓷杯完整轮廓', '膝盖长度裙子的织纹特写', '不要头到膝盖构图，改为脸部特写']) {
      expect((await service.prepare(userId, { ...request, prompt }, crypto.randomUUID(), crypto.randomUUID())).prompt)
        .toBe(prompt);
    }
  });
  it('recovers both old and composition-compiled direct submissions without resubmitting', async () => {
    const service = createImageService({ submit: vi.fn() });
    const prepared = await service.prepare(userId, request, crypto.randomUUID(), crypto.randomUUID());
    const submit = vi.fn();
    const snapshot = { batchId: crypto.randomUUID(), sessionId, config: prepared.config,
      model: prepared.model, provider: prepared.provider, source: 'direct' as const, requestHash: prepared.requestHash };
    const recovering = createImageService({ lookupSubmission: async () => snapshot, submit });
    expect(await recovering.submit(userId, request, crypto.randomUUID(), crypto.randomUUID()))
      .toEqual({ batchId: snapshot.batchId, sessionId, status: 'pending' });
    await expect(recovering.submit(userId, { ...request, prompt: request.prompt + '改成全身' }, crypto.randomUUID(), crypto.randomUUID()))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(submit).not.toHaveBeenCalled();
  });
  it('rejects compiled prompt overflow before any submission instead of truncating user requirements', async () => {
    const submit = vi.fn();
    const service = createImageService({ submit });
    await expect(service.prepare(userId, { ...request, prompt: '头到膝盖构图' + '字'.repeat(7990) },
      crypto.randomUUID(), crypto.randomUUID())).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    expect(submit).not.toHaveBeenCalled();
  });
});
