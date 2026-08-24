import { quotaSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ApiRouteError } from '@/server/api-error';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';

export async function GET() {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const { data, error } = await createSupabaseAdminClient().rpc('get_user_quota', { p_user_id: userId });
    if (error || !data) {
      throw new ApiRouteError({
        code: 'network',
        message: '额度暂时不可用，请稍后重试。',
        retryable: true,
        status: 503,
      });
    }
    return NextResponse.json(quotaSchema.parse(data));
  });
}
