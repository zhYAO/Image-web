import { isActiveChatModel } from '@zimage/domain';
import { ApiRouteError } from '@/server/api-error';
import { trackFinalizer } from '@/server/lifecycle/request-lifecycle';
import { creditsEnabled } from "@/server/credits/credit-service";
import { billedChat } from "@/server/credits/billed-text";
import {
  chatEventSchema,
  chatRequestSchema,
  type ChatEvent,
} from "@zimage/domain";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeChatGraph } from "@/server/chat/chat-graph";
import {
  resolveChatProvider,
  streamOpenAiCompatibleChat,
} from "@/server/chat/chat-providers";
import { createChatTurnRunner } from "@/server/chat/chat-service";
import { SupabaseChatStore } from "@/server/chat/supabase-chat-store";
import { createImageService } from "@/server/image/image-service";
import { SupabaseGenerationStore } from '@/server/image/supabase-generation-store';
import {
  createPreviewUsageGuard,
  withPreviewUsageReservation,
} from "@/server/preview/preview-usage-guard";
import {
  assertTrustedOrigin,
  executeRoute,
  readJson,
  requireVerifiedUserId,
} from "@/server/route-context";

export const runtime = "nodejs";
// SSE chat streams routinely exceed the platform's default 10s/15s function
// timeout (Vercel Hobby/Pro). Without this directive the streaming response is
// terminated mid-flight even though it is technically a long-lived handler.
export const maxDuration = 60;

function encodeEvent(event: ChatEvent) {
  return new TextEncoder().encode(
    `data: ${JSON.stringify(chatEventSchema.parse(event))}\n\n`,
  );
}

function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  chunk: Uint8Array,
) {
  try {
    controller.enqueue(chunk);
  } catch {
    // controller already closed/errored — ignore so the catch arm below stays silent.
  }
}

function safeClose(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.close();
  } catch {
    // already closed or errored — no-op.
  }
}

function safeError(
  controller: ReadableStreamDefaultController<Uint8Array>,
  error: unknown,
) {
  try {
    controller.error(error);
  } catch {
    // already terminated — no-op.
  }
}

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(
      await createSupabaseServerClient(),
    );
    const input = chatRequestSchema.parse(await readJson(request));
    const admin = createSupabaseAdminClient();
    if (creditsEnabled())
      return billedChat(admin, userId, input, request, correlationId);
    if(input.chatModel && !isActiveChatModel(input.chatModel)) throw new ApiRouteError({code:'bad_request',status:400,retryable:false,message:'MiniMax 已停止新调用，请选择豆包。'});
    if(input.chatModel?.startsWith('gpt-6'))throw new ApiRouteError({code:'service_not_ready',status:503,retryable:false,message:"OpenAI \u804a\u5929\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002"});
    if(resolveChatProvider(input.chatModel).edgeRelay)throw new ApiRouteError({code:'service_not_ready',status:503,retryable:false,message:'聊天服务需要先开启积分授权。'});
    const store = new SupabaseChatStore(admin);
    await store.assertProviderAvailable(
      input.chatModel ?? "doubao",
    );
    const prepared = await withPreviewUsageReservation(
      createPreviewUsageGuard(admin),
      {
        businessKey: `chat:${correlationId}`,
        correlationId,
        createsSession: !input.sessionId,
        operation: "chat",
        userId,
      },
      async () => {
        const started = await store.start({
          message: input.message,
          sessionId: input.sessionId,
          userId,
        });
        const history = await store.history(started.session.id);
        const imageService = createImageService(
          new SupabaseGenerationStore(admin),
        );
        const runner = createChatTurnRunner({
          complete: (completeInput) => store.complete(completeInput),
          recordProviderResult: (provider, isError) => store.recordProviderResult(provider, isError),
          start: async () => started,
          streamProvider: (chatInput) => {
          const provider = resolveChatProvider(chatInput.chatModel);
          return streamOpenAiCompatibleChat({
            apiKey: provider.apiKey,
            correlationId,
            endpoint: provider.endpoint,
            message: chatInput.message,
            messages: chatInput.history,
            model: provider.model,
            signal: request.signal,
          });
        },
          submitImage: ({
            correlationId: imageCorrelationId,
            idempotencyKey,
            image,
            source,
            userId: imageUserId,
          }) =>
            imageService.submit(
              imageUserId,
              image,
              idempotencyKey,
              imageCorrelationId,
              source,
            ),
        });

        // start_chat_turn has now durably created the user message (and possibly
        // its session), so this is the successful write boundary for preview use.
        return { history, runner, sessionId: started.session.id };
      },
    );

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Propagate browser-side disconnect (also fires on platform hard-kill
        // once the runtime forwards it) into the controller so the upstream
        // fetch aborts and the runner stops instead of leaking tokens.
        let aborted = false;
        let terminal = false;
        const onClientAbort = () => {
          aborted = true;
          safeError(controller, new Error('client_disconnected'));
        };
        if (request.signal.aborted) {
          onClientAbort();
        } else {
          request.signal.addEventListener("abort", onClientAbort, {
            once: true,
          });
        }

        void trackFinalizer(() => executeChatGraph(
          {
            ...input,
            correlationId,
            history: prepared.history,
            sessionId: prepared.sessionId,
            tools: input.tools ?? [],
            userId,
          },
          prepared.runner,
          async (event) => {
            if (aborted || terminal) return;
            safeEnqueue(controller, encodeEvent(event));
            terminal = event.type === 'message.completed' || event.type === 'stream.failed';
            if (terminal)
              console.info("[api/chat] terminal event sent", {
                correlationId,
                type: event.type,
              });
          },
        ))
          .catch((error: unknown) => {
            // Keep the phase/correlation visible without logging user content,
            // provider responses, credentials or arbitrary exception messages.
            console.error('[api/chat] executeChatGraph failed', {
            correlationId,
            stage: terminal ? 'after_terminal' : 'before_terminal',
            code: error instanceof Error ? 'graph_execution_failed' : 'unknown_failure',
          });
            if (aborted || terminal) return;
            terminal = true;
            safeEnqueue(
              controller,
              encodeEvent({
            error: {
              code: 'NETWORK',
              message: '聊天服务暂时不可用，请稍后重试。',
              retryable: true,
            },
            type: 'stream.failed',
          }),
            );
          })
          .finally(() => {
          request.signal.removeEventListener('abort', onClientAbort);
          safeClose(controller);
        });
      },
    });

    return new Response(stream, {
      headers: {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      },
    });
  });
}
