import { MockCommerceGateway } from './mock-commerce-gateway';
import {
  CHAT_PROVIDER_MODELS,
  IMAGE_PROVIDER_CAPABILITIES as CAPABILITIES,
  PHASE1_SKILLS as SKILLS,
  WorkspaceError,
  aggregateBatchStatus,
  hasExplicitImageIntent,
  nextTimelineSequence,
  sanitizeError,
  validateImageRequest,
  type ChatEvent,
  type ChatRequest,
  type GenerationAsset,
  type GenerationBatch,
  type ImageRequest,
  type MockScenario,
  type ProviderCapability,
  type ProviderHealth,
  type Quota,
  type RecreateRequest,
  type Session,
  type Skill,
  type TimelineItem,
  type WorkspaceGateway,
} from '@zimage/domain';

export const MOCK_STORAGE_KEY = 'zimage:mock:v1';
const STORAGE_VERSION = 2;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface MockState {
  // Commerce and host data share one atomic localStorage value.
  commerce?: string;
  sessions: Session[];
  timelines: Record<string, TimelineItem[]>;
  batches: Record<string, GenerationBatch>;
  quotaUsage?: Record<string, number>;
  deleteAttempts: Record<string, number>;
}
interface StorageEnvelope {
  version: number;
  state: MockState;
}

type TimelineItemWithoutSequence = TimelineItem extends infer Item
  ? Item extends TimelineItem
    ? Omit<Item, 'sequence'>
    : never
  : never;

interface MockGatewayOptions {
  storage?: StorageLike;
  now?: () => Date;
  delay?: (milliseconds: number) => Promise<void>;
}

class VolatileStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MockWorkspaceGateway implements WorkspaceGateway {
  readonly commerce: MockCommerceGateway;
  private suppressPersistence = false;
  private transactionDirty = false;
  private stagedTransitions: Array<{ batchId: string; scenario: MockScenario }> = [];
  private mutationTail: Promise<unknown> = Promise.resolve();
  private readonly internalImageRequests = new WeakSet<ImageRequest>();
  private readonly storage: StorageLike;
  private readonly now: () => Date;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private state: MockState;
  private recoveryNotice?: string;
  private idCounter = 0;
  private scenario: MockScenario = 'happy';

  constructor(options: MockGatewayOptions = {}) {
    this.storage = options.storage ??
      (typeof window === 'undefined' ? new VolatileStorage() : window.localStorage);
    this.now = options.now ?? (() => new Date());
    this.delay = options.delay ?? wait;
    this.state = this.load();
    // Import the old separate key once; all subsequent writes use the host envelope.
    this.state.commerce ??= this.storage.getItem('zimage:commerce:mock:v1') ?? '';
    this.commerce = new MockCommerceGateway({
      getItem: () => this.state.commerce || null,
      setItem: (_key, value) => { this.state.commerce = value; this.persist(); },
    }, {
      runCommerceTransaction: (work) => this.runCommerceTransaction(work),
      listSessions: () => this.listSessions(),
      getGenerationBatch: (id) => this.getGenerationBatch(id),
      submitCommerceImages: (requests) => this.submitCommerceImagesNow(requests),
      cancelCommerceImages: (ids) => this.cancelCommerceImagesNow(ids),
    });
  }

  getRecoveryNotice() {
    return this.recoveryNotice;
  }

  setScenario(scenario: MockScenario) {
    this.scenario = scenario;
  }

