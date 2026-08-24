import { withSupabase } from '@supabase/server';

import { captureWorkerException } from '../_shared/sentry.ts';

import {
  generateGeminiImage,
  generateSeedreamImage,
  ImageProviderError,
  type ImageAspectRatio,
  type ImageResolution,
  type ProviderImageResult,
  type ProviderReference,
} from '../_shared/image-providers.ts';

type AdminClient = {
  rpc(name: string, input?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      upload(path: string, body: Uint8Array, options: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    };
  };
};

interface QueueReference {
  bucket: string;
  id: string;
  mimeType: ProviderReference['mimeType'];
  path: string;
}

interface ClaimedGeneration {
  action: 'process';
  batchId: string;
  correlationId?: string;
  generationId: string;
  messageId: number;
  model: string;
  params: { aspectRatio: ImageAspectRatio; referenceIds?: string[]; resolution: ImageResolution };
  prompt: string;
  provider: 'gemini' | 'seedream';
  readCount: number;
  references: QueueReference[];
  sessionId: string;
  userId: string;
}

interface QueueAction {
  action: 'archive' | 'fail_unknown';
  generationId?: string;
  messageId: number;
  reason: string;
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseClaim(value: unknown): ClaimedGeneration | QueueAction | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_queue_claim');
  const claim = value as Record<string, unknown>;
  if ((claim.action === 'archive' || claim.action === 'fail_unknown')
    && Number.isSafeInteger(claim.messageId)
    && typeof claim.reason === 'string') {
    return {
      action: claim.action,
      generationId: isUuid(claim.generationId) ? claim.generationId : undefined,
      messageId: claim.messageId as number,
      reason: claim.reason,
    };
  }
  const params = claim.params as Record<string, unknown> | undefined;
  const references = Array.isArray(claim.references) ? claim.references : [];
  const referenceIds = params && Array.isArray(params.referenceIds) ? params.referenceIds : [];
  if (
    claim.action !== 'process'
    || !isUuid(claim.batchId)
    || !isUuid(claim.generationId)
    || !Number.isSafeInteger(claim.messageId)
    || !Number.isSafeInteger(claim.readCount)
    || !isUuid(claim.sessionId)
    || !isUuid(claim.userId)
    || (claim.provider !== 'gemini' && claim.provider !== 'seedream')
    || typeof claim.model !== 'string'
    || typeof claim.prompt !== 'string'
    || !params
    || !['1:1', '3:4', '4:3', '9:16', '16:9'].includes(String(params.aspectRatio))
    || !['1K', '2K'].includes(String(params.resolution))
    || !referenceIds.every(isUuid)
    || referenceIds.length > 4
  ) throw new Error('invalid_queue_claim');

  const parsedReferences = references.map((value): QueueReference => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_queue_reference');
    const reference = value as Record<string, unknown>;
    if (
      !isUuid(reference.id)
      || reference.bucket !== 'uploads'
      || typeof reference.path !== 'string'
      || !['image/jpeg', 'image/png', 'image/webp'].includes(String(reference.mimeType))
    ) throw new Error('invalid_queue_reference');
    return reference as unknown as QueueReference;
  });

  return {
    action: 'process',
    batchId: claim.batchId,
    correlationId: typeof claim.correlationId === 'string' ? claim.correlationId : undefined,
    generationId: claim.generationId,
    messageId: claim.messageId as number,
    model: claim.model,
    params: params as ClaimedGeneration['params'],
    prompt: claim.prompt,
    provider: claim.provider,
    readCount: claim.readCount as number,
    references: parsedReferences,
    sessionId: claim.sessionId,
    userId: claim.userId,
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function rpc<T>(admin: AdminClient, name: string, input?: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, input);
  if (error) throw new Error(`rpc_failed:${name}`);
  return data as T;
}

async function downloadReferences(admin: AdminClient, references: QueueReference[]) {
  const downloaded: ProviderReference[] = [];
  for (const reference of references) {
    const { data, error } = await admin.storage.from(reference.bucket).download(reference.path);
    if (error || !data) throw new Error('reference_download_failed');
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error('reference_download_invalid');
    downloaded.push({ bytesBase64: bytesToBase64(bytes), mimeType: reference.mimeType });
  }
  return downloaded;
}

function providerConfiguration(provider: ClaimedGeneration['provider']) {
  return provider === 'gemini'
    ? { apiKey: env('GEMINI_API_KEY'), model: env('ZIMAGE_GEMINI_IMAGE_MODEL') }
    : { apiKey: env('ARK_API_KEY'), model: env('ZIMAGE_SEEDREAM_IMAGE_MODEL') };
}

