import { imageRequestSchema, imageSubmissionResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createImageService } from '@/server/image/image-service';
import { SupabaseGenerationStore } from '@/server/image/supabase-generation-store';
import { createPreviewUsageGuard, withPreviewUsageReservation } from '@/server/preview/preview-usage-guard';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const userClient = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(userClient);
    const input = imageRequestSchema.parse(await readJson(request));
    const idempotencyKey = z.uuid().parse(request.headers.get('idempotency-key'));
    const admin = createSupabaseAdminClient();
    const imageService = createImageService(new SupabaseGenerationStore(admin));
    const prepared = await imageService.prepare(userId, input, idempotencyKey, correlationId);
    return withPreviewUsageReservation(createPreviewUsageGuard(admin), {
      businessKey: `generation:${idempotencyKey}`,
      correlationId,
      createsSession: !prepared.sessionId,
      operation: 'generation',
      userId,
    }, async () => {
      const result = await imageService.submitPrepared(prepared);
      return NextResponse.json(imageSubmissionResponseSchema.parse(result), { status: 202 });
    });
  });
}
