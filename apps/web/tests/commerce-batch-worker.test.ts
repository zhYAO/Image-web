import { buildCommerceSlots } from '@zimage/domain';
import { describe, expect, it, vi } from 'vitest';
import { ApiRouteError } from '@/server/api-error';
import { getCreativeBatchProgress, processClaimedCreativeBatch, runCreativeBatchWorker } from '@/server/commerce/commerce-batch-service';

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

function fakeStore(row: ReturnType<typeof makeRow>) {
  const checkpoints: Array<{ items: typeof row.items; next: string | null; release: boolean }> = [];
  const admin = { rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
    checkpoints.push({ items: structuredClone(args.p_items as typeof row.items),
      next: args.p_next_attempt_at as string | null, release: args.p_release as boolean });
    return { data: [{ ...row, items: args.p_items, next_attempt_at: args.p_next_attempt_at }], error: null };
  }) };
  return { admin, checkpoints };
}

describe('claimed creative batch', () => {
  it('returns aggregate progress without media and stops after all children finish', async () => {
    const row = makeRow();
    const admin = { rpc: vi.fn(async () => ({ data: { id: row.id, createdAt: row.created_at,
      updatedAt: row.updated_at, items: [{ id: row.items[0]!.id, status: 'submitted',
        total: 1, succeeded: 1, failed: 0, processing: 0 }] }, error: null })) };
    const progress = await getCreativeBatchProgress(admin as never, row.user_id, row.id);
    expect(progress.terminal).toBe(true);
    expect(JSON.stringify(progress)).not.toContain('url');
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
  it('checkpoints the created task before submitting and closes the due work', async () => {
    const row = makeRow();
    const { admin, checkpoints } = fakeStore(row);
    const dispatch = vi.fn(async (_user: string, operation: string) =>
      operation === 'create' ? { id: crypto.randomUUID() } : { runs: [{ requestId: row.items[0]!.submitRequestId }] });
    await processClaimedCreativeBatch(admin as never, row as never, 'trace', dispatch as never);
    expect(checkpoints[0]!.items[0]).toMatchObject({ status: 'created', taskId: expect.any(String) });
    expect(checkpoints[0]!.release).toBe(false);
    expect(checkpoints.at(-1)!.items[0]).toMatchObject({ status: 'submitted' });
    expect(checkpoints.at(-1)!.next).toBeNull();
    expect(checkpoints.at(-1)!.release).toBe(true);
  });

  it('quarantines an uncertain submission after checking its stable request id', async () => {
    const row = makeRow();
    row.items[0]!.status = 'created';
    Object.assign(row.items[0]!, { taskId: crypto.randomUUID() });
    const { admin, checkpoints } = fakeStore(row);
    const dispatch = vi.fn(async (_user: string, operation: string) => {
      if (operation === 'submit') throw new TypeError('connection lost');
      return { runs: [] };
    });
    await processClaimedCreativeBatch(admin as never, row as never, 'trace', dispatch as never);
    expect(dispatch.mock.calls.map(call => call[1])).toEqual(['submit', 'get']);
    expect(checkpoints.at(-1)!.items[0]).toMatchObject({ status: 'needs_review' });
    expect(checkpoints.at(-1)!.next).toBeNull();
  });
  it('marks a 409 replay as submitted when the same request id already owns a run', async () => {
    const row = makeRow();
    row.items[0]!.status = 'created';
    Object.assign(row.items[0]!, { taskId: crypto.randomUUID() });
    const { admin, checkpoints } = fakeStore(row);
    const dispatch = vi.fn(async (_user: string, operation: string) => {
      if (operation === 'submit') throw new ApiRouteError({ code: 'conflict', status: 409,
        retryable: false, message: 'conflict' });
      return { runs: [{ requestId: row.items[0]!.submitRequestId }] };
    });
    await processClaimedCreativeBatch(admin as never, row as never, 'trace', dispatch as never);
    expect(dispatch.mock.calls.map(call => call[1])).toEqual(['submit', 'get']);
    expect(checkpoints.at(-1)!.items[0]).toMatchObject({ status: 'submitted' });
    expect(checkpoints.at(-1)!.next).toBeNull();
  });
  it('processes at most twenty child items in one worker invocation', async () => {
    const rows = Array.from({ length: 21 }, () => makeRow());
    for (const row of rows) { row.items[0]!.status = 'created'; Object.assign(row.items[0]!, { taskId: crypto.randomUUID() }); }
    const queue = [...rows];
    const admin = { rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === 'claim_creative_batch_work'
        ? { data: queue.length ? [queue.shift()] : [], error: null }
        : { data: [{ ...rows.find(row => row.id === args.p_batch_id), items: args.p_items,
          next_attempt_at: args.p_next_attempt_at }], error: null }) };
    const dispatch = vi.fn(async () => ({ runs: [] }));
    const result = await runCreativeBatchWorker(admin as never, 'trace', dispatch as never);
    expect(result.processed).toBe(20);
    expect(queue).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(20);
  });
});
