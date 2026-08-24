export class ChatProviderFailure extends Error {
  constructor(
    readonly code: 'moderation' | 'provider_error' | 'provider_unavailable' | 'stream_interrupted',
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'ChatProviderFailure';
  }
}

interface OpenAiCompatibleChatInput {
  apiKey: string;
  endpoint: string;
  fetcher?: typeof fetch;
  message: string;
  messages?: Array<{ content: string; role: 'assistant' | 'user' }>;
  model: string;
  signal?: AbortSignal;
}

function contentDelta(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return undefined;
  const delta = (first as Record<string, unknown>).delta;
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return undefined;
  const content = (delta as Record<string, unknown>).content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}

export async function* streamOpenAiCompatibleChat(input: OpenAiCompatibleChatInput) {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(input.endpoint, {
      body: JSON.stringify({
        messages: input.messages ?? [{ content: input.message, role: 'user' }],
        model: input.model,
        stream: true,
        stream_options: { include_usage: true },
      }),
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: input.signal,
    });
  } catch {
    throw new ChatProviderFailure('provider_unavailable', true);
  }

  if (!response.ok || !response.body) {
    if (response.status === 400 || response.status === 422) {
      throw new ChatProviderFailure('provider_error', false);
    }
    throw new ChatProviderFailure(
      response.status === 429 || response.status >= 500 ? 'provider_unavailable' : 'provider_error',
      response.status === 429 || response.status >= 500,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const payload = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!payload || payload === '[DONE]') continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload) as unknown;
        } catch {
          throw new ChatProviderFailure('stream_interrupted', false);
        }
        const delta = contentDelta(parsed);
        if (delta) yield delta;
      }
      if (done) break;
    }
  } catch (error: unknown) {
    if (error instanceof ChatProviderFailure) throw error;
    throw new ChatProviderFailure('stream_interrupted', false);
  } finally {
    reader.releaseLock();
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ChatProviderFailure('provider_unavailable', true);
  return value;
}

export type ChatProviderId = 'doubao' | 'minimax';

export function resolveChatProvider(chatModel?: string) {
  const provider: ChatProviderId = chatModel === 'minimax' ? 'minimax' : 'doubao';
  if (chatModel && chatModel !== provider) throw new ChatProviderFailure('provider_error', false);
  if (provider === 'doubao') {
    return {
      apiKey: requiredEnvironment('ARK_API_KEY'),
      endpoint: process.env.ZIMAGE_DOUBAO_CHAT_ENDPOINT?.trim()
        || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: requiredEnvironment('ZIMAGE_DOUBAO_CHAT_MODEL'),
      provider,
    };
  }
  return {
    apiKey: requiredEnvironment('MINIMAX_API_KEY'),
    endpoint: process.env.ZIMAGE_MINIMAX_CHAT_ENDPOINT?.trim()
      || 'https://api.minimaxi.com/v1/chat/completions',
    model: requiredEnvironment('ZIMAGE_MINIMAX_CHAT_MODEL'),
    provider,
  };
}
