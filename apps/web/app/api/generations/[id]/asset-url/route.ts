import { generationAssetUrlResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ApiRouteError } from '@/server/api-error';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { assertActiveBusinessSession } from '@/server/session-access';

interface AssetRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: AssetRouteContext) {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const { id } = await context.params;
    const generationId = z.uuid().parse(id);
    const generation = await client
      .from('generations')
      .select('id,batch_id,status,asset_status,asset_expires_at,storage_bucket,storage_path')
      .eq('id', generationId)
      .maybeSingle();
    if (generation.error) {
      throw new ApiRouteError({
        code: 'network',
        message: '暂时无法签发图片地址，请稍后重试。',
        retryable: true,
        status: 503,
      });
    }
    if (!generation.data) {
      throw new ApiRouteError({
        code: 'not_found',
        message: '图片不存在或无权访问。',
        retryable: false,
        status: 404,
      });
    }

    const batch = await client.from('generation_batches').select('session_id')
      .eq('id', generation.data.batch_id).eq('user_id', userId).maybeSingle();
    if (batch.error || !batch.data) {
      throw new ApiRouteError({ code: 'not_found', status: 404, retryable: false,
        message: '图片不存在或无权访问。' });
    }
    await assertActiveBusinessSession(client, userId, batch.data.session_id);

    const expired = generation.data.asset_status === 'expired'
      || (generation.data.asset_expires_at && Date.parse(generation.data.asset_expires_at) <= Date.now());
    if (expired) {
      throw new ApiRouteError({
        code: 'asset_expired',
        details: { generationId },
        message: '原图已到期，可按原参数重新生成。',
        retryable: false,
        status: 410,
      });
    }
    if (
      generation.data.status !== 'succeeded'
      || generation.data.asset_status !== 'active'
      || generation.data.storage_bucket !== 'generated'
      || !generation.data.storage_path
    ) {
      throw new ApiRouteError({
        code: 'conflict',
        details: { generationId },
        message: '图片尚未生成完成。',
        retryable: true,
        status: 409,
      });
    }

    const signed = await createSupabaseAdminClient()
      .storage
      .from('generated')
      .createSignedUrl(generation.data.storage_path, 60);
    if (signed.error || !signed.data.signedUrl) {
      throw new ApiRouteError({
        code: 'network',
        details: { generationId },
        message: '暂时无法签发图片地址，请稍后重试。',
        retryable: true,
        status: 503,
      });
    }

    return NextResponse.json(generationAssetUrlResponseSchema.parse({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      generationId,
      url: signed.data.signedUrl,
    }));
  });
}
