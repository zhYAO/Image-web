import { describe, expect, it } from 'vitest';
import { buildCommerceSlots, creativeBatchCreateSchema, creativeBatchSchema } from '../src';

const settings = { provider: 'gemini' as const, model: 'gemini-3-pro-image', aspectRatio: '1:1' as const, resolution: '2K' as const };
const brief = () => ({ name: '测试商品', description: '已确认的商品描述', facts: '', sellingPoints: '', platform: 'taobao' as const,
  placement: '商品展示', productReferenceIds: [crypto.randomUUID()], styleReferenceIds: [] });
const task = () => {
  const product = brief();
  return { plan: { scene: 'product-set' as const, brief: product, templateId: 'soft-studio', slots: buildCommerceSlots(product, 'product-set', 7, settings) }, overrides: {} };
};

describe('creative batch contract', () => {
  it('accepts twenty independent product tasks and refuses a twenty-first', () => {
    const input = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), workflow: 'product-set' as const, globalParams: {}, tasks: Array.from({ length: 20 }, task) };
    expect(creativeBatchCreateSchema.parse(input).tasks).toHaveLength(20);
    expect(creativeBatchCreateSchema.safeParse({ ...input, tasks: [...input.tasks, task()] }).success).toBe(false);
  });

  it('rejects a child plan for a different workflow', () => {
    const input = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), workflow: 'clone' as const, globalParams: {}, tasks: [task()] };
    expect(creativeBatchCreateSchema.safeParse(input).success).toBe(false);
  });

  it('preserves retry metadata and a child that needs manual review', () => {
    const input = {
      id: crypto.randomUUID(), sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(),
      workflow: 'product-set', globalParams: {}, createdAt: '2026-10-08T00:00:00Z',
      updatedAt: '2026-10-08T00:00:00Z', nextAttemptAt: null,
      items: [{ id: crypto.randomUUID(), createRequestId: crypto.randomUUID(),
        submitRequestId: crypto.randomUUID(), ...task(), status: 'needs_review',
        attemptCount: 4, nextAttemptAt: '2026-10-08T00:15:00Z' }],
    };
    expect(creativeBatchSchema.parse(input)).toMatchObject({
      nextAttemptAt: null, items: [{ status: 'needs_review', attemptCount: 4,
        nextAttemptAt: '2026-10-08T00:15:00Z' }],
    });
  });
});
