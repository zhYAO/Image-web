import { recreateImageRequestSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { hashCanonicalRequest, toImageSubmissionResponse } from '@/server/image/image-service';
import { SupabaseGenerationStore } from '@/server/image/supabase-generation-store';
import { createPreviewUsageGuard, withPreviewUsageReservation } from '@/server/preview/preview-usage-guard';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const input = recreateImageRequestSchema.parse(await readJson(request));
    const idempotencyKey = z.uuid().parse(request.headers.get('idempotency-key'));
    const admin = createSupabaseAdminClient();
    return withPreviewUsageReservation(createPreviewUsageGuard(admin), {
      businessKey: `generation-recreate:${idempotencyKey}`,
      correlationId,
      createsSession: false,
      operation: 'generation_recreate',
      userId,
    }, async () => {
      const result = await new SupabaseGenerationStore(admin).recreate({
        batchId: input.batchId,
        correlationId,
        generationId: input.generationId,
        idempotencyKey,
        mode: input.mode,
        requestHash: await hashCanonicalRequest({ input, userId }),
        userId,
      });
      return NextResponse.json(toImageSubmissionResponse(result), { status: 202 });
    });
  });
}
