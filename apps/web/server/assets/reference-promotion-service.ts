import { commercePromoteResultSchema, commercePromoteSchema } from '@zimage/domain';
import { z } from 'zod';
import { ApiRouteError } from '@/server/api-error';
import { validateReferenceUpload } from '@/server/assets/reference-upload-service';
import { createPreviewUsageGuard, PreviewUsageRetentionError, type PreviewUsageRpcClient } from '@/server/preview/preview-usage-guard';

interface ReferenceStorageClient extends PreviewUsageRpcClient {
  storage: { from(bucket: string): {
    download(path: string): PromiseLike<{ data: Pick<Blob, 'size' | 'arrayBuffer'> | null; error: unknown }>;
    upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean; cacheControl: string }): PromiseLike<{ error: unknown }>;
    remove(paths: string[]): PromiseLike<{ error: unknown }>;
  } };
}
function failure(message = '') {
  const [status, code, text] = /quota_exceeded/.test(message)
    ? [429, 'quota_exceeded', '请求额度已用完，请稍后重试。'] as const
    : /invalid_source_size/.test(message)
      ? [400, 'bad_request', '源图大小无效或超过 10 MB，请重新选择。'] as const
      : /conflict|in_progress|not_succeeded/.test(message)
    ? [409, 'conflict', '样图状态已变化或正在转为参考图，请稍后重试。'] as const
    : /not_found|unauthorized|forbidden/.test(message)
      ? [404, 'not_found', '任务或素材不存在，或无权访问。'] as const
      : /expired/.test(message)
        ? [410, 'asset_expired', '样图或参考图已失效，请重新选择。'] as const
        : /capacity/.test(message)
          ? [400, 'bad_request', '每个会话最多保留 64 张有效参考图。'] as const
          : [503, 'network', '参考图暂时无法保存，请稍后重试。'] as const;
  return new ApiRouteError({ code, status, message: text, retryable: status >= 500 || /in_progress/.test(message) });
}
async function rpc(client: PreviewUsageRpcClient, name: string, input: Record<string, unknown>) {
  // Never propagate Storage paths, source bodies, or raw RPC diagnostics to logs.
  try {
    const { data, error } = await client.rpc(name, input);
    if (error) throw failure(error.message);
    return data;
  } catch (error) {
    if (error instanceof ApiRouteError) throw error;
    throw failure();
  }
}
export async function referenceWriteIntent(client: PreviewUsageRpcClient, userId: string, referenceId: string, operation: 'register' | 'finalize' | 'abandon') {
  const data = await rpc(client, 'reference_write_intent', { p_user_id: userId, p_reference_id: referenceId, p_operation: operation });
  if (operation === 'register') {
    if (data !== true) throw failure();
    return true;
  }
  if (operation === 'finalize') {
    const result = commercePromoteResultSchema.safeParse(data);
    if (!result.success || result.data.id !== referenceId) throw failure();
    return result.data;
  }
  const abandoned = z.object({ remove: z.boolean() }).safeParse(data);
  if (!abandoned.success) throw failure();
  return abandoned.data;
}

// A durable intent already exists before any Storage call. Only remove after the
// database has fenced finalization; an ambiguous finalize may have succeeded.
export async function compensateReferenceWrite(client: ReferenceStorageClient, userId: string, referenceId: string, path: string, originalError: unknown): Promise<never> {
  try {
    const result = z.object({ remove: z.boolean() }).parse(await referenceWriteIntent(client, userId, referenceId, 'abandon'));
    if (!result.remove) throw new Error('reference_remains_active');
    const removed = await client.storage.from('uploads').remove([path]);
    if (removed.error) throw new Error('reference_cleanup_pending');
  } catch {
    // Preserve usage accounting until compensation can be confirmed. The intent
    // is never deleted, even after successful removal, to catch late uploads.
    throw new PreviewUsageRetentionError(originalError);
  }
  throw originalError;
}

export function createReferencePromotionService(client: ReferenceStorageClient) {
  return {
    async promote(userId: string, taskId: string, raw: unknown, correlationId: string) {
      z.uuid().parse(userId); z.uuid().parse(taskId);
      const input = commercePromoteSchema.parse(raw);
      const args = { p_user_id: userId, p_task_id: taskId, p_request_id: input.requestId, p_generation_id: input.generationId };
      const lookup = await rpc(client, 'promote_commerce_reference', args);
      const reused = z.object({ reference: commercePromoteResultSchema }).safeParse(lookup);
      if (reused.success) return reused.data.reference;
      const source = z.object({ sessionId: z.uuid(), storagePath: z.string().min(1), size: z.number().int().min(1).max(10 * 1024 * 1024) }).parse(lookup);
      const guard = createPreviewUsageGuard(client);
      // SQL already bounded/charged request admission and checked pending/history
      // capacity. Reserve trusted Storage metadata bytes BEFORE reading the object.
      const businessKey = `promotion:${crypto.randomUUID()}`;
      await guard.reserve({ userId, correlationId, businessKey, bytes: source.size, createsSession: false, operation: 'upload' });
      let result: z.infer<typeof commercePromoteResultSchema>;
      try {
        let blob: Pick<Blob, 'size' | 'arrayBuffer'>;
        try {
          const downloaded = await client.storage.from('generated').download(source.storagePath);
          if (downloaded.error || !downloaded.data) throw failure();
          blob = downloaded.data;
        } catch { throw failure(); }
        if (blob.size < 1 || blob.size > source.size) {
          throw new ApiRouteError({ code: 'bad_request', status: 400, message: '源图大小已变化或超过 10 MB，请重新选择。', retryable: false });
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.byteLength !== blob.size) throw failure();
        // Derive type from downloaded bytes, never a URL or caller MIME.
        const mimeType = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : 'image/webp';
        const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice(6);
        const name = `reference.${extension}`;
        const metadata = await validateReferenceUpload({ bytes, mimeType, name, size: bytes.byteLength });
        if (bytes.byteLength < source.size) {
          const reconciled = await rpc(client, 'reconcile_reference_promotion_usage', {
            p_user_id: userId, p_business_key: businessKey, p_correlation_id: correlationId, p_bytes: bytes.byteLength,
          });
          if (reconciled !== true) throw failure();
        }
        const prepared = await rpc(client, 'promote_commerce_reference', { ...args, p_metadata: { ...metadata, name, mimeType, size: bytes.byteLength } });
        const winner = z.object({ reference: commercePromoteResultSchema }).safeParse(prepared);
        if (winner.success) {
          await guard.release(userId, businessKey, correlationId);
          return winner.data.reference;
        }
        const target = z.object({ referenceId: z.uuid(), storagePath: z.string().min(1) }).parse(prepared);
        try {
          const uploaded = await client.storage.from('uploads').upload(target.storagePath, bytes, { contentType: mimeType, upsert: false, cacheControl: '3600' });
          if (uploaded.error) throw failure();
          result = commercePromoteResultSchema.parse(await referenceWriteIntent(client, userId, target.referenceId, 'finalize'));
        } catch (error) {
          await compensateReferenceWrite(client, userId, target.referenceId, target.storagePath,
            error instanceof ApiRouteError ? error : failure());
          throw failure();
        }
      } catch (error) {
        if (error instanceof PreviewUsageRetentionError) throw error.originalError;
        try { await guard.release(userId, businessKey, correlationId); } catch { /* fail-safe reservation */ }
        throw error;
      }
      // A lost usage commit must not turn a durable successful promotion into a
      // failed response. The guard's existing reservation remains fail-safe.
      try { await guard.commit(userId, businessKey); } catch { /* retained reservation */ }
      return result;
    },
  };
}
