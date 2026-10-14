import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { commerceExportSchema, apparelExportSchema, apparelExportResultSchema, type CommerceTask } from '@zimage/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';
import { createCommerceService } from '@/server/commerce/commerce-service';
import { renderCommerceImage, stitchCommerceImages, zipCommerceImages, zipCommerceStream, type ExportImage } from '@/server/commerce/commerce-export';
import { createApparelService } from '@/server/apparel/apparel-service';
import { ApiRouteError } from '@/server/api-error';
import { canExportCommerceSafePng } from '@/features/commerce/commerce-safe-export';
import { readCommerceSafeSource } from '@/server/commerce/commerce-safe-export';

export const runtime = 'nodejs';
export const maxDuration = 120;
const requestSchema = commerceExportSchema.extend({
  mode: z.enum(['single', 'zip', 'long']),
  format: z.enum(['jpg', 'png']),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  safeExport: z.literal('ec03-white-8').optional(),
}).superRefine((input, context) => {
  if (input.safeExport && (input.mode !== 'single' || input.format !== 'png' || input.selections.length !== 1)) {
    context.addIssue({ code: 'custom', message: '安全导出仅支持单张 PNG。' });
  }
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return executeRoute(async correlationId => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const { id } = await context.params;
    const raw = await readJson(request);
    const admin: SupabaseClient = createSupabaseAdminClient();
    if (new URL(request.url).searchParams.get('engine') === 'apparel-catalog') {
      if (raw && typeof raw === 'object' && 'safeExport' in raw) throw new ApiRouteError({ code: 'bad_request', status: 400, retryable: false, message: '服装固定排版不支持此安全导出。' });
      const input = apparelExportSchema.parse(raw), service = createApparelService(admin);
      const manifest = apparelExportResultSchema.parse(await service.dispatch(userId,'export',id,input,correlationId));
      async function* files() {
        for (const item of manifest.items) {
          const asset = await service.asset(userId,id,item.id,correlationId);
          yield { name: item.name, bytes: asset.bytes };
        }
      }
      return new Response(zipCommerceStream(files()), { headers: { 'content-type':'application/zip','content-disposition':'attachment; filename="apparel-catalog.zip"','cache-control':'private, no-store' } });
    }
    const input = requestSchema.parse(raw);
    const service = createCommerceService(admin);
    const task = await service.dispatch(userId, 'get', id, {}, correlationId) as CommerceTask;
    if (input.safeExport) {
      const selected = input.selections[0]!;
      if (!canExportCommerceSafePng(task, selected.slotId)) throw new ApiRouteError({ code: 'bad_request', status: 400, retryable: false, message: '安全导出仅支持详情模块模板的当前有效选图，不支持 A+ 裁切尺寸。' });
      if (task.revision !== input.revision || task.selections.find(entry => entry.slotId === selected.slotId)?.generationId !== selected.generationId) throw new ApiRouteError({ code: 'conflict', status: 409, retryable: false, message: '方案或当前选图已变化，请刷新后重新选择安全导出。' });
    }
    const manifest = await service.dispatch(userId, 'export', id, input, correlationId) as { items: Array<{ slotId: string; generationId: string }> };
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const images: Array<ExportImage & { spec?: string }> = [];
    for (const [index, selection] of input.selections.entries()) {
      const item = manifest.items.find(entry => entry.slotId === selection.slotId);
      const slot = task.slots.find(entry => entry.id === selection.slotId);
      if (!item || !slot || (input.safeExport && item.generationId !== selection.generationId)) throw new Error('commerce_generation_unavailable');
      const generation = await admin.from('generations').select('storage_bucket,storage_path,asset_status,asset_expires_at').eq('id', item.generationId).single();
      if (generation.error || generation.data?.storage_bucket !== 'generated' || !generation.data.storage_path || generation.data.asset_status !== 'active' || (generation.data.asset_expires_at && Date.parse(generation.data.asset_expires_at) <= Date.now())) throw new Error('commerce_generation_unavailable');
      const signed = await admin.storage.from('generated').createSignedUrl(generation.data.storage_path, 60);
      if (signed.error || !signed.data.signedUrl) throw new Error('export_source_unavailable');
      const asset = new URL(signed.data.signedUrl);
      if (asset.origin !== origin.origin || !asset.pathname.includes('/storage/v1/object/sign/')) throw new Error('invalid_export_url');
      const response = await fetch(asset, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 20 * 1024 * 1024) throw new Error('export_source_unavailable');
      const source = input.safeExport ? await readCommerceSafeSource(response) : new Uint8Array(await response.arrayBuffer());
      if (source.length > 20 * 1024 * 1024) throw new Error('export_source_too_large');
      const rendered = await renderCommerceImage(source, input.format, slot.targetWidth && slot.targetHeight ? { width: slot.targetWidth, height: slot.targetHeight } : undefined, input.focus, input.safeExport);
      images.push({ ...rendered, name: `${String(index + 1).padStart(2, '0')}-${input.safeExport ? 'safe-image' : slot.outputSpec ?? 'image'}.${input.format}`, spec: slot.outputSpec });
    }
    let output: Uint8Array;
    let mime: string;
    let filename: string;
    if (input.mode === 'single') {
      if (images.length !== 1) throw new Error('single_export_requires_one_image');
      output = images[0]!.bytes; mime = input.format === 'png' ? 'image/png' : 'image/jpeg'; filename = images[0]!.name;
    } else if (input.mode === 'long') {
      if (new Set(images.map(image => image.spec)).size > 1) throw new Error('select_one_aplus_spec_for_long_image');
      output = await stitchCommerceImages(images, input.format); mime = input.format === 'png' ? 'image/png' : 'image/jpeg'; filename = `commerce-long.${input.format}`;
    } else {
      output = zipCommerceImages(images.map(image => ({ name: image.spec === 'desktop' || image.spec === 'mobile' ? `${image.spec}/${image.name}` : image.name, bytes: image.bytes })));
      mime = 'application/zip'; filename = 'commerce-images.zip';
    }
    return new Response(Buffer.from(output), { headers: { 'content-type': mime, 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store' } });
  });
}
