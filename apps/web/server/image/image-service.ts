import {
  MODEL_REGISTRY_VERSION,
  imageRequestSchema,
  imageSubmissionResponseSchema,
  resolveImageModel,
  resolveSkill,
  type ImageApiRequest,
  type ImageSubmissionResponse,
} from '@zimage/domain';
import { z } from "zod";

import { ApiRouteError } from "@/server/api-error";

export interface GenerationSubmissionInput {
  billing?: ImageApiRequest["billing"];
  config: ImageApiRequest["params"] & { registryVersion?: string };
  correlationId: string;
  idempotencyKey: string;
  model: string;
  prompt: string;
  provider: string;
  requestHash: string;
  sessionId?: string;
  skillId?: string;
  skillVersion?: string;
  source: "direct" | "chat_tool";
  userId: string;
}

export interface GenerationSubmissionStore {
  lookupSubmission?(input: { userId: string; idempotencyKey: string }): Promise<GenerationSubmissionSnapshot | null>;
  submit(
    input: GenerationSubmissionInput,
  ): Promise<ImageSubmissionResponse & { deduplicated: boolean }>;
}

export interface GenerationSubmissionSnapshot {
  batchId: string;
  sessionId: string;
  config: { registryVersion?: string };
  model: string;
  provider: string;
  requestHash: string;
  skillId?: string;
  skillVersion?: string;
  source: 'direct' | 'chat_tool';
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export async function hashCanonicalRequest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function invalidSelection(message: string) {
  return new ApiRouteError({
    code: 'bad_request',
    details: { field: 'provider' },
    message,
    retryable: false,
    status: 400,
  });
}

export async function prepareImageSubmission(
  userId: string,
  input: ImageApiRequest,
  idempotencyKey: string,
  correlationId: string,
  source: "direct" | "chat_tool" = "direct",
): Promise<GenerationSubmissionInput> {
  const request = imageRequestSchema.parse(input);
  const parsedUserId = z.uuid().parse(userId);
  const parsedIdempotencyKey = z.uuid().parse(idempotencyKey);
  const parsedCorrelationId = z.uuid().parse(correlationId);
  let resolvedModel: ReturnType<typeof resolveImageModel>;
  let skill: ReturnType<typeof resolveSkill>;
  try {
    resolvedModel = resolveImageModel({
      model: request.model,
      provider: request.provider,
    });
    skill = resolveSkill(request.skillId);
  } catch (error: unknown) {
    throw invalidSelection(
      error instanceof Error ? error.message : "不支持的生成配置。",
    );
  }

  const capability = resolvedModel.capability;
  if (
    request.params.count > capability.maxImages
    || !capability.aspectRatios.includes(request.params.aspectRatio)
    || !capability.resolutions.includes(request.params.resolution)
  ) {
    throw invalidSelection('所选模型不支持当前生成参数。');
  }

  const config = {
    ...request.params,
    registryVersion: MODEL_REGISTRY_VERSION,
  };
  return {
    config,
    billing: request.billing,
    correlationId: parsedCorrelationId,
    idempotencyKey: parsedIdempotencyKey,
    model: resolvedModel.model,
    prompt: request.prompt,
    provider: resolvedModel.provider,
    requestHash: await hashCanonicalRequest({
      config,
      model: resolvedModel.model,
      prompt: request.prompt,
      provider: resolvedModel.provider,
      sessionId: request.sessionId,
      skillId: skill?.id,
      skillVersion: skill?.version,
      source,
      userId: parsedUserId,
    }),
    sessionId: request.sessionId,
    skillId: skill?.id,
    skillVersion: skill?.version,
    source,
    userId: parsedUserId,
  };
}

export function toImageSubmissionResponse(result: {
  batchId: string;
  deduplicated?: boolean;
  sessionId: string;
  status: 'pending';
}) {
  return imageSubmissionResponseSchema.parse({
    batchId: result.batchId,
    sessionId: result.sessionId,
    status: result.status,
  });
}

export async function restoreImageSubmission(userId: string, raw: ImageApiRequest, idempotencyKey: string, correlationId: string, snapshot: GenerationSubmissionSnapshot, source: 'direct' | 'chat_tool' = 'direct'): Promise<GenerationSubmissionInput> {
  z.uuid().parse(userId); z.uuid().parse(idempotencyKey); z.uuid().parse(correlationId);
  const request = imageRequestSchema.parse(raw);
  const config = { ...request.params, ...(snapshot.config.registryVersion ? { registryVersion: snapshot.config.registryVersion } : {}) };
  const model = request.model ?? snapshot.model, provider = request.provider ?? snapshot.provider;
  const skillVersion = request.skillId === snapshot.skillId ? snapshot.skillVersion : undefined;
  const requestHash = await hashCanonicalRequest({ config, model, prompt: request.prompt, provider, sessionId: request.sessionId, skillId: request.skillId, skillVersion, source, userId });
  if (snapshot.source !== source || requestHash !== snapshot.requestHash)
    throw new ApiRouteError({ code: 'conflict', status: 409, retryable: false, message: '相同幂等键已用于另一份请求，请重新提交。' });
  return { billing: request.billing, config, correlationId, idempotencyKey, model, prompt: request.prompt, provider,
    requestHash: snapshot.requestHash, sessionId: request.sessionId, skillId: request.skillId, skillVersion, source, userId };
}

export function createImageService(store: GenerationSubmissionStore) {
  async function recover(userId: string, raw: ImageApiRequest, idempotencyKey: string, source: 'direct' | 'chat_tool' = 'direct') {
    if (!store.lookupSubmission) return null;
    z.uuid().parse(userId);
    z.uuid().parse(idempotencyKey);
    const request = imageRequestSchema.parse(raw);
    const snapshot = await store.lookupSubmission({ userId, idempotencyKey });
    if (!snapshot) return null;
    // Compare the original material and registry version before today's admission
    // whitelist. A committed request may be recovered, never repurchased.
    await restoreImageSubmission(userId, request, idempotencyKey, idempotencyKey, snapshot, source);
    return toImageSubmissionResponse({ batchId: snapshot.batchId, sessionId: snapshot.sessionId, status: 'pending' });
  }
  async function submitPrepared(prepared: GenerationSubmissionInput) {
    const result = await store.submit(prepared);
    return toImageSubmissionResponse(result);
  }

  return {
    recover,
    prepare: prepareImageSubmission,
    async submit(
      userId: string,
      input: ImageApiRequest,
      idempotencyKey: string,
      correlationId: string,
      source: "direct" | "chat_tool" = "direct",
    ) {
      const prior = await recover(userId, input, idempotencyKey, source);
      if (prior) return prior;
      return submitPrepared(
        await prepareImageSubmission(
          userId,
          input,
          idempotencyKey,
          correlationId,
          source,
        ),
      );
    },
    submitPrepared,
  };
}
