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
export function commerceRoute(
  request: Request,
  operation: CommerceOperation,
  taskId?: string,
) {
  return executeRoute(async (correlationId) => {
    if (request.method !== "GET") assertTrustedOrigin(request);
    if (
      operation === "submit" &&
      process.env.ZIMAGE_COMMERCE_SUBMIT_ENABLED === "false"
    ) {
      throw new ApiRouteError({
        code: "provider_error",
        status: 503,
        message: "新的电商生图提交已暂停，已有任务仍可查看和下载。",
        retryable: true,
      });
    }
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
    const result = await createCommerceService(admin).dispatch(
      userId,
      operation,
      taskId,
      input,
      correlationId,
    );
    return Response.json(result, {
      status: operation === "submit" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  });
}
