import { imageRequestSchema, imageSubmissionResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createImageService } from '@/server/image/image-service';
import { SupabaseGenerationStore } from '@/server/image/supabase-generation-store';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const userClient = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(userClient);
    const input = imageRequestSchema.parse(await readJson(request));
    const result = await createImageService(
      new SupabaseGenerationStore(createSupabaseAdminClient()),
    ).submit(
      userId,
      input,
      request.headers.get('idempotency-key') ?? '',
      correlationId,
    );
    return NextResponse.json(imageSubmissionResponseSchema.parse(result), { status: 202 });
  });
}