  async listSessions() {
    return clone(
      this.state.sessions
        .filter((session) => session.status === 'active')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  async createSession(title = '新的创作') {
    return this.serializeMutation(() => this.createSessionNow(title));
  }

  private createSessionNow(title: string) {
    const timestamp = this.timestamp();
    const session: Session = {
      createdAt: timestamp,
      id: this.id('session'),
      status: 'active',
      title,
      updatedAt: timestamp,
    };
    this.state.sessions.push(session);
    this.state.timelines[session.id] = [];
    this.persist();
    return clone(session);
  }

  async renameSession(sessionId: string, title: string) {
    return this.serializeMutation(() => this.renameSessionNow(sessionId, title));
  }

  private renameSessionNow(sessionId: string, title: string) {
    const session = this.requireSession(sessionId);
    // Centralize title normalization (trim, collapse whitespace, cap length,
    // fall back to the placeholder) inside the gateway so the UI can pass
    // either a user-typed name or a raw prompt and get a consistent title.
    session.title = this.titleFrom(title);
    session.updatedAt = this.timestamp();
    this.persist();
    return clone(session);
  }

  async deleteSession(sessionId: string) {
    return this.serializeMutation(() => this.deleteSessionNow(sessionId));
  }

  private deleteSessionNow(sessionId: string) {
    const session = this.requireSession(sessionId, true);
    session.status = 'deleting';
    const attempt = (this.state.deleteAttempts[sessionId] ?? 0) + 1;
    this.state.deleteAttempts[sessionId] = attempt;
    this.persist();

    if ((this.scenario === 'delete-retry' || session.title.includes('delete-retry')) && attempt === 1) {
      throw new WorkspaceError({
        code: 'DELETE_RETRY_REQUIRED',
        message: '会话已从列表隐藏，但后台清理失败，请重试。',
        retryable: true,
      });
    }

    const batchIds = Object.values(this.state.batches)
      .filter((batch) => batch.sessionId === sessionId)
      .map((batch) => batch.id);
    for (const batchId of batchIds) delete this.state.batches[batchId];
    delete this.state.timelines[sessionId];
    delete this.state.deleteAttempts[sessionId];
    this.state.sessions = this.state.sessions.filter((item) => item.id !== sessionId);
    this.persist();
  }

  async getTimeline(sessionId: string) {
    this.requireSession(sessionId);
    return clone((this.state.timelines[sessionId] ?? []).sort((a, b) => a.sequence - b.sequence));
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    let session: Session;
    if (request.sessionId) {
      session = this.requireSession(request.sessionId);
    } else {
      session = await this.createSession(this.titleFrom(request.message));
      yield { session: clone(session), type: 'session.created' };
    }

    await this.serializeMutation(() => this.appendTimeline(session.id, {
      content: request.message.trim(),
      createdAt: this.timestamp(),
      id: this.id('message'),
      role: 'user',
      sessionId: session.id,
      type: 'message',
    }));

    if (request.scenario === 'provider-unavailable') {
      const error = {
        code: 'PROVIDER_UNAVAILABLE' as const,
        message: '聊天服务暂时不可用，请稍后重试。',
        retryable: true,
      };
      await this.serializeMutation(() => this.appendTimeline(session.id, {
        actionLabel: '重试',
        createdAt: this.timestamp(),
        error,
        id: this.id('error'),
        sessionId: session.id,
        type: 'error',
      }));
      yield { error, type: 'stream.failed' };
      return;
    }

    const shouldGenerateImage = request.imageToolEnabled &&
      !request.skillId && hasExplicitImageIntent(request.message);
    const answer = shouldGenerateImage
      ? '已理解你的创作目标，我先整理提示词，然后把生图任务加入队列。'
      : '可以。建议突出主体材质、光线、构图和使用场景，让画面目标更明确。';
    const deltas = this.splitIntoThree(answer);
    const messageId = this.id('message');
    for (const delta of deltas) {
      await this.delay(180);
      if (signal?.aborted) {
        yield {
          error: { code: 'STREAM_INTERRUPTED', message: '回答已停止。', retryable: true },
          type: 'stream.failed',
        };
        return;
      }
      yield { delta, messageId, type: 'message.delta' };
    }

    await this.serializeMutation(() => this.appendTimeline(session.id, {
      content: answer,
      createdAt: this.timestamp(),
      id: messageId,
      role: 'assistant',
      sessionId: session.id,
      streaming: false,
      type: 'message',
    }));
    yield { content: answer, messageId, type: 'message.completed' };

    if (shouldGenerateImage) {
      const batch = await this.submitImage({
        aspectRatio: '1:1',
        count: 2,
        prompt: request.message,
        resolution: '1K',
        scenario: request.scenario,
        sessionId: session.id,
        skillId: request.skillId,
        skillValues: request.skillValues,
      });
      await this.serializeMutation(() => {
        const stored = this.state.batches[batch.id];
        if (stored) stored.source = 'chat_tool';
        this.persist();
      });
      yield { batchId: batch.id, type: 'tool.queued' };
    }
  }

  async cancelCommerceImages(batchIds: string[]): Promise<void> {
    return this.serializeMutation(() => this.cancelCommerceImagesNow(batchIds));
  }

  private async cancelCommerceImagesNow(batchIds: string[]): Promise<void> {
    for (const id of batchIds) {
      const batch = this.state.batches[id];
      if (!batch || batch.status !== 'pending') continue;
      for (const asset of batch.assets) { asset.status = 'failed'; asset.error = {code:'UNKNOWN',message:'已取消尚未派发的图片',retryable:false}; }
      batch.status = 'failed';
      const day = batch.createdAt.slice(0,10);
      if (this.state.quotaUsage) this.state.quotaUsage[day] = Math.max(0, (this.state.quotaUsage[day] ?? 0) - batch.assets.length);
      this.syncBatchTimeline(batch);
    }
    this.persist();
  }

  // External writes share commerce's lock; nested children use explicit internal paths.
  private serializeMutation<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.mutationTail.then(work, work);
    this.mutationTail = result.catch(() => undefined);
    return result;
  }

  async runCommerceTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.serializeMutation(() => this.commerceTransaction(work));
  }

