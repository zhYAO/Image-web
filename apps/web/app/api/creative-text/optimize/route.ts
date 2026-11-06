import {ApiRouteError}from'@/server/api-error';
import { creditsEnabled } from "@/server/credits/credit-service";
import { billedOptimize } from "@/server/credits/billed-text";
import { creativeTextOptimizeRequestSchema } from "@zimage/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseChatStore } from "@/server/chat/supabase-chat-store";
import {
  resolveChatProvider,
  streamOpenAiCompatibleChat,
} from "@/server/chat/chat-providers";
import { optimizeCreativeText } from '@/server/creative-text/creative-text-service';
import {
  createPreviewUsageGuard,
  PreviewUsageRetentionError,
  withPreviewUsageReservation,
} from "@/server/preview/preview-usage-guard";
import {
  assertTrustedOrigin,
  executeRoute,
  readJson,
  requireVerifiedUserId,
} from "@/server/route-context";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(
      await createSupabaseServerClient(),
    );
    const input = creativeTextOptimizeRequestSchema.parse(
      await readJson(request),
    );
    if(input.chatModel?.startsWith('gpt-6'))throw new ApiRouteError({code:'bad_request',status:400,retryable:false,message:"\u6b64\u6587\u5b57\u4f18\u5316\u6682\u4e0d\u652f\u6301\u6240\u9009\u6a21\u578b\uff0c\u8bf7\u9009\u62e9\u8c46\u5305\u3002"});
    if (creditsEnabled())
      return Response.json(
        await billedOptimize(
          createSupabaseAdminClient(),
          userId,
          input,
          request,
        ),
        { headers: { "cache-control": "no-store" } },
      );
    const provider = resolveChatProvider(input.chatModel);
    if(provider.edgeRelay)throw new ApiRouteError({code:'service_not_ready',status:503,retryable:false,message:'文字优化需要先开启积分授权。'});
    const admin = createSupabaseAdminClient();
    const health = new SupabaseChatStore(admin);
    await health.assertProviderAvailable(provider.provider);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(45000),
    ]);
    const output = await withPreviewUsageReservation(
      createPreviewUsageGuard(admin),
      {
        businessKey: `creative-text:${correlationId}`,
        correlationId,
        createsSession: false,
        operation: "chat",
        userId,
      },
      async () => {
        let providerStarted = false;
        try {
          const result = await optimizeCreativeText(
            input,
            async function* (message) {
              signal.throwIfAborted();
              // Once submission begins, cancellation cannot prove zero upstream cost.
              providerStarted = true;
              yield* streamOpenAiCompatibleChat({
                ...provider,
                reasoningSplit: false,
                message,
                signal,
              });
            },
          );
          signal.throwIfAborted();
          await health.recordProviderResult(provider.provider, false);
          return result;
        } catch (error) {
        if (providerStarted && !request.signal.aborted) {
          try {
            await health.recordProviderResult(provider.provider, true);
          } catch {
            // Health persistence must not mask the error or refund consumed quota.
          }
        }
        if (providerStarted) throw new PreviewUsageRetentionError(error);
        throw error;
      }
      },
    );
    return Response.json(output, { headers: { "cache-control": "no-store" } });
  });
}
