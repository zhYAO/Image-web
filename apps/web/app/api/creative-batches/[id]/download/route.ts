import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { createCommerceService } from '@/server/commerce/commerce-service';
import { getCreativeBatch } from '@/server/commerce/commerce-batch-service';
import { renderCommerceImage, zipCommerceStream } from '@/server/commerce/commerce-export';
import type { CommerceTask } from '@zimage/domain';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return executeRoute(async correlationId => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const id = z.uuid().parse((await context.params).id);
    const format = z.enum(['jpg','png']).parse((await request.json()).format);
    const admin: SupabaseClient = createSupabaseAdminClient();
    const batch = await getCreativeBatch(admin, userId, id);
    const service = createCommerceService(admin);
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    async function* files() {
      for (const [taskIndex, item] of batch.items.entries()) {
        if (!item.taskId) continue;
        const task = await service.dispatch(userId, 'get', item.taskId, {}, correlationId) as CommerceTask;
        const selections = task.slots.flatMap(slot => {
          const selection = task.selections.find(entry => entry.slotId === slot.id);
          return selection ? [{ slotId: slot.id, generationId: selection.generationId }] : [];
        });
        if (!selections.length) continue;
        const manifest = await service.dispatch(userId, 'export', task.id, { requestId: crypto.randomUUID(), revision: task.revision, selections }, correlationId) as { items: Array<{ slotId: string; generationId: string }> };
        for (const [imageIndex, selection] of selections.entries()) {
          const image = manifest.items.find(entry => entry.slotId === selection.slotId);
          const slot = task.slots.find(entry => entry.id === selection.slotId);
          if (!image || !slot) continue;
          const generation = await admin.from('generations').select('storage_bucket,storage_path,asset_status,asset_expires_at').eq('id', image.generationId).single();
          if (generation.error || generation.data?.storage_bucket !== 'generated' || !generation.data.storage_path || generation.data.asset_status !== 'active' || (generation.data.asset_expires_at && Date.parse(generation.data.asset_expires_at) <= Date.now())) continue;
          const signed = await admin.storage.from('generated').createSignedUrl(generation.data.storage_path, 60);
          if (signed.error || !signed.data.signedUrl) continue;
          const url = new URL(signed.data.signedUrl);
          if (url.origin !== origin.origin || !url.pathname.includes('/storage/v1/object/sign/')) continue;
          const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
          if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 20 * 1024 * 1024) continue;
          const source = new Uint8Array(await response.arrayBuffer());
          if (source.length > 20 * 1024 * 1024) continue;
          const rendered = await renderCommerceImage(source, format, slot.targetWidth && slot.targetHeight ? { width: slot.targetWidth, height: slot.targetHeight } : undefined);
          const folder = `商品-${String(taskIndex + 1).padStart(2, '0')}`;
          const spec = slot.outputSpec === 'desktop' || slot.outputSpec === 'mobile' ? `${slot.outputSpec}/` : '';
          yield { name: `${folder}/${spec}${String(imageIndex + 1).padStart(2, '0')}.${format}`, bytes: rendered.bytes };
        }
      }
    }
    return new Response(zipCommerceStream(files()), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="commerce-batch-${id}.zip"`, 'cache-control': 'private, no-store' } });
  });
}
