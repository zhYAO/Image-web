import { hasExplicitImageIntent, type ChatEvent, type Session } from '@zimage/domain';

import { ChatProviderFailure } from './chat-providers';

interface ChatTurnInput {
  chatModel?: string;
  correlationId?: string;
  imageProvider?: string;
  history?: Array<{ content: string; role: 'assistant' | 'user' }>;
  images?: string[];
  message: string;
  sessionId?: string;
  skillId?: string;
  tools: Array<'generate_image'>;
  userId: string;
}

interface ChatTurnStart {
  created: boolean;
  session: Session;
}

interface ChatTurnDependencies {
  complete(input: { content: string; sessionId: string; userId: string }): Promise<string>;
  recordProviderResult(provider: string, isError: boolean): Promise<unknown>;
  start(input: { message: string; sessionId?: string; userId: string }): Promise<ChatTurnStart>;
  streamProvider(input: ChatTurnInput): AsyncIterable<string>;
  submitImage(input: {
    correlationId: string;
    idempotencyKey: string;
    image: {
      model?: string;
      params: {
        aspectRatio: '1:1';
        count: 1;
        referenceIds?: string[];
        resolution: '2K';
      };
      prompt: string;
      provider?: string;
      sessionId: string;
      skillId?: string;
    };
    source: 'chat_tool';
    userId: string;
  }): Promise<{ batchId: string; sessionId: string; status: 'pending' }>;
}

function streamError(error: unknown): ChatEvent {
  const failure = error instanceof ChatProviderFailure ? error : undefined;
  const code = failure?.code === 'moderation'
    ? 'MODERATION'
    : failure?.code === 'stream_interrupted'
      ? 'STREAM_INTERRUPTED'
      : failure?.code === 'provider_error'
        ? 'PROVIDER_ERROR'
        : 'PROVIDER_UNAVAILABLE';
  return {
    error: {
      code,
      message: code === 'MODERATION'
        ? '内容未通过安全检查，请调整后重试。'
        : '聊天服务暂时不可用，请稍后重试。',
      retryable: failure?.retryable ?? true,
    },
    type: 'stream.failed',
  };
}

export function createChatTurnRunner(dependencies: ChatTurnDependencies) {
  return async function* run(input: ChatTurnInput): AsyncIterable<ChatEvent> {
    const started = await dependencies.start({
      message: input.message,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    if (started.created) yield { session: started.session, type: 'session.created' };

    if (input.tools.includes('generate_image') && hasExplicitImageIntent(input.message)) {
      const submission = await dependencies.submitImage({
        correlationId: input.correlationId ?? crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        image: {
          params: {
            aspectRatio: '1:1',
            count: 1,
            referenceIds: input.images?.length ? input.images : undefined,
            resolution: '2K',
          },
          prompt: input.message,
          provider: input.imageProvider,
          sessionId: started.session.id,
          skillId: input.skillId,
        },
        source: 'chat_tool',
        userId: input.userId,
      });
      yield { batchId: submission.batchId, type: 'tool.queued' };
      const content = '已创建图片生成任务，你可以继续聊天或提交下一批。';
      const messageId = await dependencies.complete({
        content, sessionId: started.session.id, userId: input.userId,
      });
      yield { delta: content, messageId, type: 'message.delta' };
      yield { content, messageId, type: 'message.completed' };
      return;
    }

    const provider = input.chatModel === 'minimax' ? 'minimax' : 'doubao';
    const messageId = crypto.randomUUID();
    let content = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let emittedThisAttempt = false;
      try {
        for await (const delta of dependencies.streamProvider(input)) {
          emittedThisAttempt = true;
          content += delta;
          yield { delta, messageId, type: 'message.delta' };
        }
        if (!content) throw new ChatProviderFailure('stream_interrupted', false);
        await dependencies.recordProviderResult(provider, false);
        const persistedMessageId = await dependencies.complete({
          content, sessionId: started.session.id, userId: input.userId,
        });
        yield { content, messageId: persistedMessageId, type: 'message.completed' };
        return;
      } catch (error: unknown) {
        const retryable = error instanceof ChatProviderFailure && error.retryable;
        if (attempt === 0 && !emittedThisAttempt && retryable) continue;
        await dependencies.recordProviderResult(provider, true);
        yield streamError(error);
        return;
      }
    }
  };
}
