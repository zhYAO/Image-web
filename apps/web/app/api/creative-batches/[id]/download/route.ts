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
const omissionMessages = {
  task_unavailable: '该商品任务暂时无法导出。',
  no_selected_images: '该商品未选择可导出的图片。',
  selection_unavailable: '所选图片当前不可用。',
  asset_unavailable: '所选图片当前无法读取。',
  asset_expired: '所选图片已过期。',
  source_unavailable: '图片下载来源暂时不可用。',
  source_download_failed: '图片下载失败，请稍后重试。',
  source_too_large: '图片超过导出大小限制。',
  invalid_image: '图片无法解码，请重新选择有效结果。',
} as const;
type OmissionReason = keyof typeof omissionMessages;
type Omission = { productIndex: number; taskId?: string; slotId?: string; reason: OmissionReason; message: string };
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
      const omissions: Omission[] = [];
      let exportedImageCount = 0;
      for (const [taskIndex, item] of batch.items.entries()) {
        const omit = (reason: OmissionReason, slotId?: string) => {
          omissions.push({ productIndex: taskIndex + 1, ...(item.taskId ? { taskId: item.taskId } : {}),
            ...(slotId ? { slotId } : {}), reason, message: omissionMessages[reason] });
        };
        if (!item.taskId) { omit('task_unavailable'); continue; }
        let task: CommerceTask;
        try {
          task = await service.dispatch(userId, 'get', item.taskId, {}, correlationId) as CommerceTask;
        } catch { omit('task_unavailable'); continue; }
        const selections = task.slots.flatMap(slot => {
          const selection = task.selections.find(entry => entry.slotId === slot.id);
          return selection ? [{ slotId: slot.id, generationId: selection.generationId }] : [];
        });
        if (!selections.length) { omit('no_selected_images'); continue; }
        let manifest: { items: Array<{ slotId: string; generationId: string }> };
        try {
          manifest = await service.dispatch(userId, 'export', task.id, { requestId: crypto.randomUUID(), revision: task.revision, selections }, correlationId) as typeof manifest;
        } catch { omit('task_unavailable'); continue; }
        for (const [imageIndex, selection] of selections.entries()) {
          const image = manifest.items.find(entry => entry.slotId === selection.slotId);
          const slot = task.slots.find(entry => entry.id === selection.slotId);
          if (!image || !slot) { omit('selection_unavailable', selection.slotId); continue; }
          let failureReason: OmissionReason = 'asset_unavailable';
          try {
            const generation = await admin.from('generations').select('storage_bucket,storage_path,asset_status,asset_expires_at').eq('id', image.generationId).single();
            if (generation.error || generation.data?.storage_bucket !== 'generated' || !generation.data.storage_path) {
              omit('asset_unavailable', selection.slotId); continue;
            }
            if (generation.data.asset_status === 'expired' || (generation.data.asset_expires_at && Date.parse(generation.data.asset_expires_at) <= Date.now())) {
              omit('asset_expired', selection.slotId); continue;
            }
            if (generation.data.asset_status !== 'active') { omit('asset_unavailable', selection.slotId); continue; }
            failureReason = 'source_unavailable';
            const signed = await admin.storage.from('generated').createSignedUrl(generation.data.storage_path, 60);
            if (signed.error || !signed.data?.signedUrl) { omit('source_unavailable', selection.slotId); continue; }
            const url = new URL(signed.data.signedUrl);
            if (url.origin !== origin.origin || !url.pathname.includes('/storage/v1/object/sign/')) {
              omit('source_unavailable', selection.slotId); continue;
            }
            failureReason = 'source_download_failed';
            const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
            if (!response.ok) { omit('source_unavailable', selection.slotId); continue; }
            if (Number(response.headers.get('content-length') ?? 0) > 20 * 1024 * 1024) {
              omit('source_too_large', selection.slotId); continue;
            }
            const source = new Uint8Array(await response.arrayBuffer());
            if (source.length > 20 * 1024 * 1024) { omit('source_too_large', selection.slotId); continue; }
            failureReason = 'invalid_image';
            const rendered = await renderCommerceImage(source, format, slot.targetWidth && slot.targetHeight ? { width: slot.targetWidth, height: slot.targetHeight } : undefined);
            const folder = `商品-${String(taskIndex + 1).padStart(2, '0')}`;
            const spec = slot.outputSpec === 'desktop' || slot.outputSpec === 'mobile' ? `${slot.outputSpec}/` : '';
            yield { name: `${folder}/${spec}${String(imageIndex + 1).padStart(2, '0')}.${format}`, bytes: rendered.bytes };
            exportedImageCount++;
          } catch { omit(failureReason, selection.slotId); }
        }
      }
      if (omissions.length || !exportedImageCount) {
        const report = { version: 1, status: exportedImageCount ? 'partial' : 'empty',
          message: exportedImageCount ? '已导出可用图片，部分图片未能导出，请查看遗漏说明。' : '当前没有可导出的有效图片。',
          exportedImageCount, omissions };
        yield { name: '导出说明.json', bytes: new TextEncoder().encode(JSON.stringify(report, null, 2)) };
      }
    }
    return new Response(zipCommerceStream(files()), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="commerce-batch-${id}.zip"`, 'cache-control': 'private, no-store' } });
  });
}
