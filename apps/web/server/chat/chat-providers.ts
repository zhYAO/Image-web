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
  /**
   * Optional stall budget (ms) for each chunk read. Defaults to
   * `ZIMAGE_CHAT_PROVIDER_STALL_TIMEOUT_MS` (20000 ms). A stalled upstream
   * (e.g. TCP half-open, headers-but-no-body) used to keep the SSE response
   * alive forever and only fail at the platform's hard timeout. Bounding the
   * wait per chunk lets the route handler fail fast and emit `stream.failed`.
   */
  stallTimeoutMs?: number;
  signal?: AbortSignal;
}

function resolveStallTimeoutMs(input: OpenAiCompatibleChatInput) {
  if (typeof input.stallTimeoutMs === 'number' && input.stallTimeoutMs > 0) {
    return input.stallTimeoutMs;
  }
  const envValue = Number(process.env.ZIMAGE_CHAT_PROVIDER_STALL_TIMEOUT_MS);
  return Number.isFinite(envValue) && envValue > 0 ? envValue : 20000;
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
  } catch (error: unknown) {
    // Distinguish a browser-side cancellation (which is never retryable) from
    // an upstream network or timeout failure (which we treat as a transient
    // provider_unavailable).
    console.error('[chat-providers] fetch failed', {
      endpoint: input.endpoint,
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
    });
    if (input.signal?.aborted) {
      throw new ChatProviderFailure('stream_interrupted', false);
    }
    throw new ChatProviderFailure('provider_unavailable', true);
  }

  if (!response.ok || !response.body) {
    console.error('[chat-providers] non-ok response', {
      endpoint: input.endpoint,
      model: input.model,
      status: response.status,
    });
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
  const stallTimeoutMs = resolveStallTimeoutMs(input);
  let buffer = '';
  let terminal = false;
  try {
    while (true) {
      const { done, value } = await readWithStallTimeout(reader, stallTimeoutMs, input.signal);
      buffer = (buffer + decoder.decode(value, { stream: !done })).replaceAll('\r\n', '\n');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const payload = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!payload) continue;
        if (payload === '[DONE]') { terminal = true; continue; }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload) as unknown;
        } catch {
          throw new ChatProviderFailure('stream_interrupted', false);
        }
        const delta = contentDelta(parsed);
        if (delta) yield delta;
      }
      if (terminal) break;
      if (done) throw new ChatProviderFailure('stream_interrupted', false);
    }
  } catch (error: unknown) {
    if (error instanceof ChatProviderFailure) throw error;
    if (input.signal?.aborted) {
      throw new ChatProviderFailure('stream_interrupted', false);
    }
    throw new ChatProviderFailure('stream_interrupted', false);
  } finally {
    try { await reader.cancel(); } catch { /* disconnected */ }
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

async function readWithStallTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stallTimeoutMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('chat_provider_stall');
      error.name = 'ChatProviderStallError';
      reject(error);
    }, stallTimeoutMs);
  });
  // If the browser cancels we want the read promise to reject immediately
  // rather than waiting out the stall budget — otherwise a user clicking
  // "stop" would still see the upstream waiting for the full stall window.
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), stall, abortPromise]);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ChatProviderStallError') {
      throw new ChatProviderFailure('provider_unavailable', true);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ChatProviderFailure('provider_unavailable', true);
  // `replace_*` placeholders from .env.example must surface as a real config
  // failure rather than a 400 from the upstream — otherwise the request hangs
  // for the full upstream stall budget before failing.
  if (/^replace_/i.test(value)) throw new ChatProviderFailure('provider_unavailable', true);
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
