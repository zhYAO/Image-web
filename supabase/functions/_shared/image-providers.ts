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
  targetWidth?: number;
  targetHeight?: number;
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
    readonly outcome: 'rejected' | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}

const seedreamSizes: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  // Seedream 4.5 rejects outputs below 3,686,400 pixels, so logical 1K requests use its minimum 2K geometry.
  '1K': {
    '1:1': '2048x2048',
    '3:4': '1728x2304',
    '4:3': '2304x1728',
    '9:16': '1600x2848',
    '16:9': '2848x1600',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:4': '1728x2304',
    '4:3': '2304x1728',
    '9:16': '1600x2848',
    '16:9': '2848x1600',
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

function base64ImageMimeType(value: string): ProviderImageResult['mimeType'] {
  if (value.startsWith('/9j/')) return 'image/jpeg';
  if (value.startsWith('iVBORw0KGgo')) return 'image/png';
  if (value.startsWith('UklGR')) return 'image/webp';
  throw new ImageProviderError('provider_error', 'provider_response_unsupported_image', false);
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
  const targetSize = input.targetWidth && input.targetHeight ? (() => {
    const scale = Math.max(1, Math.sqrt(3_686_400 / (input.targetWidth * input.targetHeight)));
    const width = Math.ceil(input.targetWidth * scale / 16) * 16;
    const height = Math.ceil(input.targetHeight * scale / 16) * 16;
    return width * height <= 16_777_216 && width / height >= 1 / 16 && width / height <= 16 ? `${width}x${height}` : undefined;
  })() : undefined;
  return {
    ...(input.references.length ? {
      image: input.references.map((reference) =>
        `data:${reference.mimeType};base64,${reference.bytesBase64}`),
    } : {}),
    model: input.model,
    prompt: input.prompt,
    response_format: 'b64_json',
    sequential_image_generation: 'disabled',
    size: targetSize ?? seedreamSizes[input.resolution][input.aspectRatio],
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
    mimeType: base64ImageMimeType(bytesBase64),
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
  // Transport/server/decoding failures do not prove that generation was rejected.
  // Only explicit client-rejection HTTP statuses may enter ordinary failed retry.
  const outcome = [400, 401, 403, 404, 422, 429].includes(status) ? 'rejected' : 'unknown';
  const error = object(object(body)?.error);
  const reason = String(error?.code ?? error?.type ?? error?.status ?? '').toLowerCase();
  if (outcome === 'rejected' && /safety|moderation|sensitive/.test(reason)) {
    return new ImageProviderError('moderation', 'provider_content_blocked', false, outcome);
  }
  return new ImageProviderError(
    status === 429 || status >= 500 ? 'provider_unavailable' : 'provider_error',
    `provider_http_${status}`,
    status === 429 || status >= 500,
    outcome,
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
