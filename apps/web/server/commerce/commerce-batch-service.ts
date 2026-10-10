import type { SupabaseClient } from '@supabase/supabase-js';
import { creativeBatchSchema } from '@zimage/domain';
import { ApiRouteError } from '@/server/api-error';
import { assertActiveBusinessSession } from '@/server/session-access';
import { z } from 'zod';

type BatchRow = { id: string; user_id: string; session_id: string; request_id: string; workflow: string; global_params: Record<string, unknown>; items: unknown; created_at: string; updated_at: string; request_hash: string; lease_token: string | null; next_attempt_at: string | null };
const table = 'creative_batches';
const toBatch = (row: BatchRow) => creativeBatchSchema.parse({ id: row.id, sessionId: row.session_id, requestId: row.request_id, workflow: row.workflow, globalParams: row.global_params, items: row.items, createdAt: row.created_at, updatedAt: row.updated_at, nextAttemptAt: row.next_attempt_at });
const unavailable = () => new ApiRouteError({ code: 'not_found', status: 404, message: '批量任务不存在或无权访问。', retryable: false });

export async function getCreativeBatch(admin: SupabaseClient, userId: string, batchId: string) {
  const result = await admin.from(table).select('*').eq('id', batchId).eq('user_id', userId).maybeSingle();
  if (result.error || !result.data) throw unavailable();
  await assertActiveBusinessSession(admin, userId, result.data.session_id);
  return toBatch(result.data as BatchRow);
}

export async function listCreativeBatches(admin: SupabaseClient, userId: string, sessionId: string) {
  await assertActiveBusinessSession(admin, userId, sessionId);
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
    processing: z.number().int().nonnegative(), review: z.number().int().nonnegative(),
  })),
});
export async function getCreativeBatchProgress(admin: SupabaseClient, userId: string, batchId: string) {
  const batch = await admin.from(table).select('session_id').eq('id', batchId).eq('user_id', userId).maybeSingle();
  if (batch.error || !batch.data) throw unavailable();
  await assertActiveBusinessSession(admin, userId, batch.data.session_id);
  const result = await admin.rpc('get_creative_batch_progress', { p_batch_id: batchId, p_user_id: userId });
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw unavailable();
  const progress = batchProgressSchema.parse(result.data);
  return { ...progress, terminal: progress.items.every(item =>
    item.status === 'failed' || item.status === 'needs_review' ||
    item.status === 'submitted' && item.total > 0 && item.processing === 0) };
}
