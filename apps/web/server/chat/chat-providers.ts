export class ChatProviderFailure extends Error {
  constructor(
    readonly code:
      | "moderation"
      | "provider_error"
      | "provider_unavailable"
      | "stream_interrupted",
    readonly retryable: boolean,
    readonly outcome: "unknown" | "rejected" = "unknown",
  ) {
    super(code);
    this.name = "ChatProviderFailure";
  }
}

interface OpenAiCompatibleChatInput {
  edgeRelay?:boolean;
  billingAuthorization?:{userId:string;requestId:string};
  apiKey: string;
  correlationId?: string;
  endpoint: string;
  fetcher?: typeof fetch;
  message: string;
  messages?: Array<{ content: string; role: 'assistant' | 'user' }>;
  model: string;
  /** MiniMax structured-output callers need reasoning outside delta.content. */
  reasoningSplit?: boolean;
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

export async function* streamOpenAiCompatibleChat(
  input: OpenAiCompatibleChatInput,
) {
  if(input.edgeRelay&&!input.billingAuthorization)throw new ChatProviderFailure('provider_error',false,'rejected');
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(input.endpoint, {
      body: JSON.stringify(input.edgeRelay?{...input.billingAuthorization,model:input.model}:{
        messages: input.messages ?? [{ content: input.message, role: 'user' }],
        model: input.model,
        stream: true,
        stream_options: { include_usage: true },
        ...(input.reasoningSplit ? { reasoning_split: true } : {}),
      }),
      headers: {
        ...(input.edgeRelay?{apikey:input.apiKey}:{authorization:`Bearer ${input.apiKey}`}),
        "content-type": "application/json",
      },
      method: "POST",
      signal: input.signal,
    });
  } catch {
    // Distinguish a browser-side cancellation (which is never retryable) from
    // an upstream network or timeout failure (which we treat as a transient
    // provider_unavailable).
    console.error('[chat-providers] fetch failed', {
      correlationId: input.correlationId,
      aborted: Boolean(input.signal?.aborted),
    });
    if (input.signal?.aborted) {
      throw new ChatProviderFailure('stream_interrupted', false);
    }
    throw new ChatProviderFailure('provider_unavailable', true);
  }

  if(input.edgeRelay&&!response.ok&&response.body){
    const r=response.body.getReader(),dec=new TextDecoder();let body='',bytes=0;
    try{for(;;){const p=await r.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>1024)break;body+=dec.decode(p.value,{stream:true});}
      if(bytes<=1024&&JSON.parse(body).error==='relay_not_started')throw new ChatProviderFailure('provider_unavailable',false,'rejected');
    }catch(error){if(error instanceof ChatProviderFailure)throw error;}
    finally{await r.cancel().catch(()=>undefined);r.releaseLock();}
  }
  if(input.edgeRelay&&(!response.ok||!response.body))throw new ChatProviderFailure('provider_unavailable',false,'unknown');
  if (!response.ok || !response.body) {
    console.error('[chat-providers] non-ok response', {
      correlationId: input.correlationId,
      status: response.status,
    });
    if (response.status === 400 || response.status === 422) {
      throw new ChatProviderFailure("provider_error", false, "rejected");
    }
    throw new ChatProviderFailure(
      response.status === 429 || response.status >= 500 ? 'provider_unavailable' : 'provider_error',
      response.status === 429 || response.status >= 500,
      response.status >= 400 && response.status < 500 ? "rejected" : "unknown",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stallTimeoutMs = resolveStallTimeoutMs(input);
  let buffer = "";
  let terminal = false;
  let finishReason: string | undefined;
  try {
    while (true) {
      const { done, value } = await readWithStallTimeout(
        reader,
        stallTimeoutMs,
        input.signal,
      );
      buffer = (buffer + decoder.decode(value, { stream: !done })).replaceAll(
        "\r\n",
        "\n",
      );
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      if (done && buffer.trim()) {
        frames.push(buffer);
        buffer = "";
      }
      for (const frame of frames) {
        const payload = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!payload) continue;
        if (payload === "[DONE]") {
          terminal = true;
          break;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload) as unknown;
        } catch {
          throw new ChatProviderFailure('stream_interrupted', false);
        }
        const envelope =
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : undefined;
        const baseResponse = envelope?.base_resp as { status_code?: unknown } | undefined;
        if (envelope?.error || (typeof baseResponse?.status_code === 'number' && baseResponse.status_code !== 0)) {
          throw new ChatProviderFailure('provider_error', false);
        }
        const choice = Array.isArray(envelope?.choices)
          ? (envelope.choices[0] as { finish_reason?: unknown } | undefined)
          : undefined;
        finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
        if (finishReason === 'content_filter') throw new ChatProviderFailure('moderation', false);
        const delta = contentDelta(parsed);
        if (delta) yield delta;
        // MiniMax can finish with stop + usage + EOF, without a [DONE] sentinel.
        // Text alone (or EOF alone) is never proof of a completed reply.
        if (finishReason === "stop") {
          terminal = true;
          break;
        }
        if (finishReason)
          throw new ChatProviderFailure(
            finishReason === "length" ? "stream_interrupted" : "provider_error",
            false,
          );
      }
      if (terminal) break;
      if (done) throw new ChatProviderFailure("stream_interrupted", false);
    }
    console.info("[chat-providers] stream completed", {
      correlationId: input.correlationId,
      finishReason: finishReason ?? "done",
    });
  } catch (error: unknown) {
    console.warn('[chat-providers] stream failed', {
      correlationId: input.correlationId,
      code: error instanceof ChatProviderFailure ? error.code : 'stream_interrupted',
    });
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

export type ChatProviderId = "doubao" | "gpt-6-astra" | "gpt-6.1-sol";
export function resolveChatProvider(chatModel?: string) {
  if(chatModel==='gpt-6-astra'||chatModel==='gpt-6.1-sol') {
    if(process.env.ZIMAGE_OPENAI_ENABLED!=='true')throw new ChatProviderFailure('provider_unavailable',false,'rejected');
    const url=new URL(requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'));
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new ChatProviderFailure('provider_unavailable',false,'rejected');
    return {apiKey:requiredEnvironment('SUPABASE_SECRET_KEY'),endpoint:url.origin+'/functions/v1/openai-chat',model:chatModel,provider:chatModel,edgeRelay:true};
  }
  if (chatModel && chatModel !== 'doubao') throw new ChatProviderFailure('provider_error', false, 'rejected');
  if(process.env.ZIMAGE_DOUBAO_EDGE_ENABLED!=='true')throw new ChatProviderFailure('provider_unavailable',false,'rejected');
  const url=new URL(requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'));
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new ChatProviderFailure('provider_unavailable',false,'rejected');
  return {apiKey:requiredEnvironment('SUPABASE_SECRET_KEY'),endpoint:url.origin+'/functions/v1/doubao-chat',model:'doubao',provider:'doubao' as const,edgeRelay:true};
}
