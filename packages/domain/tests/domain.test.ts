import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_BYTES,
  aggregateBatchStatus,
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
