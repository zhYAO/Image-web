import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { ApiRouteError } from '@/server/api-error';
import { assertActiveBusinessSession } from '@/server/session-access';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return executeRoute(async () => {
    const client = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(client);
    const id = z.uuid().parse((await context.params).id);
    const result = await client.from('reference_uploads').select('session_id,storage_bucket,storage_path,status,upload_expires_at').eq('id', id).eq('user_id', userId).maybeSingle();
    if (result.error || !result.data) throw new ApiRouteError({ code: 'not_found', status: 404, message: '原图不存在或无权访问。', retryable: false });
    await assertActiveBusinessSession(client, userId, result.data.session_id);
    if (result.data.status !== 'active' || Date.parse(result.data.upload_expires_at) <= Date.now()) throw new ApiRouteError({ code: 'asset_expired', status: 410, message: '原图已到期。', retryable: false });
    const signed = await createSupabaseAdminClient().storage.from('uploads').createSignedUrl(result.data.storage_path, 3600);
    if (signed.error || !signed.data.signedUrl) throw new ApiRouteError({ code: 'network', status: 503, message: '暂时无法读取原图。', retryable: true });
    return Response.json({ url: signed.data.signedUrl, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, { headers: { 'cache-control': 'no-store' } });
  });
}
