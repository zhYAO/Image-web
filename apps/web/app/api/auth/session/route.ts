import { createSupabaseServerClient } from '@/lib/supabase/server';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';

/** Workspace bootstrap needs identity, not the account profile and email. */
export function GET() {
  return executeRoute(async () => {
    const id = await requireVerifiedUserId(await createSupabaseServerClient());
    return Response.json({ id }, { headers: { 'cache-control': 'private, no-store' } });
  });
}
