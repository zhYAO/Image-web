import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerConfiguration } from '../_shared/generation-runner';
import {
  buildSeedreamRequest,
  generateSeedreamImage,
  normalizeSeedreamPlanEndpoint,
  type ProviderImageInput,
} from '../_shared/image-providers';

const planModel = 'doubao-seedream-5.0-pro';
const planEndpoint = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations';
const standardEndpoint = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const input: ProviderImageInput = {
  model: planModel,
  prompt: '合成测试商品',
  aspectRatio: '3:4',
  resolution: '2K',
  references: [],
};

function environment(values: Record<string, string>) {
  vi.stubGlobal('Deno', { env: { get: (name: string) => values[name] } });
}

describe('Seedream Plan route isolation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the exact Plan model with its own credential and complete endpoint', () => {
    environment({
      ZIMAGE_SEEDREAM_PLAN_API_KEY: 'synthetic-plan-key',
      ARK_API_KEY: 'synthetic-legacy-key',
    });
    expect(providerConfiguration('seedream', planModel)).toEqual({
      apiKey: 'synthetic-plan-key', model: planModel, endpoint: planEndpoint,
    });
  });

  it('rejects a missing Plan credential instead of borrowing the old Ark key', () => {
    environment({ ARK_API_KEY: 'synthetic-legacy-key' });
    expect(() => providerConfiguration('seedream', planModel))
      .toThrow('missing_env:ZIMAGE_SEEDREAM_PLAN_API_KEY');
  });

  it('pins Plan configuration to its approved endpoint without reading an endpoint override', () => {
    vi.stubGlobal('Deno', { env: { get: (name: string) => {
      if (name === 'ZIMAGE_SEEDREAM_PLAN_IMAGE_ENDPOINT') throw new Error('endpoint override must remain unread');
      return name === 'ZIMAGE_SEEDREAM_PLAN_API_KEY' ? 'synthetic-plan-key' : undefined;
    } } });
    expect(providerConfiguration('seedream', planModel)).toEqual({
      apiKey: 'synthetic-plan-key', model: planModel, endpoint: planEndpoint,
    });
  });

  it('keeps all historical Seedream models on their original route and credentials', () => {
    environment({
      ARK_API_KEY: 'synthetic-legacy-key',
      ZIMAGE_SEEDREAM_IMAGE_MODEL: 'historical-4.5-deployment',
      ZIMAGE_SEEDREAM_FLASH_IMAGE_MODEL: 'historical-flash-deployment',
      ZIMAGE_SEEDREAM_PRO_IMAGE_MODEL: 'historical-pro-deployment',
      ZIMAGE_SEEDREAM_PLAN_API_KEY: 'synthetic-plan-key',
      ZIMAGE_SEEDREAM_PLAN_IMAGE_ENDPOINT: planEndpoint,
    });
    for (const [model, deployment] of [
      ['seedream-4.5', 'historical-4.5-deployment'],
      ['seedream-5.0-flash', 'historical-flash-deployment'],
      ['seedream-5.0-pro', 'historical-pro-deployment'],
    ]) {
      expect(providerConfiguration('seedream', model)).toEqual({
        apiKey: 'synthetic-legacy-key', model: deployment, endpoint: standardEndpoint,
      });
    }
  });

  it('keeps historical Gemini jobs on their original deployment', () => {
    environment({ GEMINI_API_KEY: 'synthetic-gemini-key', ZIMAGE_GEMINI_IMAGE_MODEL: 'historical-gemini' });
    expect(providerConfiguration('gemini', 'gemini-3-pro-image')).toEqual({
      apiKey: 'synthetic-gemini-key', model: 'historical-gemini',
    });
  });

  it.each([
    'https://ark.cn-beijing.volces.com/api/plan/v3',
    'https://ark.cn-beijing.volces.com/api/plan/v3/',
    planEndpoint,
    planEndpoint + '/',
  ])('normalizes the approved Plan base or full endpoint exactly once: %s', (endpoint) => {
    expect(normalizeSeedreamPlanEndpoint(endpoint)).toBe(planEndpoint);
    environment({ ZIMAGE_SEEDREAM_PLAN_API_KEY: 'synthetic-plan-key', ZIMAGE_SEEDREAM_PLAN_IMAGE_ENDPOINT: endpoint });
    expect(providerConfiguration('seedream', planModel)).toHaveProperty('endpoint', planEndpoint);
  });

  it.each([
    'http://ark.cn-beijing.volces.com/api/plan/v3',
    'https://unapproved.invalid/api/plan/v3',
    'https://ark.cn-beijing.volces.com.attacker.invalid/api/plan/v3',
    standardEndpoint,
    planEndpoint + '/images/generations',
    planEndpoint + '?token=synthetic',
    planEndpoint + '#unexpected',
    'https://synthetic:credential@ark.cn-beijing.volces.com/api/plan/v3',
    'not-a-url',
  ])('rejects unapproved endpoints before any provider request: %s', (endpoint) => {
    expect(() => normalizeSeedreamPlanEndpoint(endpoint)).toThrow('invalid_seedream_plan_endpoint');
  });

  it('sends the full Plan endpoint unchanged and requests one base64 image', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'iVBORw0KGgo=' }], request_id: 'synthetic-result',
    }), { status: 200 }));
    await expect(generateSeedreamImage(input, 'synthetic-plan-key', fetcher as typeof fetch, undefined, planEndpoint))
      .resolves.toMatchObject({ mimeType: 'image/png', providerRequestId: 'synthetic-result' });
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(planEndpoint);
    expect(JSON.parse(String(request.body))).toEqual({
      model: planModel, prompt: input.prompt, response_format: 'b64_json', size: '1728x2304', watermark: false,
    });
  });

  it('preserves the standard endpoint for historical callers', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { status: 200 }));
    await generateSeedreamImage({ ...input, model: 'historical-pro-deployment' }, 'synthetic-legacy-key', fetcher as typeof fetch);
    expect(fetcher.mock.calls[0]?.[0]).toBe(standardEndpoint);
  });

  it('never defaults a Plan model request to the standard billing route', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { status: 200 }));
    await generateSeedreamImage(input, 'synthetic-plan-key', fetcher as typeof fetch);
    expect(fetcher.mock.calls[0]?.[0]).toBe(planEndpoint);
  });

  it('rejects a standard billing endpoint for a Plan model before sending its key', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => new Response('{}', { status: 200 }));
    await expect(generateSeedreamImage(input, 'synthetic-plan-key', fetcher as typeof fetch, undefined, standardEndpoint))
      .rejects.toThrow('invalid_seedream_plan_endpoint');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enforces the existing ten-reference, single-image Plan request contract', () => {
    const reference = { mimeType: 'image/jpeg' as const, bytesBase64: '/9j/' };
    expect(buildSeedreamRequest({ ...input, references: Array(10).fill(reference) }).image).toHaveLength(10);
    expect(() => buildSeedreamRequest({ ...input, references: Array(11).fill(reference) })).toThrow(/10/);
    const body = buildSeedreamRequest(input);
    expect(body).not.toHaveProperty('stream');
    expect(body).not.toHaveProperty('sequential_image_generation');
    expect(body).not.toHaveProperty('tools');
  });
});
