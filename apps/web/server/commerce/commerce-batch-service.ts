import type { SupabaseClient } from '@supabase/supabase-js';
import { creativeBatchCreateSchema, creativeBatchSchema, type CreativeBatch } from '@zimage/domain';
import { ApiRouteError } from '@/server/api-error';
import { hashCanonicalRequest } from '@/server/image/image-service';
import { createCommerceService } from './commerce-service';

type BatchRow = { id: string; session_id: string; request_id: string; workflow: string; global_params: Record<string, unknown>; items: unknown; created_at: string; updated_at: string; request_hash: string; lease_token?: string | null };
const table = 'creative_batches';
const toBatch = (row: BatchRow) => creativeBatchSchema.parse({ id: row.id, sessionId: row.session_id, requestId: row.request_id, workflow: row.workflow, globalParams: row.global_params, items: row.items, createdAt: row.created_at, updatedAt: row.updated_at });
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
  const items = input.tasks.map(task => ({ id: crypto.randomUUID(), createRequestId: crypto.randomUUID(), submitRequestId: crypto.randomUUID(), plan: task.plan, billing: task.billing, overrides: task.overrides, status: 'pending' }));
  const inserted = await admin.from(table).insert({ user_id: userId, session_id: input.sessionId, request_id: input.requestId, request_hash: hash, workflow: input.workflow, global_params: input.globalParams, items }).select('*').single();
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

export async function advanceCreativeBatch(admin: SupabaseClient, userId: string, batchId: string, correlationId: string) {
  const token = crypto.randomUUID();
  const now = new Date();
  const lease = await admin.from(table).update({ lease_token: token, lease_until: new Date(now.getTime() + 120_000).toISOString() })
    .eq('id', batchId).eq('user_id', userId).or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select('*').maybeSingle();
  if (lease.error) throw new Error(lease.error.message);
  if (!lease.data) return getCreativeBatch(admin, userId, batchId);
  const row = lease.data as BatchRow;
  const batch = toBatch(row);
  const index = batch.items.findIndex(item => item.status === 'pending' || item.status === 'created');
  if (index < 0) {
    await admin.from(table).update({ lease_token: null, lease_until: null }).eq('id', batchId).eq('lease_token', token);
    return batch;
  }
  const service = createCommerceService(admin);
  const item = batch.items[index]!;
  try {
    if (!item.taskId) {
      const task = await service.dispatch(userId, 'create', undefined, { requestId: item.createRequestId, sessionId: batch.sessionId, plan: item.plan }, correlationId);
      item.taskId = (task as { id: string }).id;
      item.status = 'created';
      const saved = await admin.from(table).update({ items: batch.items, updated_at: new Date().toISOString() }).eq('id', batchId).eq('lease_token', token).select('id').maybeSingle();
      if (saved.error || !saved.data) throw new Error('batch_lease_lost');
    }
    await service.dispatch(userId, 'submit', item.taskId, { requestId: item.submitRequestId, revision: 1, slotIds: item.plan.slots.map(slot => slot.id), billing: item.billing, recreate: false, source: 'direct' }, correlationId);
    item.status = 'submitted'; item.error = undefined;
  } catch (cause) {
    item.error = cause instanceof Error ? cause.message : '子任务暂时无法提交';
    if (cause instanceof ApiRouteError && cause.status >= 400 && cause.status < 500 && cause.status !== 409) item.status = 'failed';
  }
  const saved = await admin.from(table).update({ items: batch.items, lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq('id', batchId).eq('lease_token', token).select('*').maybeSingle();
  if (saved.error || !saved.data) throw new Error('batch_lease_lost');
  return toBatch(saved.data as BatchRow);
}
