import { generationBatchResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ApiRouteError } from '@/server/api-error';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { assertActiveBusinessSession } from '@/server/session-access';
import {
  generationBatchColumns,
  mapGenerationBatchRow,
} from '@/server/timeline/supabase-timeline-store';

interface BatchRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: BatchRouteContext) {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const { id } = await context.params;
    const batchId = z.uuid().parse(id);
    const { data, error } = await client
      .from('generation_batches')
      .select(generationBatchColumns)
      .eq('id', batchId)
      .maybeSingle();
    if (error) {
      throw new ApiRouteError({
        code: 'network',
        message: '生图状态暂时不可用，请稍后重试。',
        retryable: true,
        status: 503,
      });
    }
    if (!data) {
      throw new ApiRouteError({
        code: 'not_found',
        message: '生图批次不存在或无权访问。',
        retryable: false,
        status: 404,
      });
    }
    await assertActiveBusinessSession(client, userId, data.session_id);
    return NextResponse.json(generationBatchResponseSchema.parse({ batch: mapGenerationBatchRow(data) }));
  });
}
