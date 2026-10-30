import { retainCreditRequest, completeCreditRequest, rejectCreditRequest } from "./pending-credit-request";
import {
  creativeTextFieldLimits,
  creativeTextOptimizeRequestSchema,
  creativeTextOptimizeResponseSchema,
  type CreativeTextOptimizeRequest,
  creditQuoteSchema,
  type CreditItem,
  creditCatalogSchema,
  creditWalletSchema,
  creditLedgerSchema,
} from "@zimage/domain";
import { notifyCreditsChanged } from "./mock-credit-ledger";
import { HttpCommerceGateway } from "./http-commerce-gateway";
import { normalizeReferenceUploadFile } from './reference-upload-file';
import {
  WorkspaceError,
  apiErrorSchema,
  chatEventSchema,
  deleteSessionResponseSchema,
  generationAssetUrlResponseSchema,
  generationBatchResponseSchema,
  imageSubmissionResponseSchema,
  listSessionsResponseSchema,
  providerStatusResponseSchema,
  quotaSchema,
  referenceUploadResponseSchema,
  sessionResponseSchema,
  skillsResponseSchema,
  timelineResponseSchema,
  type ChatEvent,
  type ChatRequest,
  type ErrorCode,
  type GenerationBatch,
  type ImageRequest,
  type ProviderCapability,
  type ProviderHealth,
  type RecreateRequest,
  type WorkspaceGateway,
  type TimelineItem,
} from '@zimage/domain';
import type { ZodType } from "zod";

type Fetcher = typeof fetch;

let authRequiredNotificationSent = false;

export function resetAuthRequiredNotification() {
  authRequiredNotificationSent = false;
}

interface HttpWorkspaceGatewayOptions {
  fetcher?: Fetcher;
  assertActive?: () => void;
}

const errorCodes: Record<string, ErrorCode> = {
  asset_expired: "ASSET_EXPIRED",
  bad_request: "BAD_REQUEST",
  conflict: "CONFLICT",
  moderation: "MODERATION",
  network: "NETWORK",
  not_found: "NOT_FOUND",
  provider_error: "PROVIDER_ERROR",
  quota_exceeded: "QUOTA_EXCEEDED",
  insufficient_credits: "QUOTA_EXCEEDED",
  price_changed: "CONFLICT",
  service_not_ready: "NETWORK",
  billing_pending: "CONFLICT",
  session_deleting: "SESSION_DELETING",
  unauthorized: "UNAUTHORIZED",
};

function workspaceError(input: unknown, status: number) {
  if (status === 401 && typeof window !== 'undefined' && !authRequiredNotificationSent) {
    authRequiredNotificationSent = true;
    window.dispatchEvent(new Event('zimage:auth-required'));
  }
  const parsed = apiErrorSchema.safeParse(input);
  if (parsed.success) {
    return new WorkspaceError({
      code: errorCodes[parsed.data.code] ?? 'UNKNOWN',
      message: parsed.data.message,
      retryable: parsed.data.retryable,
    });
  }
  return new WorkspaceError({
    code: status === 401 ? 'UNAUTHORIZED' : status >= 500 ? 'NETWORK' : 'UNKNOWN',
    message: status >= 500 ? '服务暂时不可用，请稍后重试。' : '请求失败，请刷新后重试。',
    retryable: status >= 500,
  });
}

export class HttpWorkspaceGateway implements WorkspaceGateway {
  readonly commerce: HttpCommerceGateway;
  private readonly fetcher: Fetcher;
  private readonly submissions = new WeakMap<
    ImageRequest | RecreateRequest,
    {
      key: string;
      batchId?: string;
      body?: string;
      sessionId?: string;
      referenceIds: string[];
      pending?: Promise<GenerationBatch>;
    }
  >();
  private providerStatusPromise?: Promise<ReturnType<typeof providerStatusResponseSchema.parse>>;
  private readonly signedAssetUrls = new Map<string, ReturnType<typeof generationAssetUrlResponseSchema.parse>>();
  private readonly pendingSignedAssetUrls = new Map<string, Promise<ReturnType<typeof generationAssetUrlResponseSchema.parse>>>();
  private assetEpoch = 0;
  private readonly ownerScopes = new Set<AbortController>();
  private readonly assertActive: () => void;

