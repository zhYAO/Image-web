import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeRoute, requireVerifiedUserId } from "@/server/route-context";
import { createApparelService } from "@/server/apparel/apparel-service";
import type { SupabaseClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  return executeRoute(async (correlationId) => {
    const userId = await requireVerifiedUserId(
        await createSupabaseServerClient(),
      ),
      { id, assetId } = await context.params;
    const admin: SupabaseClient = createSupabaseAdminClient();
    const asset = await createApparelService(admin).asset(
      userId,
      id,
      assetId,
      correlationId,
    );
    return new Response(Buffer.from(asset.bytes), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
