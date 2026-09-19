import { describe, expect, it } from 'vitest';

import {
  buildGeminiRequest,
  buildSeedreamRequest,
  decodeGeminiResponse,
  decodeSeedreamResponse,
  generateSeedreamImage,
  ImageProviderError,
  type ProviderImageInput,
} from '../_shared/image-providers';

const input: ProviderImageInput = {
  aspectRatio: '3:4',
  model: 'deployment-model',
  prompt: 'A clean product photograph',
  references: [{ bytesBase64: 'aW1hZ2U=', mimeType: 'image/png' }],
  resolution: '2K',
};

describe('image provider adapters', () => {
  it('maps Gemini image configuration and inline references', () => {
    expect(buildGeminiRequest(input)).toEqual({
      contents: [{ parts: [
        { inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } },
        { text: 'A clean product photograph' },
      ] }],
      generationConfig: {
        imageConfig: { aspectRatio: '3:4', imageSize: '2K' },
        responseModalities: ['IMAGE'],
      },
    });
  });

  it('returns the last non-thought Gemini image and request id', () => {
    expect(decodeGeminiResponse({
      candidates: [{ content: { parts: [
        { inlineData: { data: 'dGhvdWdodA==', mimeType: 'image/png' }, thought: true },
        { inlineData: { data: 'ZmluYWw=', mimeType: 'image/webp' } },
      ] } }],
      responseId: 'gemini-request',
    })).toEqual({
      bytesBase64: 'ZmluYWw=',
      mimeType: 'image/webp',
      providerRequestId: 'gemini-request',
    });
  });

  it('maps Seedream size and reference data URLs', () => {
    expect(buildSeedreamRequest(input)).toEqual({
      image: ['data:image/png;base64,aW1hZ2U='],
      model: 'deployment-model',
      prompt: 'A clean product photograph',
      response_format: 'b64_json',
      sequential_image_generation: 'disabled',
      size: '1728x2304',
      stream: false,
      watermark: false,
    });
  });

  it('promotes Seedream 1K requests to the provider minimum supported size', () => {
    expect(buildSeedreamRequest({ ...input, references: [], resolution: '1K' }).size)
      .toBe('1728x2304');
  });

  it('omits the optional Seedream image field for text-to-image requests', () => {
    expect(buildSeedreamRequest({ ...input, references: [] })).not.toHaveProperty('image');
  });

  it('decodes a Seedream base64 response without trusting remote URLs', () => {
    expect(decodeSeedreamResponse({
      created: 123,
      data: [{ b64_json: 'iVBORw0KGgo=', size: '1728x2304' }],
      id: 'seedream-request',
    })).toEqual({
      bytesBase64: 'iVBORw0KGgo=',
      mimeType: 'image/png',
      providerRequestId: 'seedream-request',
    });
  });

  it('preserves the JPEG format returned by Seedream 4.5', () => {
    expect(decodeSeedreamResponse({ data: [{ b64_json: '/9j/4AAQSkZJRg==' }] })).toEqual({
      bytesBase64: '/9j/4AAQSkZJRg==',
      mimeType: 'image/jpeg',
      providerRequestId: undefined,
    });
  });

  it('rejects provider responses that contain no image bytes', () => {
    expect(() => decodeGeminiResponse({ candidates: [] })).toThrow('provider_response_missing_image');
    expect(() => decodeSeedreamResponse({ data: [{ url: 'https://example.com/result.png' }] }))
      .toThrow('provider_response_missing_image');
  });

  it('normalizes a provider safety response without retaining its prompt, URL or token', async () => {
    const rawProviderBody = {
      error: {
        message: 'sensitive prompt=https://private.example/image.png token=provider-secret',
        type: 'moderation_blocked',
      },
    };
    const fetcher = async () => new Response(JSON.stringify(rawProviderBody), {
      headers: { 'content-type': 'application/json' },
      status: 400,
    });

    let failure: unknown;
    try {
      await generateSeedreamImage(input, 'provider-secret', fetcher as typeof fetch);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ImageProviderError);
    expect(failure).toMatchObject({
      code: 'moderation',
      message: 'provider_content_blocked',
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toContain('sensitive prompt');
    expect(JSON.stringify(failure)).not.toContain('private.example');
    expect(JSON.stringify(failure)).not.toContain('provider-secret');
  });
  it.each([
    [200, '{}', 'unknown'],
    [200, 'not-json', 'unknown'],
    [503, '{"error":{"type":"moderation_blocked"}}', 'unknown'],
    [400, '{"error":{"type":"invalid_request"}}', 'rejected'],
    [429, '{"error":{"type":"rate_limit"}}', 'rejected'],
  ] as const)('classifies HTTP %s with body %s as %s', async (status, body, outcome) => {
    const fetcher = async () => new Response(body, { status });
    await expect(generateSeedreamImage(input, 'test-key', fetcher as typeof fetch))
      .rejects.toMatchObject({ outcome });
  });

});
