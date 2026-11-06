import {
  IMAGE_PROVIDER_CAPABILITIES,
  MODEL_REGISTRY_VERSION,
  providerStatusResponseSchema,
} from '@zimage/domain';
import { NextResponse } from 'next/server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ApiRouteError } from '@/server/api-error';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';

export async function GET() {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    await requireVerifiedUserId(client);
    const { data, error } = await createSupabaseAdminClient().rpc('get_provider_health');
    if (error || !data) {
      throw new ApiRouteError({
        code: 'network',
        message: 'Provider 状态暂时不可用，请稍后重试。',
        retryable: true,
        status: 503,
      });
    }
    return NextResponse.json(providerStatusResponseSchema.parse({
      capabilities: IMAGE_PROVIDER_CAPABILITIES,
      health: (data as Array<{provider:string}>).filter(item => item.provider !== 'minimax'),
      registryVersion: MODEL_REGISTRY_VERSION,
    }));
  });
}
