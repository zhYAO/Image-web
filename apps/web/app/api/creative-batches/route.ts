import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';
import { advanceCreativeBatch, createCreativeBatch, listCreativeBatches } from '@/server/commerce/commerce-batch-service';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  return executeRoute(async correlationId => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const admin: SupabaseClient = createSupabaseAdminClient();
    const batch = await createCreativeBatch(admin, userId, await readJson(request));
    try {
      return Response.json(await advanceCreativeBatch(admin, userId, batch.id, correlationId), { headers: { 'cache-control': 'no-store' } });
    } catch {
      // The persisted batch remains due for Cron even if the immediate attempt fails.
      return Response.json(batch, { headers: { 'cache-control': 'no-store' } });
    }
  });
}
export async function GET(request: Request) {
  return executeRoute(async () => {
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const sessionId = z.uuid().parse(new URL(request.url).searchParams.get('sessionId'));
    const admin: SupabaseClient = createSupabaseAdminClient();
    return Response.json(await listCreativeBatches(admin, userId, sessionId), { headers: { 'cache-control': 'no-store' } });
  });
}
