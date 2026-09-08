import { commercePromoteResultSchema, commercePromoteSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createReferencePromotionService } from '@/server/assets/reference-promotion-service';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return executeRoute(async correlationId => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const input = commercePromoteSchema.parse(await readJson(request));
    const { id } = await context.params;
    const result = await createReferencePromotionService(createSupabaseAdminClient()).promote(userId, id, input, correlationId);
    return NextResponse.json(commercePromoteResultSchema.parse(result));
  });
}
