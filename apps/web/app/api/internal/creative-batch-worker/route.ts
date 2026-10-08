import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ApiRouteError } from '@/server/api-error';
import { runCreativeBatchWorker } from '@/server/commerce/commerce-batch-service';
import { hasBatchWorkerSecret } from '@/server/commerce/commerce-batch-secret';
import { executeRoute } from '@/server/route-context';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  return executeRoute(async correlationId => {
    if (!hasBatchWorkerSecret(request.headers.get('x-batch-cron-secret'), process.env.ZIMAGE_BATCH_CRON_SECRET))
      throw new ApiRouteError({ code: 'unauthorized', status: 401, retryable: false, message: '未授权的批次调度请求。' });
    const result = await runCreativeBatchWorker(createSupabaseAdminClient(), correlationId);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  });
}
