import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCreativeBatchProgress } from '@/server/commerce/commerce-batch-service';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return executeRoute(async () => {
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const id = z.uuid().parse((await context.params).id);
    return Response.json(await getCreativeBatchProgress(createSupabaseAdminClient(), userId, id),
      { headers: { 'cache-control': 'no-store' } });
  });
}
