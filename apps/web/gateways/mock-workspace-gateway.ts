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
  sessions: Session[];
  timelines: Record<string, TimelineItem[]>;
  batches: Record<string, GenerationBatch>;
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
    const session = this.requireSession(sessionId);
    session.title = title.trim() || '未命名创作';
    session.updatedAt = this.timestamp();
    this.persist();
    return clone(session);
  }

  async deleteSession(sessionId: string) {
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

    this.appendTimeline(session.id, {
      content: request.message.trim(),
      createdAt: this.timestamp(),
      id: this.id('message'),
      role: 'user',
      sessionId: session.id,
      type: 'message',
    });

    if (request.scenario === 'provider-unavailable') {
      const error = {
        code: 'PROVIDER_UNAVAILABLE' as const,
        message: '聊天服务暂时不可用，请稍后重试。',
        retryable: true,
      };
      this.appendTimeline(session.id, {
        actionLabel: '重试',
        createdAt: this.timestamp(),
        error,
        id: this.id('error'),
        sessionId: session.id,
        type: 'error',
      });
      yield { error, type: 'stream.failed' };
      return;
    }

    const shouldGenerateImage = request.imageToolEnabled &&
      (Boolean(request.skillId) || hasExplicitImageIntent(request.message));
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

    this.appendTimeline(session.id, {
      content: answer,
      createdAt: this.timestamp(),
      id: messageId,
      role: 'assistant',
      sessionId: session.id,
      streaming: false,
      type: 'message',
    });
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
      const stored = this.state.batches[batch.id];
      if (stored) stored.source = 'chat_tool';
      this.persist();
      yield { batchId: (stored ?? batch).id, type: 'tool.queued' };
    }
  }

  async submitImage(request: ImageRequest) {
    const validation = validateImageRequest(request);
    if (!validation.ok) throw new WorkspaceError(validation.error);
    const session = request.sessionId
      ? this.requireSession(request.sessionId)
      : await this.createSession(this.titleFrom(request.prompt));
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
    this.appendTimeline(session.id, {
      batch,
      createdAt,
      id: this.id('timeline'),
      sessionId: session.id,
      type: 'generation',
    });
    this.persist();
    void this.transitionBatch(batchId, request.scenario ?? 'happy');
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

  async recreateGeneration(request: RecreateRequest) {
    const original = await this.getGenerationBatch(request.batchId);
    let assets = original.assets;
    if (request.scope === 'failed') assets = assets.filter((asset) => asset.status === 'failed');
    if (request.scope === 'single') assets = assets.filter((asset) => asset.id === request.generationId);
    if (assets.length === 0) {
      throw new WorkspaceError({ code: 'BATCH_NOT_FOUND', message: '没有可重生成的图片。', retryable: false });
    }
    return this.submitImage({
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
    return { limit: 30, resetsAt: '2026-09-01T00:00:00.000Z', used: 28 };
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
    const batch = this.state.batches[batchId];
    if (!batch) return;
    for (const asset of batch.assets) asset.status = 'processing';
    batch.status = 'processing';
    this.syncBatchTimeline(batch);
    this.persist();

    await this.delay(700);
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
    return `${prefix}-${this.now().getTime()}-${this.idCounter}`;
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
