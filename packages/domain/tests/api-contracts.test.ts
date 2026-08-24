import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  createSessionRequestSchema,
  imageRequestSchema,
  recreateImageRequestSchema,
  renameSessionRequestSchema,
  timelineResponseSchema,
} from '../src';

describe('Phase 1 public API contracts', () => {
  it('normalizes session titles and rejects undeclared request fields', () => {
    expect(createSessionRequestSchema.parse({ title: '  新会话  ' })).toEqual({ title: '新会话' });
    expect(renameSessionRequestSchema.parse({ title: '  新标题  ' })).toEqual({ title: '新标题' });
    expect(() => createSessionRequestSchema.parse({ ownerId: 'forged' })).toThrow();
    expect(() => renameSessionRequestSchema.parse({ title: ' ' })).toThrow();
  });

  it('accepts only the fixed image request shape and 1-4 images', () => {
    const request = imageRequestSchema.parse({
      params: { aspectRatio: '16:9', count: 4, resolution: '2K' },
      prompt: '极简商品图',
    });
    expect(request.params.count).toBe(4);
    expect(() => imageRequestSchema.parse({
      count: 4,
      params: { aspectRatio: '16:9', count: 5, resolution: '2K' },
      prompt: 'invalid',
    })).toThrow();
  });

  it('requires a generation id only for single-image recreation', () => {
    expect(recreateImageRequestSchema.parse({ batchId: crypto.randomUUID(), mode: 'failed' })).toBeTruthy();
    expect(() => recreateImageRequestSchema.parse({ batchId: crypto.randomUUID(), mode: 'single' })).toThrow();
    expect(() => recreateImageRequestSchema.parse({
      batchId: crypto.randomUUID(),
      generationId: crypto.randomUUID(),
      mode: 'all',
    })).toThrow();
  });

  it('keeps public failures redacted and correlation-addressable', () => {
    expect(apiErrorSchema.parse({
      code: 'unauthorized',
      correlationId: crypto.randomUUID(),
      message: '请刷新后重试。',
      retryable: true,
    })).toMatchObject({ code: 'unauthorized', retryable: true });
    expect(() => apiErrorSchema.parse({
      code: 'raw_provider_stack',
      correlationId: crypto.randomUUID(),
      message: 'secret',
      retryable: false,
    })).toThrow();
  });

  it('restores generation cards with immutable provider and parameter snapshots', () => {
    const sessionId = crypto.randomUUID();
    expect(timelineResponseSchema.parse({ items: [{
      batch: {
        assets: [{ id: crypto.randomUUID(), status: 'pending' }],
        config: { aspectRatio: '1:1', count: 1, resolution: '1K' },
        createdAt: '2026-08-24T00:00:00.000Z',
        id: crypto.randomUUID(),
        model: 'gemini-3-pro-image',
        prompt: '商品图',
        provider: 'gemini',
        sessionId,
        source: 'direct',
        status: 'pending',
      },
      createdAt: '2026-08-24T00:00:00.000Z',
      id: crypto.randomUUID(),
      sequence: 1,
      sessionId,
      type: 'generation',
    }] })).toBeTruthy();
  });
});
