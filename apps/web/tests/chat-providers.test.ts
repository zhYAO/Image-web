import { describe, expect, it, vi } from 'vitest';

import { streamOpenAiCompatibleChat } from '@/server/chat/chat-providers';

async function collect(stream: AsyncIterable<string>) {
  const values: string[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe('chat provider SSE adapter', () => {
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
});
