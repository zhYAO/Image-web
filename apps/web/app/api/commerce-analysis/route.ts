import { executeRoute, assertTrustedOrigin, requireVerifiedUserId } from '@/server/route-context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ApiRouteError } from '@/server/api-error';
export const runtime='nodejs';
export async function POST(request:Request) {
 return executeRoute(async()=>{
  assertTrustedOrigin(request);
  await requireVerifiedUserId(await createSupabaseServerClient());
  // No configurable bypass: metered quotes, durable request recovery and an approved
  // tariff must be integrated before this route can submit any provider request.
  throw new ApiRouteError({code:'service_not_ready',status:503,retryable:false,message:'图片分析计费尚未确定，真实分析暂不可用。商品资料仍可手动填写。'});
 });
}
