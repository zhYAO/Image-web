import { describe, expect, it } from 'vitest';

import {
  buildGeminiRequest,
  buildSeedreamRequest,
  decodeGeminiResponse,
  decodeSeedreamResponse,
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
      size: '1536x2048',
      stream: false,
      watermark: false,
    });
  });

  it('omits the optional Seedream image field for text-to-image requests', () => {
    expect(buildSeedreamRequest({ ...input, references: [] })).not.toHaveProperty('image');
  });

  it('decodes a Seedream base64 response without trusting remote URLs', () => {
    expect(decodeSeedreamResponse({
      created: 123,
      data: [{ b64_json: 'c2VlZHJlYW0=', size: '1536x2048' }],
      id: 'seedream-request',
    })).toEqual({
      bytesBase64: 'c2VlZHJlYW0=',
      mimeType: 'image/png',
      providerRequestId: 'seedream-request',
    });
  });

  it('rejects provider responses that contain no image bytes', () => {
    expect(() => decodeGeminiResponse({ candidates: [] })).toThrow('provider_response_missing_image');
    expect(() => decodeSeedreamResponse({ data: [{ url: 'https://example.com/result.png' }] }))
      .toThrow('provider_response_missing_image');
  });
});
