import { describe, expect, it, vi } from 'vitest';

import { createImageService, toImageSubmissionResponse, type GenerationSubmissionStore } from '@/server/image/image-service';

const userId = '00000000-0000-4000-8000-0000000000a1';
const sessionId = '10000000-0000-4000-8000-0000000000a1';

describe('image submission service', () => {
  it('removes internal submission metadata from the public response', () => {
    expect(toImageSubmissionResponse({
      batchId: '30000000-0000-4000-8000-0000000000a1',
      deduplicated: false,
      sessionId,
      status: 'pending',
    })).toEqual({
      batchId: '30000000-0000-4000-8000-0000000000a1',
      sessionId,
      status: 'pending',
    });
  });

  it('resolves the registry snapshot and produces a stable request hash', async () => {
    const submit = vi.fn().mockResolvedValue({
      batchId: '30000000-0000-4000-8000-0000000000a1',
      deduplicated: false,
      sessionId,
      status: 'pending',
    });
    const service = createImageService({ submit } as GenerationSubmissionStore);
    const request = {
      params: { aspectRatio: '16:9' as const, count: 2, resolution: '2K' as const },
      prompt: '  极简商品图  ',
      sessionId,
      skillId: 'white-background',
    };

    await service.submit(userId, request, crypto.randomUUID(), crypto.randomUUID());
    await service.submit(userId, request, crypto.randomUUID(), crypto.randomUUID());

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      config: { aspectRatio: '16:9', count: 2, resolution: '2K' },
      model: 'gemini-3-pro-image',
      prompt: '极简商品图',
      provider: 'gemini',
      skillVersion: '1.0.0',
      source: 'direct',
      userId,
    });
    expect(submit.mock.calls[0]?.[0].requestHash).toBe(submit.mock.calls[1]?.[0].requestHash);
  });

  it('rejects provider/model capabilities before reserving quota', async () => {
    const submit = vi.fn();
    const service = createImageService({ submit } as GenerationSubmissionStore);

    await expect(service.prepare(userId, {
      model: 'seedream-4.5',
      params: { aspectRatio: '1:1', count: 1, resolution: '1K' },
      prompt: 'invalid pair',
      provider: 'gemini',
    }, crypto.randomUUID(), crypto.randomUUID())).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