async function callProvider(claim: ClaimedGeneration, references: ProviderReference[]) {
  const configuration = providerConfiguration(claim.provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const input = {
      aspectRatio: claim.params.aspectRatio,
      model: configuration.model,
      prompt: claim.prompt,
      references,
      resolution: claim.params.resolution,
    };
    return claim.provider === 'gemini'
      ? await generateGeminiImage(input, configuration.apiKey, fetch, controller.signal)
      : await generateSeedreamImage(input, configuration.apiKey, fetch, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadResult(admin: AdminClient, claim: ClaimedGeneration, result: ProviderImageResult) {
  const extension = result.mimeType === 'image/jpeg' ? 'jpg' : result.mimeType.split('/')[1];
  const storagePath = `${claim.userId}/${claim.sessionId}/${claim.generationId}.${extension}`;
  const bytes = base64ToBytes(result.bytesBase64);
  if (bytes.length === 0 || bytes.length > 30 * 1024 * 1024) throw new Error('provider_image_size_invalid');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await admin.storage.from('generated').upload(storagePath, bytes, {
      cacheControl: '31536000', contentType: result.mimeType, upsert: true,
    });
    if (!error) return storagePath;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error('result_storage_failed');
}

async function failBeforeSubmission(admin: AdminClient, claim: ClaimedGeneration, errorCode: string) {
  if (claim.readCount < 5) {
    await rpc(admin, 'retry_image_generation', {
      p_error_code: errorCode, p_generation_id: claim.generationId,
    });
    return;
  }
  await rpc(admin, 'fail_image_generation', {
    p_error_code: errorCode,
    p_generation_id: claim.generationId,
    p_message_id: claim.messageId,
    p_release_quota: true,
    p_submission_state: 'not_submitted',
  });
}

async function processClaim(admin: AdminClient, claim: ClaimedGeneration) {
  let references: ProviderReference[];
  try {
    const providerAvailable = await rpc<boolean>(admin, 'assert_chat_provider_available', {
      p_provider: claim.provider,
    });
    if (!providerAvailable) {
      await failBeforeSubmission(admin, claim, 'provider_unavailable');
      return { action: claim.readCount < 5 ? 'retry' : 'failed', code: 'provider_unavailable' };
    }
    providerConfiguration(claim.provider);
    if ((claim.params.referenceIds?.length ?? 0) !== claim.references.length) {
      throw new Error('reference_count_mismatch');
    }
    references = await downloadReferences(admin, claim.references);
  } catch (error: unknown) {
    const code = error instanceof Error && (
      error.message.startsWith('missing_env:')
      || error.message === 'rpc_failed:assert_chat_provider_available'
    )
      ? 'provider_unavailable'
      : 'reference_download_failed';
    await failBeforeSubmission(admin, claim, code);
    return { action: claim.readCount < 5 ? 'retry' : 'failed', code };
  }

  const marked = await rpc<boolean>(admin, 'mark_provider_submission_started', {
    p_generation_id: claim.generationId,
  });
  if (!marked) throw new Error('provider_submission_state_conflict');

  let result: ProviderImageResult;
  try {
    result = await callProvider(claim, references);
  } catch (error: unknown) {
    const knownResponse = error instanceof ImageProviderError;
    if (knownResponse && error.code === 'moderation') {
      await rpc(admin, 'record_image_safety_decision', {
        p_category: 'provider_content_policy',
        p_decision: 'block',
        p_generation_id: claim.generationId,
      });
    }
    await rpc(admin, 'fail_image_generation', {
      p_error_code: knownResponse ? error.code : 'provider_result_unknown',
      p_generation_id: claim.generationId,
      p_message_id: claim.messageId,
      p_release_quota: false,
      p_submission_state: knownResponse ? 'submitted' : 'unknown',
    });
    return { action: 'failed', code: knownResponse ? error.code : 'provider_result_unknown' };
  }

  try {
    const storagePath = await uploadResult(admin, claim, result);
    await rpc(admin, 'complete_image_generation', {
      p_generation_id: claim.generationId,
      p_message_id: claim.messageId,
      p_provider_request_id: result.providerRequestId ?? null,
      p_storage_path: storagePath,
    });
    return { action: 'completed' };
  } catch {
    await rpc(admin, 'fail_image_generation', {
      p_error_code: 'result_storage_failed',
      p_generation_id: claim.generationId,
      p_message_id: claim.messageId,
      p_release_quota: false,
      p_submission_state: 'submitted',
    });
    return { action: 'failed', code: 'result_storage_failed' };
  }
}

export default {
  fetch: withSupabase({ auth: ['secret'] }, async (request, context) => {
    if (request.headers.get('x-worker-secret') !== env('ZIMAGE_WORKER_CRON_SECRET')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = context.supabaseAdmin as unknown as AdminClient;
    let correlationId: string | undefined;
    let generationId: string | undefined;
    try {
      const claim = parseClaim(await rpc<unknown>(admin, 'claim_image_generation'));
      if (!claim) return Response.json({ status: 'idle' });

      if (claim.action === 'archive') {
        await rpc(admin, 'archive_image_message', { p_message_id: claim.messageId });
        return Response.json({ action: 'archived', reason: claim.reason });
      }
      if (claim.action === 'fail_unknown') {
        if (!claim.generationId) throw new Error('invalid_unknown_generation');
        generationId = claim.generationId;
        await rpc(admin, 'fail_image_generation', {
          p_error_code: 'provider_result_unknown',
          p_generation_id: claim.generationId,
          p_message_id: claim.messageId,
          p_release_quota: false,
          p_submission_state: 'unknown',
        });
        return Response.json({ action: 'failed', code: 'provider_result_unknown' });
      }
      if (claim.action !== 'process') throw new Error('invalid_queue_action');

      correlationId = claim.correlationId;
      generationId = claim.generationId;
      const result = await processClaim(admin, claim);
      console.log(JSON.stringify({
        action: result.action,
        batchId: claim.batchId,
        code: 'code' in result ? result.code : undefined,
        correlationId,
        generationId,
        provider: claim.provider,
      }));
      return Response.json(result);
    } catch (error: unknown) {
      await captureWorkerException(error, {
        correlationId,
        jobId: generationId,
        operation: 'generation_worker',
      });
      return Response.json({ error: 'generation_worker_failed' }, { status: 500 });
    }
  }),
};