  constructor(options: HttpWorkspaceGatewayOptions = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.assertActive = options.assertActive ?? (() => undefined);
    this.commerce = new HttpCommerceGateway((path, schema, init) =>
      this.json(path, schema, init), this.fetcher, this.assertActive,
    );
  }

  /** Fixed owner/mount context. Never retarget an old operation to new cookies.
   * Cancellation does not infer a billing outcome or create a replacement request.
   */
  createOwnerScope(isCurrent: () => boolean) {
    const controller = new AbortController();
    const assertActive = () => {
      this.assertActive();
      if (!isCurrent() || controller.signal.aborted) throw new DOMException('Workspace owner changed', 'AbortError');
    };
    const gateway = new HttpWorkspaceGateway({
      assertActive,
      fetcher: async (input, init) => {
        assertActive();
        this.ownerScopes.add(controller);
        const response = await this.fetcher(input, { ...init,
          signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal });
        assertActive();
        return response;
      },
    });
    return { gateway, isCurrent: () => !controller.signal.aborted && isCurrent(), dispose: () => {
      controller.abort();
      this.ownerScopes.delete(controller);
      gateway.clearAssetCaches();
    } };
  }

  async listSessions() {
    return (await this.json('/api/sessions', listSessionsResponseSchema)).sessions;
  }

  async createSession(title?: string, requestId?: string) {
    return (await this.json('/api/sessions', sessionResponseSchema, {
      body: JSON.stringify({ title, requestId }),
      method: 'POST',
    })).session;
  }

  async renameSession(sessionId: string, title: string) {
    return (
      await this.json(`/api/sessions/${sessionId}`, sessionResponseSchema, {
        body: JSON.stringify({ title }),
        method: "PATCH",
      })
    ).session;
  }

  async deleteSession(sessionId: string) {
    await this.json(`/api/sessions/${sessionId}`, deleteSessionResponseSchema, {
      method: "DELETE",
    });
  }

  async getTimeline(sessionId: string) {
    const items = new Map<string, TimelineItem>();
    let after: number | undefined;
    do {
      const response = await this.json(
        `/api/sessions/${sessionId}/timeline?limit=100${after === undefined ? '' : `&after=${after}`}`,
        timelineResponseSchema,
      );
      for (const item of response.items)
        items.set(item.id, item as TimelineItem);
      if (
        response.nextCursor !== undefined &&
        response.nextCursor <= (after ?? 0)
      ) {
        throw new WorkspaceError({
          code: "NETWORK",
          message: "历史分页暂时无法继续，请重试。",
          retryable: true,
        });
      }
      after = response.nextCursor;
    } while (after !== undefined);
    return [...items.values()].sort((a, b) => a.sequence - b.sequence);
  }

