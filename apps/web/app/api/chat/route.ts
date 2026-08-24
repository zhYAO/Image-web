import { chatEventSchema, chatRequestSchema, type ChatEvent } from '@zimage/domain';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { executeChatGraph } from '@/server/chat/chat-graph';
import { resolveChatProvider, streamOpenAiCompatibleChat } from '@/server/chat/chat-providers';
import { createChatTurnRunner } from '@/server/chat/chat-service';
import { SupabaseChatStore } from '@/server/chat/supabase-chat-store';
import { createImageService } from '@/server/image/image-service';
import { SupabaseGenerationStore } from '@/server/image/supabase-generation-store';
import { assertTrustedOrigin, executeRoute, readJson, requireVerifiedUserId } from '@/server/route-context';

export const runtime = 'nodejs';

function encodeEvent(event: ChatEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(chatEventSchema.parse(event))}\n\n`);
}

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const userId = await requireVerifiedUserId(await createSupabaseServerClient());
    const input = chatRequestSchema.parse(await readJson(request));
    const admin = createSupabaseAdminClient();
    const store = new SupabaseChatStore(admin);
    await store.assertProviderAvailable(input.chatModel === 'minimax' ? 'minimax' : 'doubao');
    const started = await store.start({ message: input.message, sessionId: input.sessionId, userId });
    const history = await store.history(started.session.id);
    const imageService = createImageService(new SupabaseGenerationStore(admin));
    const runner = createChatTurnRunner({
      complete: (completeInput) => store.complete(completeInput),
      recordProviderResult: (provider, isError) => store.recordProviderResult(provider, isError),
      start: async () => started,
      streamProvider: (chatInput) => {
        const provider = resolveChatProvider(chatInput.chatModel);
        return streamOpenAiCompatibleChat({
          apiKey: provider.apiKey,
          endpoint: provider.endpoint,
          message: chatInput.message,
          messages: chatInput.history,
          model: provider.model,
          signal: request.signal,
        });
      },
      submitImage: ({ correlationId: imageCorrelationId, idempotencyKey, image, source, userId: imageUserId }) =>
        imageService.submit(imageUserId, image, idempotencyKey, imageCorrelationId, source),
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void executeChatGraph(
          {
            ...input,
            correlationId,
            history,
            sessionId: started.session.id,
            tools: input.tools ?? [],
            userId,
          },
          runner,
          async (event) => controller.enqueue(encodeEvent(event)),
        ).catch(() => {
          controller.enqueue(encodeEvent({
            error: {
              code: 'NETWORK',
              message: '聊天服务暂时不可用，请稍后重试。',
              retryable: true,
            },
            type: 'stream.failed',
          }));
        }).finally(() => controller.close());
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
