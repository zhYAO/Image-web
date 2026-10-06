import {
  generateGeminiImage,
  generateSeedreamImage,
  ImageProviderError,
  type ImageAspectRatio,
  type ImageResolution,
  type ProviderImageResult,
  type ProviderReference,
} from './image-providers.ts';

export type AdminClient = {
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

export interface ClaimedGeneration {
  action: 'process' | 'recover';
  claimToken: string;
  checkpoint?: ResultCheckpoint;
  batchId: string;
  correlationId?: string;
  generationId: string;
  messageId: number;
  model: string;
  params: { aspectRatio: ImageAspectRatio; referenceIds?: string[]; resolution: ImageResolution; targetWidth?: number; targetHeight?: number };
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

export function parseClaim(value: unknown): ClaimedGeneration | QueueAction | null {
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
    (claim.action !== 'process' && claim.action !== 'recover')
    || !isUuid(claim.claimToken)
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
    || referenceIds.length > 14
    || ((params.targetWidth !== undefined || params.targetHeight !== undefined) &&
      (!Number.isInteger(params.targetWidth) || !Number.isInteger(params.targetHeight) || Number(params.targetWidth) < 1 || Number(params.targetHeight) < 1 || Number(params.targetWidth) > 8192 || Number(params.targetHeight) > 8192))
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
    action: claim.action as ClaimedGeneration['action'],
    claimToken: claim.claimToken as string,
    checkpoint: claim.action === 'recover' ? parseCheckpoint(claim.checkpoint) : undefined,
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

export function providerConfiguration(provider: ClaimedGeneration['provider'], model: string) {
  const seedreamEnvironment: Record<string, string> = {
    'seedream-5.0-flash': 'ZIMAGE_SEEDREAM_FLASH_IMAGE_MODEL',
    'seedream-5.0-pro': 'ZIMAGE_SEEDREAM_PRO_IMAGE_MODEL',
    'seedream-4.5': 'ZIMAGE_SEEDREAM_IMAGE_MODEL',
  };
  if (provider === 'seedream' && !seedreamEnvironment[model]) throw new Error('unsupported_seedream_model');
  return provider === 'gemini'
    ? { apiKey: env('GEMINI_API_KEY'), model: env('ZIMAGE_GEMINI_IMAGE_MODEL') }
    : { apiKey: env('ARK_API_KEY'), model: env(seedreamEnvironment[model]!) };
}

async function callProvider(claim: ClaimedGeneration, references: ProviderReference[], signal?: AbortSignal) {
  const configuration = providerConfiguration(claim.provider, claim.model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const input = {
      aspectRatio: claim.params.aspectRatio,
      model: configuration.model,
      legacySeedream: claim.model === 'seedream-4.5',
      prompt: claim.prompt,
      references,
      targetWidth: claim.params.targetWidth,
      targetHeight: claim.params.targetHeight,
      resolution: claim.params.resolution,
    };
    return claim.provider === 'gemini'
      ? await generateGeminiImage(input, configuration.apiKey, fetch, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal)
      : await generateSeedreamImage(input, configuration.apiKey, fetch, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export interface ResultCheckpoint extends ProviderImageResult { storagePath: string }

function parseCheckpoint(value: unknown): ResultCheckpoint {
  if (!value || typeof value !== 'object') throw new Error('invalid_result_checkpoint');
  const result = value as ResultCheckpoint;
  if (typeof result.storagePath !== 'string' || !result.storagePath
    || typeof result.bytesBase64 !== 'string'
    || !['image/jpeg', 'image/png', 'image/webp'].includes(result.mimeType)) throw new Error('invalid_result_checkpoint');
  return result;
}

class LeaseLost extends Error {}

export interface GenerationDependencies {
  callProvider(claim: ClaimedGeneration, references: ProviderReference[], signal?: AbortSignal): Promise<ProviderImageResult>;
}

// Every invocation, including recovery, uses the same fenced state machine. A
// checkpoint contains bytes as well as the upload intent, so a process crash on
// either side of Storage never requires buying a second provider result.
export async function processClaim(
  admin: AdminClient, claim: ClaimedGeneration, dependencies: GenerationDependencies = { callProvider },
) {
  const controller = new AbortController();
  let stopped = false;
  let renewal: Promise<void> | undefined;
  const step = async (operation: string, payload: Record<string, unknown> = {}) => {
    if (stopped) throw new LeaseLost('generation_lease_lost');
    const data = await rpc<{ accepted: boolean }>(admin, 'generation_worker_step', {
      p_generation_id: claim.generationId, p_claim_token: claim.claimToken,
      p_operation: operation, p_payload: payload,
    });
    if (stopped) throw new LeaseLost('generation_lease_lost');
    if (!data.accepted) throw new LeaseLost('generation_lease_lost');
  };
  const timer = setInterval(() => {
    if (renewal || stopped) return;
    renewal = step('renew').catch(() => {
      stopped = true; controller.abort();
    }).finally(() => { renewal = undefined; });
  }, 25_000);
  // Bounds downloads, provider work and uploads together, including hung SDK calls.
  const deadline = setTimeout(() => { stopped = true; controller.abort(); }, 9 * 60_000);
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw new LeaseLost('generation_deadline');
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new LeaseLost('generation_deadline'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation, cancelled]); }
    finally { controller.signal.removeEventListener('abort', abort); }
  };
  const retry = async (operation: () => Promise<void>) => {
    for (let attempt = 0; ; attempt++) {
      try { await bounded(operation()); return; }
      catch (error) {
        if (error instanceof LeaseLost || attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  };
  try {
    await bounded(step('renew'));
    let checkpoint = claim.checkpoint;
    if (claim.action !== 'recover') {
      let references: ProviderReference[];
      try {
        const available = await bounded(rpc<boolean>(admin, 'assert_chat_provider_available', { p_provider: claim.provider }));
        if (!available) throw new Error('provider_unavailable');
        if (dependencies.callProvider === callProvider) providerConfiguration(claim.provider, claim.model);
        if ((claim.params.referenceIds?.length ?? 0) !== claim.references.length) throw new Error('reference_count_mismatch');
        references = await bounded(downloadReferences(admin, claim.references));
      } catch (error) {
        if (error instanceof LeaseLost) throw error;
        const code = error instanceof Error && (error.message.startsWith('missing_env:')
          || error.message.includes('provider')) ? 'provider_unavailable' : 'reference_download_failed';
        await bounded(step(claim.readCount < 5 ? 'retry' : 'fail', { code, messageId: claim.messageId }));
        return { action: claim.readCount < 5 ? 'retry' : 'failed', code };
      }
      await bounded(step('submitted'));
      let result: ProviderImageResult;
      try { result = await bounded(dependencies.callProvider(claim, references, controller.signal)); }
      catch (error) {
        if (error instanceof LeaseLost) throw error;
        const known = error instanceof ImageProviderError && error.outcome === 'rejected';
        if (known && error.code === 'moderation') {
          await bounded(rpc(admin, 'record_image_safety_decision', {
            p_category: 'provider_content_policy', p_decision: 'block', p_generation_id: claim.generationId,
          }));
        }
        await bounded(step(known ? 'fail' : 'unknown', {
          code: known ? error.code : 'provider_reconciliation_required', messageId: claim.messageId,
          outcome: known ? 'rejected' : 'unknown',
        }));
        return { action: known ? 'failed' : 'reconcile', code: known ? error.code : 'provider_reconciliation_required' };
      }
      const bytes = base64ToBytes(result.bytesBase64);
      if (bytes.length === 0 || bytes.length > 30 * 1024 * 1024) {
        await bounded(step('unknown', { messageId: claim.messageId }));
        return { action: 'reconcile', code: 'provider_image_size_invalid' };
      }
      const extension = result.mimeType === 'image/jpeg' ? 'jpg' : result.mimeType.split('/')[1];
      checkpoint = { ...result, storagePath: `${claim.userId}/${claim.sessionId}/${claim.generationId}/${claim.claimToken}.${extension}` };
      await retry(() => step('checkpoint', { ...checkpoint }));
    }
    if (!checkpoint) throw new Error('missing_result_checkpoint');
    const saved = checkpoint;
    await retry(async () => {
      // Validate the token immediately before each upload. If deletion races
      // after this check, the durable path/tombstone sweep still compensates it.
      await step('renew');
      const { error } = await admin.storage.from('generated').upload(saved.storagePath, base64ToBytes(saved.bytesBase64), {
        cacheControl: '31536000', contentType: saved.mimeType, upsert: true,
      });
      if (error) throw new Error('result_storage_failed');
    });
    await retry(() => step('uploaded'));
    await retry(() => step('complete', { messageId: claim.messageId }));
    return { action: 'completed' };
  } catch (error) {
    if (error instanceof LeaseLost) return { action: 'deferred', code: 'generation_lease_lost' };
    // Never turn a checkpoint/Storage/completion transport failure into failed.
    // The visible queue message reclaims its durable checkpoint after lease expiry.
    return { action: 'deferred', code: 'generation_recovery_pending' };
  } finally {
    clearInterval(timer); clearTimeout(deadline);
    stopped = true; controller.abort();
  }
}
