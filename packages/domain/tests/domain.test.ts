import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_BYTES,
  aggregateBatchStatus,
  hasExplicitImageIntent,
  nextTimelineSequence,
  resolveImageToolEnabled,
  sanitizeError,
  validateImageRequest,
} from '../src/index';

describe('aggregateBatchStatus', () => {
  it.each([
    [['pending', 'pending'], 'pending'],
    [['processing', 'pending'], 'processing'],
    [['succeeded', 'succeeded'], 'succeeded'],
    [['failed', 'failed'], 'failed'],
    [['succeeded', 'failed'], 'partial'],
  ] as const)('aggregates %j as %s', (statuses, expected) => {
    expect(aggregateBatchStatus(statuses)).toBe(expected);
  });
});

describe('timeline sequencing', () => {
  it('uses a stable monotonic sequence even for an unsorted timeline', () => {
    expect(nextTimelineSequence([{ sequence: 8 }, { sequence: 2 }, { sequence: 5 }])).toBe(9);
    expect(nextTimelineSequence([])).toBe(1);
  });
});

describe('image request validation', () => {
  const valid = {
    aspectRatio: '1:1' as const,
    count: 2,
    prompt: '一件白色夹克的商品图',
    resolution: '1K' as const,
  };

  it('accepts supported ratios, resolutions and 1-4 images', () => {
    expect(validateImageRequest(valid)).toEqual({ ok: true });
  });

  it('rejects invalid count and oversized references with stable codes', () => {
    expect(validateImageRequest({ ...valid, count: 5 })).toMatchObject({
      error: { code: 'VALIDATION_IMAGE_COUNT' },
      ok: false,
    });
    expect(
      validateImageRequest({
        ...valid,
        references: [{ mimeType: 'image/png', name: 'large.png', size: MAX_UPLOAD_BYTES + 1 }],
      }),
    ).toMatchObject({ error: { code: 'VALIDATION_UPLOAD_SIZE' }, ok: false });
  });
});

describe('skill/tool linkage', () => {
  it('enables image tool for a selected skill and restores explicit choice when cleared', () => {
    expect(resolveImageToolEnabled({ explicitEnabled: false, skillRequiresImage: true })).toBe(true);
    expect(resolveImageToolEnabled({ explicitEnabled: false, skillRequiresImage: false })).toBe(false);
    expect(resolveImageToolEnabled({ explicitEnabled: true, skillRequiresImage: false })).toBe(true);
  });

  it.each([
    ['请帮我生成一张羊毛大衣商品图', true],
    ['生成一张秋日海报', true],
    ['Please create a product image for this coat', true],
    ['帮我分析这张商品图的构图', false],
    ['如何生成更好的商品图？', false],
    ['不要生成图片，只讨论提示词', false],
    ['帮我生成商品套图方案', false],
    ['生成一张海报之前先给我提示词', false],
    ['Create a prompt for a product photo', false],
    ['生成商品主图的方案，先讨论构图', false],
    ['生成一张海报，先分析构图不要执行', false],
    ['Generate a product photo prompt, discuss the lighting', false],
    ['生成一张陶瓷杯商品图，暖色背景', true],
  ])('classifies explicit image intent for %s', (message, expected) => {
    expect(hasExplicitImageIntent(message)).toBe(expected);
  });
});

describe('safe errors', () => {
  it('does not expose provider payloads or credentials', () => {
    const safe = sanitizeError(new Error('Authorization: Bearer secret; provider body: unsafe'));
    expect(safe).toEqual({
      code: 'UNKNOWN',
      message: '发生未知错误，请稍后重试。',
      retryable: true,
    });
    expect(JSON.stringify(safe)).not.toContain('secret');
  });
});
