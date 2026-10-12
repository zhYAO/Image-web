import type {
  ChatRequest,
  ImageRequest,
  ProviderCapability,
  RecreateRequest,
  Session,
} from '@zimage/domain';
import { afterEach, beforeEach, vi } from 'vitest';

import { MockWorkspaceGateway, type StorageLike } from '@/gateways/mock-workspace-gateway';
import { useWorkspaceStore } from '@/store/workspace-store';

class TestStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

export class CapturingGateway extends MockWorkspaceGateway {
  lastChatRequest?: ChatRequest;
  lastCreatedSession?: Session;
  lastImageRequest?: ImageRequest;
  lastRecreateRequest?: RecreateRequest;
  lastRenamedTitle?: string;

  override async createSession(title?: string) {
    const session = await super.createSession(title);
    this.lastCreatedSession = session;
    return session;
  }

  override async renameSession(sessionId: string, title: string) {
    this.lastRenamedTitle = title;
    const session = await super.renameSession(sessionId, title);
    if (this.lastCreatedSession?.id === sessionId) this.lastCreatedSession = session;
    return session;
  }

  override async *streamChat(request: ChatRequest, signal?: AbortSignal) {
    this.lastChatRequest = request;
    yield* super.streamChat(request, signal);
  }

  override async submitImage(request: ImageRequest) {
    this.lastImageRequest = request;
    return super.submitImage(request);
  }

  override async recreateGeneration(request: RecreateRequest) {
    this.lastRecreateRequest = request;
    return super.recreateGeneration(request);
  }
}

export class SeedreamOnlyGateway extends CapturingGateway {
  override async getProviderHealth() {
    return [
      { checkedAt: '2026-08-28', provider: 'gemini', status: 'unavailable' as const },
      { checkedAt: '2026-08-28', provider: 'seedream', status: 'degraded' as const },
      { checkedAt: '2026-08-28', provider: 'doubao', status: 'healthy' as const },
      { checkedAt: '2026-08-28', provider: 'minimax', status: 'healthy' as const },
    ];
  }
}

export class UnavailableImageGateway extends SeedreamOnlyGateway {
  override async getProviderHealth() {
    return (await super.getProviderHealth()).map((health) => health.provider === 'seedream'
      ? { ...health, status: 'unavailable' as const }
      : health);
  }
}

export class PlanOnlyGateway extends CapturingGateway {
  override async getProviderCapabilities(): Promise<ProviderCapability[]> {
    return [
      {
        models: [
          { aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'], id: 'doubao-seedream-5.0-pro', label: 'Seedream 5.0 Pro', maxImages: 4, resolutions: ['2K'] },
        ],
        provider: 'seedream',
      },
    ];
  }

  override async getProviderHealth() {
    return [{ checkedAt: '2026-08-23', provider: 'seedream', status: 'healthy' as const }];
  }
}

export class SlowPostSubmitRefreshGateway extends CapturingGateway {
  private releaseRefresh?: () => void;
  private readonly refreshGate = new Promise<void>((resolve) => {
    this.releaseRefresh = resolve;
  });

  releasePostSubmitRefresh() {
    this.releaseRefresh?.();
  }

  override async getQuota() {
    if (this.lastImageRequest) await this.refreshGate;
    return super.getQuota();
  }
}

export class ControlledTimelineGateway extends CapturingGateway {
  private readonly gates = new Map<string, { promise: Promise<void>; release: () => void }>();

  holdTimeline(sessionId: string) {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.gates.set(sessionId, { promise, release });
  }

  releaseTimeline(sessionId: string) {
    this.gates.get(sessionId)?.release();
    this.gates.delete(sessionId);
  }

  override async getTimeline(sessionId: string) {
    await this.gates.get(sessionId)?.promise;
    return super.getTimeline(sessionId);
  }
}

export class RetryTimelineGateway extends CapturingGateway {
  private failingSessionId?: string;

  failNextTimeline(sessionId: string) {
    this.failingSessionId = sessionId;
  }

  override async getTimeline(sessionId: string) {
    if (this.failingSessionId === sessionId) {
      this.failingSessionId = undefined;
      throw new Error('timeline unavailable');
    }
    return super.getTimeline(sessionId);
  }
}

export class BackgroundChatGateway extends CapturingGateway {
  readonly requests: ChatRequest[] = [];
  private heldSessionId?: string;
  private releaseHeld?: () => void;

  holdChat(sessionId: string) {
    this.heldSessionId = sessionId;
  }

  releaseChat() {
    this.releaseHeld?.();
  }

  override async *streamChat(request: ChatRequest, signal?: AbortSignal) {
    this.requests.push(request);
    if (request.sessionId === this.heldSessionId) {
      await new Promise<void>((resolve) => {
        this.releaseHeld = resolve;
      });
    }
    yield* super.streamChat(request, signal);
  }
}

export class ControlledImageGateway extends CapturingGateway {
  private releaseAdmission?: () => void;
  private readonly admissionGate = new Promise<void>((resolve) => {
    this.releaseAdmission = resolve;
  });

  releaseImageAdmission() {
    this.releaseAdmission?.();
  }

  override async submitImage(request: ImageRequest) {
    this.lastImageRequest = request;
    await this.admissionGate;
    return super.submitImage(request);
  }
}

export class FailOnceImageGateway extends CapturingGateway {
  attempts = 0;

  override async submitImage(request: ImageRequest) {
    this.attempts += 1;
    this.lastImageRequest = request;
    if (this.attempts === 1) throw new Error('admission failed');
    return super.submitImage(request);
  }
}

type TestGatewayConstructor<T extends MockWorkspaceGateway> = new (options?: {
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  storage?: StorageLike;
}) => T;
interface TestGatewayOptions {
  delay?: (milliseconds: number) => Promise<void>;
}

export function createTestGateway(): MockWorkspaceGateway;
export function createTestGateway<T extends MockWorkspaceGateway>(
  Gateway: TestGatewayConstructor<T>,
  options?: TestGatewayOptions,
): T;
export function createTestGateway<T extends MockWorkspaceGateway>(
  Gateway: TestGatewayConstructor<T> = MockWorkspaceGateway as TestGatewayConstructor<T>,
  options: TestGatewayOptions = {},
) {
  // Zero-delay fixtures can create/update sessions in the same wall-clock
  // millisecond. Keep their intended activity order deterministic on fast CI.
  let timestamp = Date.now();
  return new Gateway({
    delay: options.delay ?? (async () => undefined),
    now: () => new Date(timestamp++),
    storage: new TestStorage(),
  });
}

export const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
export const revokeObjectURL = vi.fn();

// Each suite gets a fresh jsdom document and style registry.
export function setupWorkspaceTest() {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    sessionStorage.clear();
    useWorkspaceStore.getState().reset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

}
