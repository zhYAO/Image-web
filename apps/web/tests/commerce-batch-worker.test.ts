import { buildCommerceSlots } from '@zimage/domain';
import { describe, expect, it, vi } from 'vitest';
import { getCreativeBatchProgress } from '@/server/commerce/commerce-batch-service';

const makeRow = () => {
  const userId = crypto.randomUUID();
  const referenceId = crypto.randomUUID();
  const brief = { name: '测试杯子', description: '白色杯子', facts: '', sellingPoints: '',
    platform: 'taobao' as const, placement: '商品展示', productReferenceIds: [referenceId], styleReferenceIds: [] };
  const plan = { scene: 'product-set' as const, brief, templateId: 'soft-studio',
    slots: buildCommerceSlots(brief, 'product-set', 1, {
      provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '1:1', resolution: '2K',
    }) };
  return { id: crypto.randomUUID(), user_id: userId, session_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(), request_hash: 'hash', workflow: 'product-set',
    global_params: {}, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z',
    lease_token: crypto.randomUUID(), next_attempt_at: '2026-10-08T00:00:00Z',
    items: [{ id: crypto.randomUUID(), createRequestId: crypto.randomUUID(),
      submitRequestId: crypto.randomUUID(), plan, overrides: {}, status: 'pending' }] };
};

describe('legacy creative batch progress', () => {
  it('returns aggregate progress without media and stops after all children finish', async () => {
    const row = makeRow();
    const admin = { from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () =>
        ({ data: table === 'sessions' ? { id: row.session_id } : { session_id: row.session_id }, error: null }) };
      return query;
    }, rpc: vi.fn(async () => ({ data: { id: row.id, createdAt: row.created_at,
      updatedAt: row.updated_at, items: [{ id: row.items[0]!.id, status: 'submitted',
        total: 1, succeeded: 1, failed: 0, processing: 0, review: 0 }] }, error: null })) };
    const progress = await getCreativeBatchProgress(admin as never, row.user_id, row.id);
    expect(progress.terminal).toBe(true);
    expect(JSON.stringify(progress)).not.toContain('url');
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
  it('stops polling a submitted image awaiting provider reconciliation', async () => {
    const row = makeRow();
    const admin = { from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () =>
        ({ data: table === 'sessions' ? { id: row.session_id } : { session_id: row.session_id }, error: null }) };
      return query;
    }, rpc: vi.fn(async () => ({ data: { id: row.id, createdAt: row.created_at,
      updatedAt: row.updated_at, items: [{ id: row.items[0]!.id, status: 'submitted',
        total: 1, succeeded: 0, failed: 0, processing: 0, review: 1 }] }, error: null })) };
    const progress = await getCreativeBatchProgress(admin as never, row.user_id, row.id);
    expect(progress.terminal).toBe(true);
    expect(progress.items[0]).toMatchObject({ review: 1, processing: 0 });
  });
});
