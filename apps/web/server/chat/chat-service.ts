import { hasExplicitImageIntent, isActiveChatModel, type ChatEvent, type Session } from '@zimage/domain';

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
        : code === 'STREAM_INTERRUPTED'
          ? '回复中断，已保留收到的内容。'
          : '聊天服务暂时不可用，请稍后重试。',
      retryable: failure?.retryable ?? true,
    },
    type: 'stream.failed',
  };
}

export function createChatTurnRunner(dependencies: ChatTurnDependencies) {
  return async function* run(input: ChatTurnInput): AsyncIterable<ChatEvent> {
    if(input.chatModel && !isActiveChatModel(input.chatModel)) throw new ChatProviderFailure('provider_error',false,'rejected');
    const started = await dependencies.start({
      message: input.message,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    if (started.created) yield { session: started.session, type: 'session.created' };

    if (!input.skillId && input.tools.includes('generate_image') && hasExplicitImageIntent(input.message)) {
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

    const provider = input.chatModel ?? 'doubao';
    const recordResult = async (isError: boolean) => {
      try {
        await dependencies.recordProviderResult(provider, isError);
      } catch {
        console.warn('[chat] provider health recording failed', { correlationId: input.correlationId, provider });
      }
    };
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
      } catch (error: unknown) {
        const retryable = error instanceof ChatProviderFailure && error.retryable;
        if (provider==='doubao' && attempt === 0 && !emittedThisAttempt && retryable) continue;
        console.warn('[chat] provider failed', { correlationId: input.correlationId, provider, code: error instanceof ChatProviderFailure ? error.code : 'unexpected_error' });
        await recordResult(true);
        yield streamError(error);
        return;
      }
      // Health reporting must not decide whether an otherwise valid answer is saved.
      const healthResult = recordResult(false);
      let persistedMessageId: string;
      try {
        persistedMessageId = await dependencies.complete({
          content, sessionId: started.session.id, userId: input.userId,
        });
      } catch {
        console.warn('[chat] reply persistence failed', { correlationId: input.correlationId, provider });
        yield {
          type: 'stream.failed',
          // Re-running a completed model request cannot safely retry an ambiguous save.
          error: { code: 'NETWORK', message: '聊天记录保存失败，已保留收到的回复。', retryable: false },
        };
        await healthResult;
        return;
      }
      console.info('[chat] reply persisted', { correlationId: input.correlationId, provider });
      yield { content, messageId: persistedMessageId, type: 'message.completed' };
      await healthResult;
      return;
    }
  };
}