  async *streamChat(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent> {
    this.assertActive();
    const rawBody = JSON.stringify({
        billing: request.billing,
        requestId: request.requestId,
        taskId: request.taskId,
        taskRevision: request.taskRevision,
        targetGenerationId: request.targetGenerationId,
        proposal: request.proposal,
        imageSettings: request.imageSettings,
        chatModel: request.chatModel,
        imageProvider: request.imageProvider,
        images: request.images?.length ? request.images : undefined,
        message: request.message,
        sessionId: request.sessionId,
        skillId: request.skillId,
        tools: request.imageToolEnabled ? ["generate_image"] : undefined,
      });
    const pending=retainCreditRequest("/api/chat",rawBody);
    const response = await this.fetcher("/api/chat", {body:pending?.body??rawBody,headers:{"content-type":"application/json"},method:"POST",signal});
    if (!response.ok || !response.body) {const body=await this.readBody(response);this.assertActive();rejectCreditRequest(pending,body);if(pending)notifyCreditsChanged();throw workspaceError(body,response.status);}

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        this.assertActive();
        buffer += decoder.decode(value, { stream: !done });
        // Normalize complete CRLF pairs, including pairs split across chunks.
        buffer = buffer.replaceAll("\r\n", "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        if (done && buffer.trim()) {
          frames.push(buffer);
          buffer = "";
        }
        for (const frame of frames) {
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const event = chatEventSchema.safeParse(JSON.parse(data) as unknown);
          if (event.success) {
            terminal ||= event.data.type === 'message.completed' || event.data.type === 'stream.failed';
            if(event.data.type==="message.completed")completeCreditRequest(pending);
            if(terminal)notifyCreditsChanged();
            yield event.data as ChatEvent;
            if (terminal) {
              notifyCreditsChanged();
              return;
            }
          }
        }
        if (done) break;
      }
    } catch (error) {
      this.assertActive();
      if (signal?.aborted) throw error;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!terminal && !signal?.aborted)
      yield {
        type: "stream.failed",
        error: {
          code: "STREAM_INTERRUPTED",
          message: "回复中断，已收到的内容暂时保留，可重新发送。",
          retryable: true,
        },
      };
  }

  private submission(request: ImageRequest | RecreateRequest) {
    let state = this.submissions.get(request);
    if (!state) {
      state = {
        key: request.requestId ?? crypto.randomUUID(),
        referenceIds: [],
      };
      this.submissions.set(request, state);
    }
    return state;
  }

  async submitImage(request: ImageRequest): Promise<GenerationBatch> {
    const state = this.submission(request);
    if (state.pending) return state.pending;
    const run = async () => {
      if (state.batchId) return this.getGenerationBatch(state.batchId);
      if (!state.body) {
        state.sessionId ??= request.sessionId;
        if (!state.sessionId && request.references?.length) state.sessionId = (await this.createSession()).id;
        for (const reference of (request.references ?? []).slice(
          state.referenceIds.length,
        )) {
          if (reference.id) {
            state.referenceIds.push(reference.id);
            continue;
          }
          if (!reference.file || !state.sessionId)
            throw new WorkspaceError({
              code: "BAD_REQUEST",
              message: "参考图缺少可上传文件，请重新选择。",
              retryable: false,
            });
          const form = new FormData();
          form.set("file", await normalizeReferenceUploadFile(reference.file));
          form.set("sessionId", state.sessionId);
          const uploaded = await this.json(
            "/api/uploads",
            referenceUploadResponseSchema,
            { body: form, method: "POST" },
          );
          state.referenceIds.push(uploaded.id);
        }
        state.body = JSON.stringify({
          billing: request.billing,
          model: request.model,
          params: {
            aspectRatio: request.aspectRatio,
            count: request.count,
            referenceIds: state.referenceIds.length
              ? state.referenceIds
              : undefined,
            resolution: request.resolution,
          },
          prompt: request.prompt,
          provider: request.provider,
          sessionId: state.sessionId,
          skillId: request.skillId,
        });
      }
      const submitted = await this.json(
        "/api/image",
        imageSubmissionResponseSchema,
        {
        body: state.body, headers: { 'idempotency-key': state.key }, method: 'POST',
      },
      );
      state.batchId = submitted.batchId;
      notifyCreditsChanged();
      return this.getGenerationBatch(state.batchId);
    };
    state.pending = run();
    try {
      return await state.pending;
    } finally {
      state.pending = undefined;
    }
  }

  async getGenerationBatch(batchId: string) {
    const response = await this.json(
      `/api/image/${batchId}`,
      generationBatchResponseSchema,
    );
    return response.batch;
  }

  async recreateGeneration(request: RecreateRequest): Promise<GenerationBatch> {
    const state = this.submission(request);
    if (state.pending) return state.pending;
    const run = async () => {
      if (!state.batchId) {
        state.body ??= JSON.stringify({
          billing: request.billing,
          batchId: request.batchId,
          generationId: request.generationId,
          mode: request.scope,
        });
        const submitted = await this.json(
          "/api/image/recreate",
          imageSubmissionResponseSchema,
          {
        body: state.body, headers: { 'idempotency-key': state.key }, method: 'POST',
      },
        );
        state.batchId = submitted.batchId;
        notifyCreditsChanged();
      }
      return this.getGenerationBatch(state.batchId);
    };
    state.pending = run();
    try {
      return await state.pending;
    } finally {
      state.pending = undefined;
    }
  }

  async optimizeText(value: CreativeTextOptimizeRequest, signal?: AbortSignal) {
    this.assertActive();
    signal?.throwIfAborted();
    const input = creativeTextOptimizeRequestSchema.parse({ ...value, context: value.context?.slice(0, 2000) });
    const pending = retainCreditRequest('/api/creative-text/optimize', JSON.stringify(input));
    const response = await this.fetcher('/api/creative-text/optimize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: pending?.body ?? JSON.stringify(input), signal,
    });
    this.assertActive();
    signal?.throwIfAborted();
    notifyCreditsChanged();
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.assertActive();
      signal?.throwIfAborted();
      rejectCreditRequest(pending, error);
      throw Object.assign(new Error(error?.message ?? '优化失败，请稍后重试。'), {
        userMessage: true, newRequest: ['provider_error', 'price_changed', 'insufficient_credits', 'quota_exceeded', 'bad_request'].includes(error?.code),
      });
    }
    const body = await response.json();
    this.assertActive();
    signal?.throwIfAborted();
    const result = creativeTextOptimizeResponseSchema.parse(body);
    if (result.text.length > Math.min(input.maxLength ?? 6000, creativeTextFieldLimits[input.field])) throw new Error('optimized_text_too_long');
    completeCreditRequest(pending);
    return result;
  }

  async getCreditQuote(items: CreditItem[]) {
    return this.json("/api/credits/quote", creditQuoteSchema, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  }
  async getCreditCatalog() {
    return this.json("/api/credits/pricing", creditCatalogSchema);
  }
  async getCreditWallet() {
    return this.json("/api/credits", creditWalletSchema);
  }
  async getCreditLedger(cursor?: string) {
    return this.json(
      "/api/credits/ledger" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      creditLedgerSchema,
    );
  }
  async getSkills() {
    return (await this.json('/api/skills', skillsResponseSchema)).skills;
  }

  async getQuota() {
    return this.json("/api/quotas", quotaSchema);
  }

  async getProviderCapabilities(): Promise<ProviderCapability[]> {
    return (await this.getProviderStatus()).capabilities;
  }

  async getProviderHealth(): Promise<ProviderHealth[]> {
    return (await this.getProviderStatus()).health;
  }

  clearAssetCaches() {
    for (const controller of this.ownerScopes) controller.abort();
    this.ownerScopes.clear();
    this.assetEpoch++;
    this.signedAssetUrls.clear();
    this.pendingSignedAssetUrls.clear();
    this.commerce.clearAssetCache();
  }

  async getGenerationAssetUrl(generationId: string, refresh = false) {
    if (!refresh) {
      const cached = this.signedAssetUrls.get(generationId);
      if (cached && Date.parse(cached.expiresAt) - Date.now() > 30_000) return cached.url;
    }
    let pending = this.pendingSignedAssetUrls.get(generationId);
    if (!pending) {
      const epoch = this.assetEpoch;
      pending = this.json(`/api/generations/${generationId}/asset-url`, generationAssetUrlResponseSchema)
        .then(signed => {
          if (epoch !== this.assetEpoch) throw new Error('Asset owner changed');
          this.signedAssetUrls.set(generationId, signed);
          if (this.signedAssetUrls.size > 512)
            this.signedAssetUrls.delete(this.signedAssetUrls.keys().next().value!);
          return signed;
        })
        .finally(() => { if (this.pendingSignedAssetUrls.get(generationId) === pending) this.pendingSignedAssetUrls.delete(generationId); });
      this.pendingSignedAssetUrls.set(generationId, pending);
    }
    try { return (await pending).url; }
    catch (error) {
      if (error instanceof WorkspaceError && error.safe.code === 'ASSET_EXPIRED') return undefined;
      throw error;
    }
  }

  private getProviderStatus() {
    this.providerStatusPromise ??= this.json(
      "/api/health/providers",
      providerStatusResponseSchema,
    ).catch((error: unknown) => {
        this.providerStatusPromise = undefined;
        throw error;
      });
    return this.providerStatusPromise;
  }

  private async json<T>(
    path: string,
    schema: ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    this.assertActive();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (typeof init.body === 'string') headers.set('content-type', 'application/json');
    const pending=typeof init.body==="string" ? retainCreditRequest(path,init.body,headers.get("idempotency-key")??undefined) : undefined;
    if(pending && headers.has("idempotency-key"))headers.set("idempotency-key",pending.requestId);
    const response = await this.fetcher(path, {
      ...init,
      body:pending?.body??init.body,
      headers,
      method: init.method ?? "GET",
    });
    const body = await this.readBody(response);
    this.assertActive();
    if (!response.ok) {rejectCreditRequest(pending,body);if(pending)notifyCreditsChanged();throw workspaceError(body, response.status);}
    const parsed=schema.parse(body);completeCreditRequest(pending);return parsed;
  }

  private async readBody(response: Response) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) return response.json();
    return response.text();
  }
}
