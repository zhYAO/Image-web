import {
  generationBatchSchema,
  timelineItemSchema,
  type GenerationBatch,
  type SafeError,
  type TimelineItem,
} from '@zimage/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { ApiRouteError } from '@/server/api-error';

const assetRowSchema = z.object({
  asset_expires_at: z.iso.datetime({ offset: true }).nullable(),
  asset_status: z.enum(['active', 'expired', 'deleted']).nullable(),
  error_code: z.string().nullable(),
  id: z.uuid(),
  status: z.enum(['pending', 'processing', 'succeeded', 'failed']),
});

const batchRowSchema = z.object({
  assets: z.array(assetRowSchema),
  config: z.object({
    aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']),
    count: z.number().int().min(1).max(4),
    resolution: z.enum(['1K', '2K']),
  }),
  created_at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  model: z.string().min(1),
  prompt: z.string().min(1),
  provider: z.string().min(1),
  session_id: z.uuid(),
  source: z.enum(['direct', 'chat_tool']),
  status: z.enum(['pending', 'processing', 'partial', 'succeeded', 'failed']),
});

const timelineRowSchema = z.object({
  batch: batchRowSchema.nullable(),
  batch_id: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  error_code: z.string().nullable(),
  id: z.uuid(),
  kind: z.enum(['message', 'generation', 'error']),
  role: z.enum(['user', 'assistant']).nullable(),
  sequence: z.number().int().positive(),
  session_id: z.uuid(),
  status: z.string().nullable(),
  text: z.string().nullable(),
});

function safeGenerationError(errorCode: string | null): SafeError | undefined {
  if (!errorCode) return undefined;
  return {
    code: 'PROVIDER_UNAVAILABLE',
    message: '图片生成失败，可按原参数重新生成。',
    retryable: false,
  };
}

export function mapGenerationBatchRow(input: unknown): GenerationBatch {
  const batch = batchRowSchema.parse(input);
  return generationBatchSchema.parse({
    assets: batch.assets.map((asset) => ({
      error: safeGenerationError(asset.error_code),
      expired: asset.asset_status === 'expired',
      expiresAt: asset.asset_expires_at ?? undefined,
      id: asset.id,
      status: asset.status,
    })),
    config: batch.config,
    createdAt: batch.created_at,
    id: batch.id,
    model: batch.model,
    prompt: batch.prompt,
    provider: batch.provider,
    sessionId: batch.session_id,
    source: batch.source,
    status: batch.status,
  });
}

function mapTimelineRow(input: unknown): TimelineItem {
  const row = timelineRowSchema.parse(input);
  const base = {
    createdAt: row.created_at,
    id: row.id,
    sequence: row.sequence,
    sessionId: row.session_id,
  };

  if (row.kind === 'message') {
    return timelineItemSchema.parse({
      ...base,
      content: row.text,
      role: row.role,
      type: 'message',
    }) as TimelineItem;
  }

  if (row.kind === 'generation') {
    if (!row.batch) throw new Error('generation timeline item is missing its batch');
    return timelineItemSchema.parse({
      ...base,
      batch: mapGenerationBatchRow(row.batch),
      type: 'generation',
    }) as TimelineItem;
  }

  return timelineItemSchema.parse({
    ...base,
    actionLabel: '重试',
    error: {
      code: 'UNKNOWN',
      message: row.text ?? '操作失败，请稍后重试。',
      retryable: true,
    },
    type: 'error',
  }) as TimelineItem;
}

export function mapTimelineRows(input: unknown[]) {
  return input.map(mapTimelineRow).sort((left, right) => left.sequence - right.sequence);
}

export const generationBatchColumns = `
  id,session_id,source,status,prompt,provider,model,config,created_at,
  assets:generations(id,status,asset_status,asset_expires_at,error_code)
`;

const timelineColumns = `
  id,session_id,sequence,kind,role,text,batch_id,status,error_code,created_at,
  batch:generation_batches!timeline_items_batch_session_fk(${generationBatchColumns})
`;

export class SupabaseTimelineStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(input: { after?: number; limit: number; sessionId: string; userId: string }) {
    const ownership = await this.client
      .from('sessions')
      .select('id')
      .eq('id', input.sessionId)
      .eq('user_id', input.userId)
      .eq('status', 'active')
      .maybeSingle();
    if (ownership.error) throw this.failure();
    if (!ownership.data) {
      throw new ApiRouteError({
        code: 'not_found',
        message: '会话不存在或无权访问。',
        retryable: false,
        status: 404,
      });
    }

    let query = this.client
      .from('timeline_items')
      .select(timelineColumns)
      .eq('session_id', input.sessionId)
      .order('sequence', { ascending: true })
      .limit(input.limit + 1);
    if (input.after) query = query.gt('sequence', input.after);
    const { data, error } = await query;
    if (error) throw this.failure();

    const items = mapTimelineRows((data ?? []).slice(0, input.limit));
    return {
      items,
      nextCursor: (data?.length ?? 0) > input.limit ? items.at(-1)?.sequence : undefined,
    };
  }

  private failure() {
    return new ApiRouteError({
      code: 'network',
      message: '时间线暂时不可用，请稍后重试。',
      retryable: true,
      status: 503,
    });
  }
}
