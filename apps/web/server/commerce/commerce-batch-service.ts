import type { SupabaseClient } from '@supabase/supabase-js';
import { creativeBatchCreateSchema, creativeBatchSchema, type CreativeBatch } from '@zimage/domain';
import { ApiRouteError } from '@/server/api-error';
import { hashCanonicalRequest } from '@/server/image/image-service';
import { createCommerceService } from './commerce-service';
import { nextBatchAttempt } from './commerce-batch-schedule';
import { z } from 'zod';

type BatchRow = { id: string; user_id: string; session_id: string; request_id: string; workflow: string; global_params: Record<string, unknown>; items: unknown; created_at: string; updated_at: string; request_hash: string; lease_token: string | null; next_attempt_at: string | null };
const table = 'creative_batches';
const toBatch = (row: BatchRow) => creativeBatchSchema.parse({ id: row.id, sessionId: row.session_id, requestId: row.request_id, workflow: row.workflow, globalParams: row.global_params, items: row.items, createdAt: row.created_at, updatedAt: row.updated_at, nextAttemptAt: row.next_attempt_at });
const unavailable = () => new ApiRouteError({ code: 'not_found', status: 404, message: '批量任务不存在或无权访问。', retryable: false });

export async function createCreativeBatch(admin: SupabaseClient, userId: string, raw: unknown): Promise<CreativeBatch> {
  const input = creativeBatchCreateSchema.parse(raw);
  const ownership = await admin.from('sessions').select('id').eq('id', input.sessionId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (ownership.error || !ownership.data) throw unavailable();
  const hash = await hashCanonicalRequest(input);
  const existing = await admin.from(table).select('*').eq('user_id', userId).eq('request_id', input.requestId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    if (existing.data.request_hash !== hash) throw new ApiRouteError({ code: 'conflict', status: 409, message: '批量请求 ID 已用于其他内容。', retryable: false });
    return toBatch(existing.data as BatchRow);
  }
  const items = input.tasks.map(task => ({ id: crypto.randomUUID(), createRequestId: crypto.randomUUID(), submitRequestId: crypto.randomUUID(), plan: task.plan, billing: task.billing, overrides: task.overrides, status: 'pending', attemptCount: 0 }));
  const inserted = await admin.from(table).insert({ user_id: userId, session_id: input.sessionId, request_id: input.requestId, request_hash: hash, workflow: input.workflow, global_params: input.globalParams, items, next_attempt_at: new Date().toISOString() }).select('*').single();
  if (inserted.error) {
    const replay = await admin.from(table).select('*').eq('user_id', userId).eq('request_id', input.requestId).single();
    if (!replay.error && replay.data?.request_hash === hash) return toBatch(replay.data as BatchRow);
    throw new Error(inserted.error.message);
  }
  return toBatch(inserted.data as BatchRow);
}

export async function getCreativeBatch(admin: SupabaseClient, userId: string, batchId: string) {
  const result = await admin.from(table).select('*').eq('id', batchId).eq('user_id', userId).maybeSingle();
  if (result.error || !result.data) throw unavailable();
  return toBatch(result.data as BatchRow);
}

export async function listCreativeBatches(admin: SupabaseClient, userId: string, sessionId: string) {
  const result = await admin.from(table).select('*').eq('user_id', userId).eq('session_id', sessionId).order('created_at', { ascending: false }).limit(30);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map(row => toBatch(row as BatchRow));
}

const batchProgressSchema = z.object({
  id: z.uuid(), createdAt: z.string(), updatedAt: z.string(),
  items: z.array(z.object({ id: z.uuid(), taskId: z.uuid().nullable().optional(),
    status: z.enum(['pending', 'created', 'submitted', 'failed', 'needs_review']),
    error: z.string().nullable().optional(), total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
  })),
});
export async function getCreativeBatchProgress(admin: SupabaseClient, userId: string, batchId: string) {
  const result = await admin.rpc('get_creative_batch_progress', { p_batch_id: batchId, p_user_id: userId });
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw unavailable();
  const progress = batchProgressSchema.parse(result.data);
  return { ...progress, terminal: progress.items.every(item =>
    item.status === 'failed' || item.status === 'needs_review' ||
    item.status === 'submitted' && item.total > 0 && item.processing === 0) };
}

export async function advanceCreativeBatch(admin: SupabaseClient, userId: string, batchId: string, correlationId: string) {
  const claim = await admin.rpc('claim_creative_batch_work', { p_batch_id: batchId, p_user_id: userId });
  if (claim.error) throw new Error(claim.error.message);
  const row = (claim.data as BatchRow[] | null)?.[0];
  if (!row) return getCreativeBatch(admin, userId, batchId);
  return processClaimedCreativeBatch(admin, row, correlationId);
}

type Dispatcher = ReturnType<typeof createCommerceService>['dispatch'];
const dueAt = (batch: CreativeBatch, now = new Date()) => {
  const remaining = batch.items.filter(item => item.status === 'pending' || item.status === 'created');
  if (!remaining.length) return null;
  return remaining.map(item => item.nextAttemptAt ?? now.toISOString()).sort()[0]!;
};

export async function processClaimedCreativeBatch(
  admin: SupabaseClient, row: BatchRow, correlationId: string,
  dispatch: Dispatcher = createCommerceService(admin).dispatch,
): Promise<CreativeBatch> {
  if (!row.lease_token) throw new Error('batch_lease_missing');
  const batch = toBatch(row);
  const token = row.lease_token;
  const checkpoint = async (release: boolean) => {
    const next = dueAt(batch);
    const result = await admin.rpc('checkpoint_creative_batch_work', {
      p_batch_id: batch.id, p_lease_token: token, p_items: batch.items,
      p_next_attempt_at: next, p_release: release,
    });
    if (result.error || !(result.data as BatchRow[] | null)?.length) throw new Error('batch_lease_lost');
    return toBatch((result.data as BatchRow[])[0]!);
  };
  const item = batch.items.find(entry => (entry.status === 'pending' || entry.status === 'created')
    && (!entry.nextAttemptAt || Date.parse(entry.nextAttemptAt) <= Date.now()));
  if (!item) return checkpoint(true);
  const retry = (cause: unknown, uncertain: boolean) => {
    item.error = cause instanceof Error ? cause.message : '子任务暂时无法提交';
    const attempt = (item.attemptCount ?? 0) + 1;
    item.attemptCount = attempt;
    if (uncertain || cause instanceof ApiRouteError && cause.status === 409) {
      item.status = 'needs_review'; item.nextAttemptAt = undefined;
    } else if (cause instanceof ApiRouteError && cause.status >= 400 && cause.status < 500 && !cause.retryable) {
      item.status = 'failed'; item.nextAttemptAt = undefined;
    } else {
      const next = nextBatchAttempt(attempt);
      if (next) item.nextAttemptAt = next;
      else { item.status = 'needs_review'; item.nextAttemptAt = undefined; }
    }
  };
  try {
    if (!item.taskId) {
      const task = await dispatch(row.user_id, 'create', undefined,
        { requestId: item.createRequestId, sessionId: batch.sessionId, plan: item.plan }, correlationId);
      item.taskId = (task as { id: string }).id;
      item.status = 'created'; item.error = undefined;
      await checkpoint(false);
    }
    if (process.env.ZIMAGE_COMMERCE_SUBMIT_ENABLED === 'false') {
      item.nextAttemptAt = new Date(Date.now() + 60_000).toISOString();
      return checkpoint(true);
    }
    try {
      await dispatch(row.user_id, 'submit', item.taskId,
        { requestId: item.submitRequestId, revision: 1,
          slotIds: item.plan.slots.map(slot => slot.id), billing: item.billing,
          recreate: false, source: 'direct' }, correlationId);
      item.status = 'submitted'; item.error = undefined; item.nextAttemptAt = undefined;
    } catch (cause) {
      let found = false;
      try {
        const task = await dispatch(row.user_id, 'get', item.taskId, {}, correlationId) as { runs: Array<{ requestId: string }> };
        found = task.runs.some(run => run.requestId === item.submitRequestId);
      } catch { /* A failed read cannot establish that a charge was not made. */ }
      if (found) { item.status = 'submitted'; item.error = undefined; item.nextAttemptAt = undefined; }
      else retry(cause, !(cause instanceof ApiRouteError));
    }
  } catch (cause) { retry(cause, false); }
  return checkpoint(true);
}

export async function runCreativeBatchWorker(admin: SupabaseClient, correlationId: string,
  dispatch: Dispatcher = createCommerceService(admin).dispatch) {
  const deadline = Date.now() + 45_000;
  let processed = 0;
  while (processed < 20 && Date.now() < deadline) {
    const claim = await admin.rpc('claim_creative_batch_work', { p_batch_id: null, p_user_id: null });
    if (claim.error) throw new Error(claim.error.message);
    const row = (claim.data as BatchRow[] | null)?.[0];
    if (!row) break;
    await processClaimedCreativeBatch(admin, row, correlationId, dispatch);
    processed++;
  }
  return { processed };
}
