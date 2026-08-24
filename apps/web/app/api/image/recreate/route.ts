import { imageSubmissionResponseSchema, recreateImageRequestSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { hashCanonicalRequest } from '@/server/image/image-service';
import { SupabaseGenerationStore } from '@/server/image/supabase-generation-store';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const input = recreateImageRequestSchema.parse(await readJson(request));
    const idempotencyKey = z.uuid().parse(request.headers.get('idempotency-key'));
    const result = await new SupabaseGenerationStore(createSupabaseAdminClient()).recreate({
      batchId: input.batchId,
      correlationId,
      generationId: input.generationId,
      idempotencyKey,
      mode: input.mode,
      requestHash: await hashCanonicalRequest({ input, userId }),
      userId,
    });
    return NextResponse.json(imageSubmissionResponseSchema.parse(result), { status: 202 });
  });
}
