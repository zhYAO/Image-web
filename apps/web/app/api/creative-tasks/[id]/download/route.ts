import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { commerceExportSchema, type CommerceTask } from '@zimage/domain';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';
import { createCommerceService } from '@/server/commerce/commerce-service';
import { renderCommerceImage, stitchCommerceImages, zipCommerceImages, type ExportImage } from '@/server/commerce/commerce-export';

export const runtime = 'nodejs';
export const maxDuration = 120;
const requestSchema = commerceExportSchema.extend({
  mode: z.enum(['single', 'zip', 'long']),
  format: z.enum(['jpg', 'png']),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return executeRoute(async correlationId => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const { id } = await context.params;
    const input = requestSchema.parse(await readJson(request));
    const admin: SupabaseClient = createSupabaseAdminClient();
    const service = createCommerceService(admin);
    const task = await service.dispatch(userId, 'get', id, {}, correlationId) as CommerceTask;
    const manifest = await service.dispatch(userId, 'export', id, input, correlationId) as { items: Array<{ slotId: string; generationId: string }> };
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const images: Array<ExportImage & { spec?: string }> = [];
    for (const [index, selection] of input.selections.entries()) {
      const item = manifest.items.find(entry => entry.slotId === selection.slotId);
      const slot = task.slots.find(entry => entry.id === selection.slotId);
      if (!item || !slot) throw new Error('commerce_generation_unavailable');
      const generation = await admin.from('generations').select('storage_bucket,storage_path,asset_status,asset_expires_at').eq('id', item.generationId).single();
      if (generation.error || generation.data?.storage_bucket !== 'generated' || !generation.data.storage_path || generation.data.asset_status !== 'active' || (generation.data.asset_expires_at && Date.parse(generation.data.asset_expires_at) <= Date.now())) throw new Error('commerce_generation_unavailable');
      const signed = await admin.storage.from('generated').createSignedUrl(generation.data.storage_path, 60);
      if (signed.error || !signed.data.signedUrl) throw new Error('export_source_unavailable');
      const asset = new URL(signed.data.signedUrl);
      if (asset.origin !== origin.origin || !asset.pathname.includes('/storage/v1/object/sign/')) throw new Error('invalid_export_url');
      const response = await fetch(asset, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 20 * 1024 * 1024) throw new Error('export_source_unavailable');
      const source = new Uint8Array(await response.arrayBuffer());
      if (source.length > 20 * 1024 * 1024) throw new Error('export_source_too_large');
      const rendered = await renderCommerceImage(source, input.format, slot.targetWidth && slot.targetHeight ? { width: slot.targetWidth, height: slot.targetHeight } : undefined, input.focus);
      images.push({ ...rendered, name: `${String(index + 1).padStart(2, '0')}-${slot.outputSpec ?? 'image'}.${input.format}`, spec: slot.outputSpec });
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
