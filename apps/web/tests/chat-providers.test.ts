import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ChatProviderFailure,
  resolveChatProvider,
  streamOpenAiCompatibleChat,
} from '@/server/chat/chat-providers';

async function collect(stream: AsyncIterable<string>) {
  const values: string[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe('chat provider SSE adapter', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('resolves MiniMax with the configured model and official OpenAI-compatible endpoint', () => {
    vi.stubEnv('MINIMAX_API_KEY', 'minimax-test-key');
    vi.stubEnv('ZIMAGE_MINIMAX_CHAT_MODEL', 'MiniMax-M2.7');
    vi.stubEnv('ZIMAGE_MINIMAX_CHAT_ENDPOINT', '');

    expect(resolveChatProvider('minimax')).toEqual({
      apiKey: 'minimax-test-key',
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      model: 'MiniMax-M2.7',
      provider: 'minimax',
    });
  });

  it('fails closed when the MiniMax model mapping is still an example placeholder', () => {
    vi.stubEnv('MINIMAX_API_KEY', 'minimax-test-key');
    vi.stubEnv('ZIMAGE_MINIMAX_CHAT_MODEL', 'replace_with_minimax_model_id');

    expect(() => resolveChatProvider('minimax')).toThrow(ChatProviderFailure);
    expect(() => resolveChatProvider('minimax')).toThrow('provider_unavailable');
  });

  it('parses fragmented OpenAI-compatible SSE and ignores terminal usage chunks', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你'));
        controller.enqueue(encoder.encode('好"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":2}}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'text/event-stream' }, status: 200,
    }));

    await expect(collect(streamOpenAiCompatibleChat({
      apiKey: 'secret',
      endpoint: 'https://provider.example/v1/chat/completions',
      fetcher,
      message: '打招呼',
      model: 'chat-model',
    }))).resolves.toEqual(['你好']);
    expect(fetcher).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({
        body: JSON.stringify({
          messages: [{ content: '打招呼', role: 'user' }],
          model: 'chat-model',
          stream: true,
          stream_options: { include_usage: true },
        }),
        method: 'POST',
      }),
    );
  });

  it('rejects a truncated upstream even after receiving text', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
    await expect(collect(streamOpenAiCompatibleChat({ apiKey: 'test', endpoint: 'https://provider.example', fetcher, message: 'hi', model: 'test' })))
      .rejects.toMatchObject({ code: 'stream_interrupted' });
  });

  it.each([
    'data: [DONE]',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  ])('accepts an explicit completion including a final frame without a blank line: %s', async (ending) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`data: {"choices":[{"delta":{"content":"完整回复"}}]}\r\n\r\n${ending}`));
    await expect(collect(streamOpenAiCompatibleChat({ apiKey: 'test', endpoint: 'https://provider.example', fetcher, message: 'hi', model: 'test' })))
      .resolves.toEqual(['完整回复']);
  });

  it.each(['length', 'content_filter', 'tool_calls'])('does not treat %s as a successful ordinary text completion', async (reason) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`data: {"choices":[{"delta":{"content":"部分回复"},"finish_reason":"${reason}"}]}\n\ndata: [DONE]\n\n`));
    await expect(collect(streamOpenAiCompatibleChat({ apiKey: 'test', endpoint: 'https://provider.example', fetcher, message: 'hi', model: 'test' })))
      .rejects.toBeInstanceOf(ChatProviderFailure);
  });

  it('normalizes transient HTTP failures without exposing provider bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('provider-secret-detail', { status: 503 }));
    await expect(collect(streamOpenAiCompatibleChat({
      apiKey: 'secret',
      endpoint: 'https://provider.example/v1/chat/completions',
      fetcher,
      message: 'hello',
      model: 'chat-model',
    }))).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
  });

  it('aborts a stalled upstream read with a retryable provider_unavailable failure', async () => {
    const body = new ReadableStream({
      start() {
        // No chunks ever — simulates a TCP half-open or a stalled provider.
      },
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'text/event-stream' }, status: 200,
    }));

    await expect(collect(streamOpenAiCompatibleChat({
      apiKey: 'secret',
      endpoint: 'https://provider.example/v1/chat/completions',
      fetcher,
      message: 'hi',
      model: 'chat-model',
      // 1ms guarantees the stall timer fires before the test's outer timeout.
      stallTimeoutMs: 1,
    }))).rejects.toBeInstanceOf(ChatProviderFailure);
  });

  it('rejects the in-flight read immediately when the browser aborts before the stall fires', async () => {
    const body = new ReadableStream({
      start() {
        // Never enqueue.
      },
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'text/event-stream' }, status: 200,
    }));
    const controller = new AbortController();
    const promise = collect(streamOpenAiCompatibleChat({
      apiKey: 'secret',
      endpoint: 'https://provider.example/v1/chat/completions',
      fetcher,
      message: 'hi',
      model: 'chat-model',
      signal: controller.signal,
      stallTimeoutMs: 10_000,
    }));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'stream_interrupted', retryable: false });
  });

  it('classifies a fetch-level abort (browser cancelled) as stream_interrupted, not provider_unavailable', async () => {
    const fetcher = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const controller = new AbortController();
    const promise = collect(streamOpenAiCompatibleChat({
      apiKey: 'secret',
      endpoint: 'https://provider.example/v1/chat/completions',
      fetcher,
      message: 'hi',
      model: 'chat-model',
      signal: controller.signal,
    }));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'stream_interrupted', retryable: false });
  });
});
