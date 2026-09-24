import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';
import { importPublicProductImage } from '@/server/commerce/public-image-import';

export const runtime = 'nodejs';
export const maxDuration = 45;
export async function POST(request: Request) {
  return executeRoute(async () => {
    assertTrustedOrigin(request);
    await requireVerifiedUserId(await createSupabaseServerClient());
    const input = z.object({ url: z.url().max(2048) }).parse(await readJson(request));
    const image = await importPublicProductImage(input.url);
    return new Response(Buffer.from(image.bytes), { headers: { 'content-type': image.mimeType, 'content-disposition': `inline; filename="${image.name}"`, 'x-source-url': image.sourceUrl, 'cache-control': 'private, no-store' } });
  });
}