  private async commerceTransaction<T>(work: () => Promise<T>): Promise<T> {
    const before = clone(this.state);
    this.suppressPersistence = true;
    this.transactionDirty = false;
    this.stagedTransitions = [];
    try {
      const result = await work();
      this.suppressPersistence = false;
      if (this.transactionDirty) this.persist();
      // A failed commit must never start generation timers.
      for (const { batchId, scenario } of this.stagedTransitions) void this.transitionBatch(batchId, scenario);
      return result;
    } catch (error) {
      this.state = before;
      throw error;
    } finally {
      this.suppressPersistence = false;
      this.stagedTransitions = [];
    }
  }

  async submitCommerceImages(requests: ImageRequest[]): Promise<GenerationBatch[]> {
    return this.runCommerceTransaction(() => this.submitCommerceImagesNow(requests));
  }

  private async submitCommerceImagesNow(requests: ImageRequest[]): Promise<GenerationBatch[]> {
    for (const request of requests) {
      const valid = validateImageRequest(request);
      if (!valid.ok) throw new WorkspaceError(valid.error);
      if (!request.sessionId) throw new WorkspaceError({ code: 'BAD_REQUEST', message: '缺少会话。', retryable: false });
      this.requireSession(request.sessionId);
    }
    const quota = await this.getQuota();
    if (quota.used + requests.length > quota.limit) throw new WorkspaceError({code:'QUOTA_EXCEEDED',message:'今日图片额度不足。',retryable:false});
    const batches: GenerationBatch[] = [];
    for (const [index, request] of requests.entries()) batches.push(await this.submitImageChild({ ...request, scenario: this.scenario === 'partial' ? (index === requests.length - 1 ? 'provider-unavailable' : 'happy') : this.scenario }));
    return batches;
  }

  private async submitImageChild(request: ImageRequest): Promise<GenerationBatch> {
    // Preserve subclass/fault-injection hooks that forward the same request to super.
    this.internalImageRequests.add(request);
    try { return await this.submitImage(request); }
    finally { this.internalImageRequests.delete(request); }
  }

  async submitImage(request: ImageRequest): Promise<GenerationBatch> {
    if (this.internalImageRequests.has(request)) return this.submitImageNow(request);
    return this.serializeMutation(() => this.submitImageNow(request));
  }

  private async submitImageNow(request: ImageRequest): Promise<GenerationBatch> {
    const validation = validateImageRequest(request);
    if (!validation.ok) throw new WorkspaceError(validation.error);
    const session = request.sessionId
      ? this.requireSession(request.sessionId)
      : this.createSessionNow(this.titleFrom(request.prompt));
    const createdAt = this.timestamp();
    const batchId = this.id('batch');
    const defaultCapability = CAPABILITIES[0];
    const provider = request.provider ?? defaultCapability?.provider ?? 'unknown';
    const model = request.model ?? defaultCapability?.models[0]?.id ?? 'unknown';
    const assets: GenerationAsset[] = Array.from({ length: request.count }, () => ({
      id: this.id('generation'),
      status: 'pending',
    }));
    const batch: GenerationBatch = {
      assets,
      config: {
        aspectRatio: request.aspectRatio,
        count: request.count,
        resolution: request.resolution,
      },
      createdAt,
      id: batchId,
      model,
      prompt: request.prompt.trim(),
      provider,
      sessionId: session.id,
      source: 'direct',
      status: 'pending',
    };
    this.state.batches[batchId] = batch;
    const day = createdAt.slice(0, 10);
    this.state.quotaUsage ??= {};
    this.state.quotaUsage[day] = (this.state.quotaUsage[day] ?? 0) + request.count;
    this.appendTimeline(session.id, {
      batch,
      createdAt,
      id: this.id('timeline'),
      sessionId: session.id,
      type: 'generation',
    });
    this.persist();
    if (this.suppressPersistence) this.stagedTransitions.push({ batchId, scenario: request.scenario ?? 'happy' });
    else void this.transitionBatch(batchId, request.scenario ?? 'happy');
    return clone(batch);
  }

