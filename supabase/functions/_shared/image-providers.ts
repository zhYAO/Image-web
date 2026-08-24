export type ImageAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type ImageResolution = '1K' | '2K';

export interface ProviderReference {
  bytesBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface ProviderImageInput {
  aspectRatio: ImageAspectRatio;
  model: string;
  prompt: string;
  references: ProviderReference[];
  resolution: ImageResolution;
}

export interface ProviderImageResult {
  bytesBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  providerRequestId?: string;
}

export class ImageProviderError extends Error {
  constructor(
    readonly code: 'moderation' | 'provider_error' | 'provider_unavailable',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}

const seedreamSizes: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '3:4': '768x1024',
    '4:3': '1024x768',
    '9:16': '576x1024',
    '16:9': '1024x576',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:4': '1536x2048',
    '4:3': '2048x1536',
    '9:16': '1152x2048',
    '16:9': '2048x1152',
  },
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function imageMimeType(value: unknown): ProviderImageResult['mimeType'] | undefined {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp' ? value : undefined;
}

export function buildGeminiRequest(input: ProviderImageInput) {
  return {
    contents: [{
      parts: [
        ...input.references.map((reference) => ({
          inlineData: { data: reference.bytesBase64, mimeType: reference.mimeType },
        })),
        { text: input.prompt },
      ],
    }],
    generationConfig: {
      imageConfig: { aspectRatio: input.aspectRatio, imageSize: input.resolution },
      responseModalities: ['IMAGE'],
    },
  };
}

export function decodeGeminiResponse(value: unknown): ProviderImageResult {
  const response = object(value);
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  let result: ProviderImageResult | undefined;
  for (const candidateValue of candidates) {
    const candidate = object(candidateValue);
    const parts = Array.isArray(object(candidate?.content)?.parts) ? object(candidate?.content)?.parts as unknown[] : [];
    for (const partValue of parts) {
      const part = object(partValue);
      if (part?.thought === true) continue;
      const inlineData = object(part?.inlineData ?? part?.inline_data);
      const bytesBase64 = string(inlineData?.data);
      const mimeType = imageMimeType(inlineData?.mimeType ?? inlineData?.mime_type);
      if (bytesBase64 && mimeType) {
        result = {
          bytesBase64,
          mimeType,
          providerRequestId: string(response?.responseId ?? response?.response_id),
        };
      }
    }
  }
  if (!result) throw new ImageProviderError('provider_error', 'provider_response_missing_image', false);
  return result;
}

export function buildSeedreamRequest(input: ProviderImageInput) {
  return {
    ...(input.references.length ? {
      image: input.references.map((reference) =>
        `data:${reference.mimeType};base64,${reference.bytesBase64}`),
    } : {}),
    model: input.model,
    prompt: input.prompt,
    response_format: 'b64_json',
    sequential_image_generation: 'disabled',
    size: seedreamSizes[input.resolution][input.aspectRatio],
    stream: false,
    watermark: false,
  };
}

export function decodeSeedreamResponse(value: unknown): ProviderImageResult {
  const response = object(value);
  const data = Array.isArray(response?.data) ? response.data : [];
  const first = object(data[0]);
  const bytesBase64 = string(first?.b64_json);
  if (!bytesBase64) throw new ImageProviderError('provider_error', 'provider_response_missing_image', false);
  return {
    bytesBase64,
    mimeType: 'image/png',
    providerRequestId: string(response?.id ?? response?.request_id),
  };
}

async function responseJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw new ImageProviderError('provider_error', 'provider_response_invalid_json', false);
  }
}

function providerHttpError(status: number, body: unknown) {
  const serialized = JSON.stringify(body).toLowerCase();
  if (serialized.includes('safety') || serialized.includes('moderation') || serialized.includes('sensitive')) {
    return new ImageProviderError('moderation', 'provider_content_blocked', false);
  }
  return new ImageProviderError(
    status === 429 || status >= 500 ? 'provider_unavailable' : 'provider_error',
    `provider_http_${status}`,
    status === 429 || status >= 500,
  );
}

export async function generateGeminiImage(
  input: ProviderImageInput,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      body: JSON.stringify(buildGeminiRequest(input)),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      method: 'POST',
      signal,
    },
  );
  const body = await responseJson(response);
  if (!response.ok) throw providerHttpError(response.status, body);
  return decodeGeminiResponse(body);
}

export async function generateSeedreamImage(
  input: ProviderImageInput,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    body: JSON.stringify(buildSeedreamRequest(input)),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    method: 'POST',
    signal,
  });
  const body = await responseJson(response);
  if (!response.ok) throw providerHttpError(response.status, body);
  return decodeSeedreamResponse(body);
}
