import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { getCreativeBatch } from '@/server/commerce/commerce-batch-service';

export const runtime = 'nodejs';
export const maxDuration = 120;
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return executeRoute(async () => {
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const id = z.uuid().parse((await context.params).id);
    const admin: SupabaseClient = createSupabaseAdminClient();
    return Response.json(await getCreativeBatch(admin, userId, id), { headers: { 'cache-control': 'no-store' } });
  });
}
export async function POST() {
  return Response.json({ code: 'gone', message: '批量发起已停用，历史任务仍可查看。' }, { status: 410, headers: { 'cache-control': 'no-store' } });
}