  async getGenerationBatch(batchId: string) {
    const batch = this.state.batches[batchId];
    if (!batch) {
      throw new WorkspaceError({
        code: 'BATCH_NOT_FOUND',
        message: '未找到生成批次。',
        retryable: false,
      });
    }
    return clone(batch);
  }

  async recreateGeneration(request: RecreateRequest): Promise<GenerationBatch> {
    return this.serializeMutation(() => this.recreateGenerationNow(request));
  }

  private async recreateGenerationNow(request: RecreateRequest): Promise<GenerationBatch> {
    const original = await this.getGenerationBatch(request.batchId);
    let assets = original.assets;
    if (request.scope === 'failed') assets = assets.filter((asset) => asset.status === 'failed');
    if (request.scope === 'single') assets = assets.filter((asset) => asset.id === request.generationId);
    if (assets.length === 0) {
      throw new WorkspaceError({ code: 'BATCH_NOT_FOUND', message: '没有可重生成的图片。', retryable: false });
    }
    return this.submitImageChild({
      aspectRatio: original.config.aspectRatio,
      count: assets.length,
      model: original.model,
      prompt: original.prompt,
      provider: original.provider,
      resolution: original.config.resolution,
      sessionId: original.sessionId,
    });
  }

  async getSkills(): Promise<Skill[]> {
    return clone(SKILLS);
  }

  async getQuota(): Promise<Quota> {
    return { limit: 30, resetsAt: new Date(new Date().setUTCHours(24,0,0,0)).toISOString(), used: this.state.quotaUsage?.[this.timestamp().slice(0,10)] ?? 0 };
  }

  async getProviderCapabilities(): Promise<ProviderCapability[]> {
    return clone(CAPABILITIES);
  }

  async getProviderHealth(): Promise<ProviderHealth[]> {
    return [...CAPABILITIES.map((capability) => capability.provider), ...CHAT_PROVIDER_MODELS.map((model) => model.provider)]
      .map((provider) => ({ checkedAt: this.timestamp(), provider, status: 'healthy' }));
  }

  private async transitionBatch(batchId: string, scenario: MockScenario) {
    await this.delay(900);
    const started = await this.serializeMutation(() => {
      const batch = this.state.batches[batchId];
      if (!batch || batch.status === 'failed') return false;
      for (const asset of batch.assets) asset.status = 'processing';
      batch.status = 'processing';
      this.syncBatchTimeline(batch);
      this.persist();
      return true;
    });
    if (!started) return;

    await this.delay(700);
    await this.serializeMutation(() => {
      const current = this.state.batches[batchId];
      if (!current) return;
      current.assets.forEach((asset, index) => {
        const shouldFail = scenario === 'provider-unavailable' || (scenario === 'partial' && index === current.assets.length - 1);
        if (shouldFail) {
          asset.status = 'failed';
          asset.error = {
            code: scenario === 'provider-unavailable' ? 'PROVIDER_UNAVAILABLE' : 'UNKNOWN',
            message: scenario === 'provider-unavailable' ? '图片服务暂时不可用。' : '这张图片生成失败，可单独重试。',
            retryable: true,
          };
        } else {
          asset.status = 'succeeded';
          asset.url = this.imageDataUrl(index, current.prompt);
          asset.expired = scenario === 'expired';
          asset.expiresAt = scenario === 'expired' ? '2026-08-20T00:00:00.000Z' : '2026-11-19T00:00:00.000Z';
        }
      });
      current.status = aggregateBatchStatus(current.assets.map((asset) => asset.status));
      this.syncBatchTimeline(current);
      this.persist();
    });
  }

