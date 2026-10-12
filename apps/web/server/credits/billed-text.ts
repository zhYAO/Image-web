import {
  chatEventSchema,
  sessionSchema,
  hasExplicitImageIntent,
  creativeTextOptimizeResponseSchema,
  type ChatEvent,
  type CreativeTextOptimizeRequest,
} from "@zimage/domain";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ChatProviderFailure,
  resolveChatProvider,
  streamOpenAiCompatibleChat,
} from "@/server/chat/chat-providers";
import { SupabaseChatStore } from "@/server/chat/supabase-chat-store";
import { prepareImageSubmission, restoreImageSubmission } from "@/server/image/image-service";
import { SupabaseGenerationStore } from "@/server/image/supabase-generation-store";
import { optimizeCreativeText } from "@/server/creative-text/creative-text-service";
import {
  createPreviewUsageGuard,
  withPreviewUsageReservation,
} from "@/server/preview/preview-usage-guard";
import { chatRequestSchema } from "@zimage/domain";
import {
  creditCall,
  creditFailure,
  startText,
  textStep,
  pendingCreditError,
  type TextOperation,
} from "./credit-service";
import { ApiRouteError } from "@/server/api-error";
const startedSchema = z.object({
  created: z.boolean(),
  session: sessionSchema,
});
function eventsResponse(events: ChatEvent[]) {
  return new Response(
    events
      .map((e) => `data: ${JSON.stringify(chatEventSchema.parse(e))}\n\n`)
      .join(""),
    {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
      },
    },
  );
}
function imageEventsResponse(raw: unknown) {
  const result = z.object({ batchId: z.uuid(), sessionId: z.uuid(), toolMessageId: z.uuid() }).parse(raw);
  return eventsResponse([
    { type: 'tool.queued', batchId: result.batchId },
    { type: 'message.completed', messageId: result.toolMessageId, content: '已创建图片生成任务，你可以继续聊天或提交下一批。' },
  ]);
}
function finalEvents(op: TextOperation): ChatEvent[] {
  const started = startedSchema.parse(op.started);
  return [
    ...(started.created
      ? [{ type: "session.created" as const, session: started.session }]
      : []),
    {
      type: "message.completed",
      messageId: z.uuid().parse(op.result?.messageId),
      content: z.string().parse(op.result?.content),
    },
  ];
}
async function reserve(
  admin: SupabaseClient,
  user: string,
  input: Parameters<typeof startText>[2],
) {
  return withPreviewUsageReservation(
    createPreviewUsageGuard(admin),
    {
      businessKey: `credits:${input.requestId}`,
      correlationId: input.requestId!,
      createsSession:
        input.operation === "chat" &&
        !(input.input as { sessionId?: string }).sessionId,
      operation: "chat",
      userId: user,
    },
    () => startText(admin, user, input),
  );
}
async function claim(admin: SupabaseClient, user: string, id: string) {
  const r = z
    .object({ claimed: z.boolean() })
    .parse(await creditCall(admin, user, "text_claim", { requestId: id }));
  if (!r.claimed) throw pendingCreditError();
}
async function failure(
  admin: SupabaseClient,
  user: string,
  id: string,
  error: unknown,
  knownValidationFailure = false,
) {
  const definite =
    knownValidationFailure ||
    (error instanceof ChatProviderFailure &&
      (error.outcome === "rejected" || error.code === "moderation"));
  try {
    await textStep(admin, user, id, definite ? "refund" : "unknown", {
      reason: definite ? "模型明确失败，积分已退回" : "调用结果待核对",
    });
  } catch {
    /* The durable reservation remains recoverable; never re-run the model. */
  }
  return definite;
}
async function cancelUnclaimed(admin: SupabaseClient, user: string, id: string) {
  const operation = await textStep(admin, user, id, "cancel", { reason: "模型尚未调用，取消冻结" });
  // Another transport retry may have claimed this request since text_start.
  if (operation.status !== "refunded") throw pendingCreditError();
}
export async function billedChat(
  admin: SupabaseClient,
  user: string,
  input: z.infer<typeof chatRequestSchema>,
  request: Request,
  correlationId: string,
): Promise<Response> {
  if (!input.requestId)
    throw creditFailure({ message: "credit_request_id_required" });
  const requestId = z.uuid().parse(input.requestId);
  const store = new SupabaseChatStore(admin);
  const imageIntent = Boolean(
    !input.skillId &&
    input.tools?.includes("generate_image") &&
    hasExplicitImageIntent(input.message)
  );
  const image = { billing: input.billing, prompt: input.message, provider: input.imageProvider, sessionId: input.sessionId,
    params: { aspectRatio: '1:1' as const, count: 1, resolution: '2K' as const, referenceIds: input.images } };
  const prior = await new SupabaseGenerationStore(admin).lookupSubmission({ userId: user, idempotencyKey: requestId });
  if (prior) {
    if (!imageIntent || prior.source !== 'chat_tool')
      throw new ApiRouteError({ code: 'conflict', status: 409, message: '相同请求编号已用于另一份创作，请重新发送。', retryable: false });
    const restored = await restoreImageSubmission(user, image, requestId, correlationId, prior, 'chat_tool');
    return imageEventsResponse(await creditCall(admin, user, 'image', { ...restored, requestId, chatMessage: input.message }));
  }
  if (imageIntent) {
    const prepared = await prepareImageSubmission(
      user,
      {
        billing: input.billing,
        prompt: input.message,
        provider: input.imageProvider,
        sessionId: input.sessionId,
        params: {
          aspectRatio: "1:1",
          count: 1,
          resolution: "2K",
          referenceIds: input.images,
        },
      },
      requestId,
      correlationId,
      "chat_tool",
    );
    const raw = await withPreviewUsageReservation(
      createPreviewUsageGuard(admin),
      {
        businessKey: `generation:${requestId}`,
        correlationId,
        createsSession: !input.sessionId,
        operation: "generation",
        userId: user,
      },
      () =>
        creditCall(admin, user, "image", {
          ...prepared,
          requestId,
          chatMessage: input.message,
        }),
    );
    return imageEventsResponse(raw);
  }
  const model = input.chatModel === "minimax" ? "minimax" : "doubao";

  let op = await reserve(admin, user, {
    requestId,
    operation: "chat",
    model,
    billing: input.billing,
    input: { ...input, billing: undefined },
  });
  if (op.status === "result")
    op = await textStep(admin, user, requestId, "complete");
  if (op.status === "succeeded") return eventsResponse(finalEvents(op));
  if (op.status === "refunded")
    throw new ApiRouteError({
      code: "provider_error",
      status: 409,
      message: "上次调用已失败并退回积分，请重新发送以创建新请求。",
      retryable: false,
    });
  if (op.status !== "reserved") throw pendingCreditError();
  const started = startedSchema.parse(op.started);
  let provider: ReturnType<typeof resolveChatProvider>;
  let history: Awaited<ReturnType<SupabaseChatStore["history"]>>;
  try {
    provider = resolveChatProvider(model);
    await store.assertProviderAvailable(model);
    history = await store.history(started.session.id);
  } catch {
    await cancelUnclaimed(admin, user, requestId);
    throw new ApiRouteError({code:'provider_error',status:503,message:'聊天服务暂时不可用，冻结积分已退回，请重新编辑后发送。',retryable:false});
  }
  if (request.signal.aborted) {
    await cancelUnclaimed(admin, user, requestId);
    throw new ApiRouteError({
      code: "bad_request",
      status: 400,
      message: "请求已取消，冻结积分已释放。",
      retryable: false,
    });
  }
  await claim(admin, user, requestId);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ChatEvent) => {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify(chatEventSchema.parse(event))}\n\n`,
            ),
          );
        } catch {
          /* client disconnected */
        }
      };
      void (async () => {
        if (started.created)
          emit({ type: "session.created", session: started.session });
        let content = "";
        const messageId = crypto.randomUUID();
        let modelDone = false;
        try {
          for await (const delta of streamOpenAiCompatibleChat({
            ...provider,
            message: input.message,
            messages: history,
            correlationId,
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(45000),
            ]),
          })) {
            content += delta;
            if (content.length > 64000)
              throw new ChatProviderFailure(
                "stream_interrupted",
                false,
                "rejected",
              );
            emit({ type: "message.delta", messageId, delta });
          }
          if (!content)
            throw new ChatProviderFailure("provider_error", false, "rejected");
          modelDone = true;
          await textStep(admin, user, requestId, "result", {
            result: { content },
          });
          const complete = await textStep(admin, user, requestId, "complete");
          emit(finalEvents(complete).at(-1)!);
          void store.recordProviderResult(model, false).catch(() => undefined);
        } catch (error) {
          await failure(admin, user, requestId, error);
          if (!modelDone)
            void store.recordProviderResult(model, true).catch(() => undefined);
          emit({
            type: "stream.failed",
            error: {
              code: modelDone ? "NETWORK" : "STREAM_INTERRUPTED",
              message: modelDone
                ? "回复已生成，正在恢复保存与结算；请保留原请求。"
                : "回复未完成，请在积分明细中查看退款或待核对状态。",
              retryable: modelDone,
            },
          });
        } finally {
          try {
            controller.close();
          } catch {
            /* disconnected */
          }
        }
      })();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
export async function billedOptimize(
  admin: SupabaseClient,
  user: string,
  input: CreativeTextOptimizeRequest,
  request: Request,
) {
  if (!input.requestId)
    throw creditFailure({ message: "credit_request_id_required" });
  const requestId = z.uuid().parse(input.requestId);
  const model = input.chatModel ?? "doubao";
  const health = new SupabaseChatStore(admin);
  let op = await reserve(admin, user, {
    requestId,
    operation: "optimize",
    model,
    billing: input.billing,
    input: { ...input, billing: undefined },
  });
  if (op.status === "result")
    op = await textStep(admin, user, requestId, "complete");
  if (op.status === "succeeded")
    return creativeTextOptimizeResponseSchema.parse(op.result);
  if (op.status === "refunded")
    throw new ApiRouteError({
      code: "provider_error",
      status: 409,
      message: "此次优化已失败并退回积分，请重新优化。",
      retryable: false,
    });
  if (op.status !== "reserved") throw pendingCreditError();
  let provider: ReturnType<typeof resolveChatProvider>;
  try {
    provider = resolveChatProvider(model);
    await health.assertProviderAvailable(model);
  } catch (error) {
    await cancelUnclaimed(admin, user, requestId);
    throw error;
  }
  if (request.signal.aborted) {
    await cancelUnclaimed(admin, user, requestId);
    throw new ApiRouteError({
      code: "bad_request",
      status: 400,
      message: "请求已取消，冻结积分已释放。",
      retryable: false,
    });
  }
  await claim(admin, user, requestId);
  let upstreamDone = false;
  let outputValidated = false;
  try {
    const result = await optimizeCreativeText(input, async function* (message) {
      yield* streamOpenAiCompatibleChat({
        ...provider,
        reasoningSplit: model === 'minimax',
        message,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
      });
      upstreamDone = true;
    });
    outputValidated = true;
    await textStep(admin, user, requestId, "result", { result });
    await textStep(admin, user, requestId, "complete");
    void health.recordProviderResult(model, false).catch(() => undefined);
    return result;
  } catch (error) {
    const definite = await failure(
      admin,
      user,
      requestId,
      error,
      !outputValidated && upstreamDone,
    );
    if (!outputValidated)
      void health.recordProviderResult(model, true).catch(() => undefined);
    throw !definite
      ? pendingCreditError()
      : new ApiRouteError({
          code: "provider_error",
          status: 503,
          message: upstreamDone
            ? "优化结果不符合要求，积分已退回。"
            : "优化未完成，请查看积分退款或待核对状态。",
          retryable: false,
        });
  }
}
