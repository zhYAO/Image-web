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
} from '@zimage/domain';
import type { ZodType } from 'zod';

type Fetcher = typeof fetch;

interface HttpWorkspaceGatewayOptions {
  fetcher?: Fetcher;
}

const errorCodes: Record<string, ErrorCode> = {
  asset_expired: 'ASSET_EXPIRED',
  bad_request: 'BAD_REQUEST',
  conflict: 'CONFLICT',
  moderation: 'MODERATION',
  network: 'NETWORK',
  not_found: 'NOT_FOUND',
  provider_error: 'PROVIDER_ERROR',
  quota_exceeded: 'QUOTA_EXCEEDED',
  session_deleting: 'SESSION_DELETING',
  unauthorized: 'UNAUTHORIZED',
};

function workspaceError(input: unknown, status: number) {
  const parsed = apiErrorSchema.safeParse(input);
  if (parsed.success) {
    return new WorkspaceError({
      code: errorCodes[parsed.data.code] ?? 'UNKNOWN',
      message: parsed.data.message,
      retryable: parsed.data.retryable,
    });
  }
  return new WorkspaceError({
    code: status >= 500 ? 'NETWORK' : 'UNKNOWN',
    message: status >= 500 ? '服务暂时不可用，请稍后重试。' : '请求失败，请刷新后重试。',
    retryable: status >= 500,
  });
}

export class HttpWorkspaceGateway implements WorkspaceGateway {
  private readonly fetcher: Fetcher;
  private providerStatusPromise?: Promise<ReturnType<typeof providerStatusResponseSchema.parse>>;

  constructor(options: HttpWorkspaceGatewayOptions = {}) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  async listSessions() {
    return (await this.json('/api/sessions', listSessionsResponseSchema)).sessions;
  }

  async createSession(title?: string) {
    return (await this.json('/api/sessions', sessionResponseSchema, {
      body: JSON.stringify({ title }),
      method: 'POST',
    })).session;
  }

  async renameSession(sessionId: string, title: string) {
    return (await this.json(`/api/sessions/${sessionId}`, sessionResponseSchema, {
      body: JSON.stringify({ title }),
      method: 'PATCH',
    })).session;
  }

  async deleteSession(sessionId: string) {
    await this.json(`/api/sessions/${sessionId}`, deleteSessionResponseSchema, { method: 'DELETE' });
  }

  async getTimeline(sessionId: string) {
    const response = await this.json(`/api/sessions/${sessionId}/timeline?limit=100`, timelineResponseSchema);
    return Promise.all(response.items.map(async (item) => (
      item.type === 'generation' ? { ...item, batch: await this.hydrateBatch(item.batch) } : item
    )));
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    const response = await this.fetcher('/api/chat', {
      body: JSON.stringify({
        chatModel: request.chatModel,
        imageProvider: request.imageProvider,
        images: request.images?.length ? request.images : undefined,
        message: request.message,
        sessionId: request.sessionId,
        skillId: request.skillId,
        tools: request.imageToolEnabled ? ['generate_image'] : undefined,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal,
    });
    if (!response.ok || !response.body) throw workspaceError(await this.readBody(response), response.status);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
        if (!data) continue;
        const event = chatEventSchema.safeParse(JSON.parse(data) as unknown);
        if (event.success) yield event.data as ChatEvent;
      }
      if (done) break;
    }
  }

  async submitImage(request: ImageRequest) {
    let sessionId = request.sessionId;
    if (!sessionId && request.references?.length) sessionId = (await this.createSession()).id;
    const referenceIds: string[] = [];
    for (const reference of request.references ?? []) {
      if (reference.id) {
        referenceIds.push(reference.id);
        continue;
      }
      if (!reference.file || !sessionId) {
        throw new WorkspaceError({
          code: 'BAD_REQUEST',
          message: '参考图缺少可上传文件，请重新选择。',
          retryable: false,
        });
      }
      const form = new FormData();
      form.set('file', reference.file);
      form.set('sessionId', sessionId);
      const uploaded = await this.json('/api/uploads', referenceUploadResponseSchema, {
        body: form,
        method: 'POST',
      });
      referenceIds.push(uploaded.id);
    }

    const submitted = await this.json('/api/image', imageSubmissionResponseSchema, {
      body: JSON.stringify({
        model: request.model,
        params: {
          aspectRatio: request.aspectRatio,
          count: request.count,
          referenceIds: referenceIds.length ? referenceIds : undefined,
          resolution: request.resolution,
        },
        prompt: request.prompt,
        provider: request.provider,
        sessionId,
        skillId: request.skillId,
      }),
      headers: { 'idempotency-key': crypto.randomUUID() },
      method: 'POST',
    });
    return this.getGenerationBatch(submitted.batchId);
  }

  async getGenerationBatch(batchId: string) {
    const response = await this.json(`/api/image/${batchId}`, generationBatchResponseSchema);
    return this.hydrateBatch(response.batch);
  }

  async recreateGeneration(request: RecreateRequest) {
    const submitted = await this.json('/api/image/recreate', imageSubmissionResponseSchema, {
      body: JSON.stringify({
        batchId: request.batchId,
        generationId: request.generationId,
        mode: request.scope,
      }),
      headers: { 'idempotency-key': crypto.randomUUID() },
      method: 'POST',
    });
    return this.getGenerationBatch(submitted.batchId);
  }

  async getSkills() {
    return (await this.json('/api/skills', skillsResponseSchema)).skills;
  }

  async getQuota() {
    return this.json('/api/quotas', quotaSchema);
  }

  async getProviderCapabilities(): Promise<ProviderCapability[]> {
    return (await this.getProviderStatus()).capabilities;
  }

  async getProviderHealth(): Promise<ProviderHealth[]> {
    return (await this.getProviderStatus()).health;
  }

  private async hydrateBatch(batch: GenerationBatch) {
    const assets = await Promise.all(batch.assets.map(async (asset) => {
      if (asset.status !== 'succeeded' || asset.expired) return asset;
      try {
        const signed = await this.json(`/api/generations/${asset.id}/asset-url`, generationAssetUrlResponseSchema);
        return { ...asset, expiresAt: signed.expiresAt, url: signed.url };
      } catch (error: unknown) {
        if (error instanceof WorkspaceError && error.safe.code === 'ASSET_EXPIRED') {
          return { ...asset, expired: true, url: undefined };
        }
        return asset;
      }
    }));
    return { ...batch, assets };
  }

  private getProviderStatus() {
    this.providerStatusPromise ??= this.json('/api/health/providers', providerStatusResponseSchema)
      .catch((error: unknown) => {
        this.providerStatusPromise = undefined;
        throw error;
      });
    return this.providerStatusPromise;
  }

  private async json<T>(path: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (typeof init.body === 'string') headers.set('content-type', 'application/json');
    const response = await this.fetcher(path, { ...init, headers, method: init.method ?? 'GET' });
    const body = await this.readBody(response);
    if (!response.ok) throw workspaceError(body, response.status);
    return schema.parse(body);
  }

  private async readBody(response: Response) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) return response.json();
    return response.text();
  }
}
