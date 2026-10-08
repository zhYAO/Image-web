import { ApiRouteError } from "@/server/api-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  assertTrustedOrigin,
  executeRoute,
  readJson,
  requireVerifiedUserId,
} from "@/server/route-context";
import {
  createCommerceService,
  type CommerceOperation,
} from "./commerce-service";
import { createApparelService, type ApparelOperation } from '../apparel/apparel-service';
export function commerceRoute(
  request: Request,
  operation: CommerceOperation,
  taskId?: string,
) {
  return executeRoute(async (correlationId) => {
    if (request.method !== "GET") assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(
      await createSupabaseServerClient(),
    );
    const input =
      operation === "get"
        ? {}
        : operation === "list"
          ? { sessionId: new URL(request.url).searchParams.get("sessionId") }
          : await readJson(request);
    const admin: SupabaseClient = createSupabaseAdminClient();
    const apparel = new URL(request.url).searchParams.get('engine') === 'apparel-catalog'
      || (typeof input === 'object' && input !== null && 'plan' in input && typeof input.plan === 'object' && input.plan !== null && 'engine' in input.plan && input.plan.engine === 'apparel-catalog');
    if (apparel && (operation === 'archive' || operation === 'cancel'))
      throw new ApiRouteError({ code: 'bad_request', status: 400, message: '服装任务请在会话中管理。', retryable: false });
    const result = await (apparel ? createApparelService(admin) : createCommerceService(admin)).dispatch(
      userId,
      operation as ApparelOperation,
      taskId,
      input,
      correlationId,
    );
    return Response.json(result, {
      status: !apparel && operation === "submit" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  });
}