  private appendTimeline(sessionId: string, item: TimelineItemWithoutSequence) {
    const timeline = this.state.timelines[sessionId] ?? [];
    const complete = { ...item, sequence: nextTimelineSequence(timeline) } as TimelineItem;
    timeline.push(complete);
    this.state.timelines[sessionId] = timeline;
    const session = this.requireSession(sessionId, true);
    session.updatedAt = this.timestamp();
    this.persist();
  }

  private syncBatchTimeline(batch: GenerationBatch) {
    const timeline = this.state.timelines[batch.sessionId] ?? [];
    const item = timeline.find(
      (candidate) => candidate.type === 'generation' && candidate.batch.id === batch.id,
    );
    if (item?.type === 'generation') item.batch = clone(batch);
  }

  private load(): MockState {
    const raw = this.storage.getItem(MOCK_STORAGE_KEY);
    if (!raw) {
      const fixture = this.createFixture();
      this.storage.setItem(MOCK_STORAGE_KEY, JSON.stringify({ state: fixture, version: STORAGE_VERSION }));
      return fixture;
    }
    try {
      const envelope = JSON.parse(raw) as Partial<StorageEnvelope>;
      if (envelope.version !== STORAGE_VERSION || !envelope.state) throw new Error('version mismatch');
      return envelope.state;
    } catch (error: unknown) {
      const backupKey = `${MOCK_STORAGE_KEY}:backup:${this.timestamp()}`;
      this.storage.setItem(backupKey, raw);
      this.recoveryNotice = '本地演示数据无法读取，已备份旧值并已恢复初始数据。你可以继续创作。';
      const fixture = this.createFixture();
      this.storage.setItem(MOCK_STORAGE_KEY, JSON.stringify({ state: fixture, version: STORAGE_VERSION }));
      void sanitizeError(error);
      return fixture;
    }
  }

  private createFixture(): MockState {
    const timestamp = this.timestamp();
    const session: Session = {
      createdAt: timestamp,
      id: 'session-welcome',
      status: 'active',
      title: '欢迎使用 ZImage',
      updatedAt: timestamp,
    };
    return { batches: {}, deleteAttempts: {}, sessions: [session], timelines: { [session.id]: [] } };
  }

  private persist() {
    if (this.suppressPersistence) { this.transactionDirty = true; return; }
    this.storage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({ state: this.state, version: STORAGE_VERSION } satisfies StorageEnvelope),
    );
  }

  private requireSession(sessionId: string, includeDeleting = false) {
    const session = this.state.sessions.find(
      (candidate) => candidate.id === sessionId && (includeDeleting || candidate.status === 'active'),
    );
    if (!session) {
      throw new WorkspaceError({
        code: 'SESSION_NOT_FOUND',
        message: '会话不存在或已删除。',
        retryable: false,
      });
    }
    return session;
  }

  private timestamp() {
    return this.now().toISOString();
  }

  private id(prefix: string) {
    this.idCounter += 1;
    void prefix;
    return crypto.randomUUID();
  }

  private titleFrom(value: string) {
    const title = value.trim().replaceAll(/\s+/g, ' ');
    return title.length > 20 ? `${title.slice(0, 20)}…` : title || '新的创作';
  }

  private splitIntoThree(value: string): [string, string, string] {
    const first = Math.ceil(value.length / 3);
    const second = Math.ceil((value.length * 2) / 3);
    return [value.slice(0, first), value.slice(first, second), value.slice(second)];
  }

  private imageDataUrl(index: number, prompt: string) {
    const colors = [
      ['#eef2ff', '#6366f1'],
      ['#fff7ed', '#f97316'],
      ['#ecfeff', '#0891b2'],
      ['#f5f3ff', '#8b5cf6'],
    ];
    const [background = '#eef2ff', foreground = '#6366f1'] = colors[index % colors.length] ?? [];
    const safePrompt = prompt.replaceAll(/[<>&]/g, '').slice(0, 18);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><rect width="720" height="720" rx="48" fill="${background}"/><circle cx="360" cy="300" r="150" fill="${foreground}" opacity=".2"/><path d="M240 390c80-120 160-120 240 0l80 120H160z" fill="${foreground}" opacity=".75"/><text x="360" y="610" text-anchor="middle" font-family="Arial" font-size="28" fill="#312e81">${safePrompt}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}
