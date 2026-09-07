import type {
  ChatRequest,
  ImageRequest,
  ProviderCapability,
  RecreateRequest,
  Session,
  WorkspaceGateway,
} from '@zimage/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
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

class CapturingGateway extends MockWorkspaceGateway {
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

class SeedreamOnlyGateway extends CapturingGateway {
  override async getProviderHealth() {
    return [
      { checkedAt: '2026-08-28', provider: 'gemini', status: 'unavailable' as const },
      { checkedAt: '2026-08-28', provider: 'seedream', status: 'degraded' as const },
      { checkedAt: '2026-08-28', provider: 'doubao', status: 'healthy' as const },
      { checkedAt: '2026-08-28', provider: 'minimax', status: 'healthy' as const },
    ];
  }
}

class MultiModelGateway extends CapturingGateway {
  override async getProviderCapabilities(): Promise<ProviderCapability[]> {
    return [
      {
        models: [
          { aspectRatios: ['1:1', '16:9'], id: 'wide', label: 'Wide', maxImages: 2, resolutions: ['1K'] },
          { aspectRatios: ['3:4', '1:1'], id: 'portrait', label: 'Portrait', maxImages: 4, resolutions: ['1K', '2K'] },
        ],
        provider: 'Studio',
      },
    ];
  }

  override async getProviderHealth() {
    return [{ checkedAt: '2026-08-23', provider: 'Studio', status: 'healthy' as const }];
  }
}

class SlowPostSubmitRefreshGateway extends CapturingGateway {
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

class ControlledTimelineGateway extends CapturingGateway {
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

class RetryTimelineGateway extends CapturingGateway {
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

class BackgroundChatGateway extends CapturingGateway {
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

class ControlledImageGateway extends CapturingGateway {
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

class FailOnceImageGateway extends CapturingGateway {
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
  storage?: StorageLike;
}) => T;
interface TestGatewayOptions {
  delay?: (milliseconds: number) => Promise<void>;
}

function createTestGateway(): MockWorkspaceGateway;
function createTestGateway<T extends MockWorkspaceGateway>(
  Gateway: TestGatewayConstructor<T>,
  options?: TestGatewayOptions,
): T;
function createTestGateway<T extends MockWorkspaceGateway>(
  Gateway: TestGatewayConstructor<T> = MockWorkspaceGateway as TestGatewayConstructor<T>,
  options: TestGatewayOptions = {},
) {
  return new Gateway({
    delay: options.delay ?? (async () => undefined),
    storage: new TestStorage(),
  });
}

const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
const revokeObjectURL = vi.fn();

describe('UnifiedWorkspace', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

  it('preserves partial output and its error after timeline refresh', async () => {
    class InterruptedGateway extends CapturingGateway {
      override async *streamChat() {
        yield { type: 'message.delta' as const, messageId: 'partial', delta: '已收到的部分回复' };
        yield { type: 'stream.failed' as const, error: { code: 'STREAM_INTERRUPTED' as const, message: '回复连接已中断', retryable: true } };
      }
    }
    render(<UnifiedWorkspace gateway={createTestGateway(InterruptedGateway)} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '解释构图' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await screen.findByText('回复连接已中断');
    await waitFor(() => expect(screen.queryByTestId('chat-stream-cursor')).not.toBeInTheDocument());
    expect(screen.getByText('已收到的部分回复')).toBeInTheDocument();
    expect(screen.getByText('回复连接已中断')).toBeInTheDocument();
  });

  it('keeps one draft while toggling the create-image tool', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '统一草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    expect(input).toHaveValue('统一草稿');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    expect(input).toHaveValue('统一草稿');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('NaN');
  });

  it('collapses image model and parameters behind one shared settings summary', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));

    const summary = screen.getByRole('button', { name: /图片设置 .* 1:1 2K 2张/ });
    expect(summary).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '图片生成设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^生成参数/ })).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(screen.getByRole('dialog', { name: '图片生成设置' })).toBeInTheDocument();
  });

  it('auto-enables the image tool for a skill and keeps it enabled after clearing the Skill', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    fireEvent.click(await screen.findByRole('button', { name: /白底图/ }));

    expect(screen.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '创建图片' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '清除技能' }));
    expect(screen.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '创建图片' })).toBeEnabled();
  });

  it('uses the create-image tool as the only explicit request router', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const imageTool = screen.getByRole('button', { name: '创建图片' });
    expect(imageTool).toHaveAttribute('aria-pressed', 'false');

    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '只讨论提示词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastChatRequest?.imageToolEnabled).toBe(false);
    expect(gateway.lastImageRequest).toBeUndefined();
  });

  it('selects a toolbar skill and locks the create-image tool', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '选择技能' }));
    const dialog = screen.getByRole('dialog', { name: '技能配置' });
    fireEvent.click(dialog.querySelector('[aria-label="选择技能 白底图"]') as HTMLElement);

    expect(screen.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '创建图片' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '技能配置 白底图' })).toBeInTheDocument();
  });

  it('selects and clears skills from the mobile configuration drawer', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '打开移动端生成配置' }));
    await screen.findByText('生成配置');
    const socialSkill = document.body.querySelector('[aria-label="选择技能 种草图"]') as HTMLElement | null;
    expect(socialSkill).not.toBeNull();
    fireEvent.click(socialSkill!);

    expect(screen.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('textbox', { name: '本次 Skill 方案' }).length).toBeGreaterThan(0);
    fireEvent.click(document.body.querySelector('[aria-label="清除技能"]') as HTMLElement);
    expect(screen.queryByRole('textbox', { name: '本次 Skill 方案' })).not.toBeInTheDocument();
  });

  it('clears the chat draft the moment the user submits and shows a typing indicator until the first delta', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '给我三个秋天配色' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    // ChatGPT-style: the input clears synchronously with submission, before
    // the stream produces its first delta.
    expect(input).toHaveValue('');
    expect(screen.getByTestId('chat-typing-indicator')).toHaveAttribute(
      'aria-label',
      'AI 正在思考',
    );
    expect(screen.queryByText('给我三个秋天配色')).toBeInTheDocument();

    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
  });

  it('shows a bottom affordance after manual upward scrolling and resumes follow when the user submits', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway(CapturingGateway)} />);
    await screen.findByText('你好，想创作什么？');

    const timeline = screen.getByRole('log', { name: '对话时间线' });
    const scrollTo = vi.fn();
    Object.defineProperties(timeline, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTo: { configurable: true, value: scrollTo },
      scrollTop: { configurable: true, value: 400, writable: true },
    });
    fireEvent.scroll(timeline);
    expect(screen.getByRole('button', { name: '回到底部' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '继续最新对话' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 1_000 });
  });

  it('shows a skeleton while switching sessions and ignores a late response from the previous selection', async () => {
    const gateway = createTestGateway(ControlledTimelineGateway);
    const slow = await gateway.createSession('慢会话');
    const fast = await gateway.createSession('快会话');
    for await (const _event of gateway.streamChat({ imageToolEnabled: false, message: '慢会话内容', sessionId: slow.id })) {
      // Persist the controlled fixture through the real mock gateway.
      void _event;
    }
    for await (const _event of gateway.streamChat({ imageToolEnabled: false, message: '快会话内容', sessionId: fast.id })) {
      // Persist the controlled fixture through the real mock gateway.
      void _event;
    }

    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '快会话' }));
    await screen.findByText('快会话内容');
    gateway.holdTimeline(slow.id);
    fireEvent.click(screen.getByRole('button', { name: '慢会话' }));

    expect(screen.getByTestId('timeline-loading')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '创作输入' })).toBeDisabled();
    expect(screen.queryByText('快会话内容')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '快会话' }));
    await screen.findByText('快会话内容');
    gateway.releaseTimeline(slow.id);
    await waitFor(() => expect(screen.queryByText('慢会话内容')).not.toBeInTheDocument());
  });

  it('shows a retry action when a session timeline fails to load', async () => {
    const gateway = createTestGateway(RetryTimelineGateway);
    const retrySession = await gateway.createSession('可重试会话');
    for await (const _event of gateway.streamChat({ imageToolEnabled: false, message: '重试后的内容', sessionId: retrySession.id })) {
      // Persist the fixture through the real mock gateway.
      void _event;
    }
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    gateway.failNextTimeline(retrySession.id);
    fireEvent.click(screen.getByRole('button', { name: '可重试会话' }));

    expect(await screen.findByText('会话加载失败')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '创作输入' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    expect(await screen.findByText('重试后的内容')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '创作输入' })).toBeEnabled();
  });

  it('keeps a chat running in its original session and allows submission in another session', async () => {
    const gateway = createTestGateway(BackgroundChatGateway);
    const first = await gateway.createSession('会话 A');
    await gateway.createSession('会话 B');
    gateway.holdChat(first.id);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '会话 A' }));
    await waitFor(() => expect(screen.queryByTestId('timeline-loading')).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: 'A 的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.requests).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '会话 B' }));
    await waitFor(() => expect(screen.queryByTestId('timeline-loading')).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: 'B 的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.requests.map((request) => request.message)).toContain('B 的问题'));

    gateway.releaseChat();
  });

  it('keeps image admission in its original session and leaves another session interactive', async () => {
    const gateway = createTestGateway(ControlledImageGateway);
    await gateway.createSession('图片会话 A');
    await gateway.createSession('聊天会话 B');
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '图片会话 A' }));
    await waitFor(() => expect(screen.queryByTestId('timeline-loading')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: 'A 的图片' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    expect(screen.getByTestId('optimistic-image-turn')).toHaveTextContent('A 的图片');

    fireEvent.click(screen.getByRole('button', { name: '聊天会话 B' }));
    await waitFor(() => expect(screen.queryByTestId('timeline-loading')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: 'B 的聊天' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    expect(screen.getByText('B 的聊天')).toBeInTheDocument();

    gateway.releaseImageAdmission();
    fireEvent.click(screen.getByRole('button', { name: '图片会话 A' }));
    await waitFor(() => expect(screen.queryByTestId('optimistic-image-turn')).not.toBeInTheDocument());
    expect(screen.getByText('A 的图片')).toBeInTheDocument();
  }, 30_000);

  it('keeps the assistant bubble stable across the stream-to-completed transition (no flash, cursor gone)', async () => {
    const gateway = createTestGateway(CapturingGateway, {
      // This test observes the intermediate streaming frame, so keep a short
      // controlled yield while every other test bypasses production timing.
      delay: () => new Promise((resolve) => setTimeout(resolve, 100)),
    });
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '聊聊配色' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    // While the stream is producing bytes, the trailing cursor must be live.
    await waitFor(() => expect(screen.getByTestId('chat-stream-cursor')).toBeInTheDocument());

    // Wait for the mock stream to finish and the timeline refresh to settle.
    await waitFor(() => expect(screen.queryByTestId('chat-stream-cursor')).not.toBeInTheDocument());

    // The assistant text must be persisted as a timeline item exactly once,
    // so the bubble stays visible instead of flashing off between clear-
    // streaming and refresh.
    const persisted = screen.getAllByText('可以。建议突出主体材质、光线、构图和使用场景，让画面目标更明确。');
    expect(persisted).toHaveLength(1);
    expect(screen.queryByTestId('chat-stream-cursor')).not.toBeInTheDocument();
  });

  it('renames the active session from the first message and leaves later messages alone', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    // Explicitly click the sidebar "新对话" so a default-titled session
    // becomes active, matching the production flow that previously left the
    // sidebar stuck on "新的创作" forever.
    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    await waitFor(() => expect(gateway.lastCreatedSession).toBeDefined());
    expect(gateway.lastCreatedSession?.title).toBe('新的创作');

    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '聊聊秋季风衣配色' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    // Title should follow the first message; long prompts are truncated
    // through the gateway's titleFrom helper (20 chars + ellipsis).
    await waitFor(() =>
      expect(gateway.lastCreatedSession?.title).toBe('聊聊秋季风衣配色'),
    );
    expect(screen.getByRole('button', { name: '聊聊秋季风衣配色' })).toBeInTheDocument();

    // A second message in the same session must not clobber the title.
    await waitFor(() => expect(screen.queryByTestId('chat-stream-cursor')).not.toBeInTheDocument());
    // Wait until the first turn has fully settled (refreshSessions has
    // completed and busy is cleared) before firing the second submit. Without
    // this the second click is silently swallowed by Antd's merged
    // `loading` -> `disabled` mapping.
    await screen.findByText('可以。建议突出主体材质、光线、构图和使用场景，让画面目标更明确。');
    const previousTitle = gateway.lastCreatedSession?.title;
    fireEvent.change(input, { target: { value: '继续聊一下材质' } });
    // After change, the draft is non-empty so the only remaining reason the
    // submit button could stay disabled is `loading={busy}`. Wait for that to
    // clear before clicking so the second streamChat is actually called.
    await waitFor(() => expect(screen.getByRole('button', { name: '发送创作请求' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() =>
      expect(gateway.lastChatRequest?.message).toBe('继续聊一下材质'),
    );
    expect(gateway.lastCreatedSession?.title).toBe(previousTitle);
  });

  it('renames the active session from its first image request', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    await waitFor(() => expect(gateway.lastCreatedSession).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '生成秋季外套海报' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() =>
      expect(gateway.lastCreatedSession?.title).toBe('生成秋季外套海报'),
    );
  });

  it('keeps the create-image tool enabled after a queued request', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const imageTool = screen.getByRole('button', { name: '创建图片' });
    fireEvent.click(imageTool);
    expect(imageTool).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastChatRequest).toBeUndefined();
    expect(imageTool).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders an image conversation turn immediately while queue admission is pending', async () => {
    const gateway = createTestGateway(ControlledImageGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '一只在海边奔跑的白猫' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    expect(screen.getByTestId('optimistic-image-turn')).toHaveTextContent('一只在海边奔跑的白猫');
    expect(screen.getAllByText('等待队列处理')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: '创作输入' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');

    gateway.releaseImageAdmission();
    await waitFor(() => expect(screen.queryByTestId('optimistic-image-turn')).not.toBeInTheDocument());
  });

  it('retries a failed image admission in the same conversation turn', async () => {
    const gateway = createTestGateway(FailOnceImageGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '需要重试的商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    const retry = await screen.findByRole('button', { name: '重试生成' });
    expect(screen.getAllByText('需要重试的商品图')).toHaveLength(1);
    fireEvent.click(retry);

    await waitFor(() => expect(gateway.attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试生成' })).not.toBeInTheDocument());
    expect(screen.getAllByText('需要重试的商品图')).toHaveLength(1);
  });

  it('uses the first available image provider for the initial image request', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '请生成一张白底马克杯商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastImageRequest?.provider).toBe('seedream');
  });

  it('blocks a direct image request for an unavailable image provider', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.click(screen.getByRole('button', { name: /图片设置/ }));
    fireEvent.click(screen.getByRole('button', { name: 'gemini · Gemini 3 Pro Image' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '请生成一张白底马克杯商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    expect(await screen.findByText('所选服务暂时不可用，请选择其他 provider。')).toBeInTheDocument();
    expect(gateway.lastImageRequest).toBeUndefined();
  }, 30_000);

  it('allows ordinary chat when only the selected image provider is unavailable', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.click(screen.getByRole('button', { name: /图片设置/ }));
    fireEvent.click(screen.getByRole('button', { name: 'gemini · Gemini 3 Pro Image' }));
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '只讨论白底商品图的构图原则' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastImageRequest).toBeUndefined();
  }, 30_000);

  it('forwards the generation id from a failed asset into single recreation', async () => {
    const gateway = createTestGateway(CapturingGateway);
    const session = await gateway.createSession('失败批次');
    const pending = await gateway.submitImage({
      aspectRatio: '1:1',
      count: 1,
      model: 'seedream-4.5',
      prompt: '失败图片',
      provider: 'seedream',
      resolution: '2K',
      scenario: 'provider-unavailable',
      sessionId: session.id,
    });
    await waitFor(async () => expect((await gateway.getGenerationBatch(pending.id)).status).toBe('failed'));
    const failed = await gateway.getGenerationBatch(pending.id);
    const generationId = failed.assets[0]!.id;

    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(await screen.findByRole('button', { name: '失败批次' }));
    await screen.findByText('失败图片');
    fireEvent.click(screen.getByRole('button', { name: '重新生成第 1 张' }));

    await waitFor(() => expect(gateway.lastRecreateRequest).toBeDefined());
    expect(gateway.lastRecreateRequest).toEqual({
      batchId: failed.id,
      generationId,
      scope: 'single',
    });
  });

  it('only renders the mock scenario selector for a real mock gateway', async () => {
    const mockGateway = createTestGateway();
    const delegatedGateway = new Proxy({} as WorkspaceGateway, {
      get(_target, property) {
        const value = Reflect.get(mockGateway, property, mockGateway) as unknown;
        return typeof value === 'function' ? value.bind(mockGateway) : value;
      },
    });

    const { unmount } = render(<UnifiedWorkspace gateway={delegatedGateway} />);
    await screen.findByText('你好，想创作什么？');
    expect(screen.queryByRole('combobox', { name: 'Mock 场景' })).not.toBeInTheDocument();
    unmount();

    render(<UnifiedWorkspace gateway={mockGateway} />);
    await screen.findByText('你好，想创作什么？');
    expect(screen.getByRole('combobox', { name: 'Mock 场景' })).toBeInTheDocument();
  });

  it('shows an inline reference thumbnail that stays synchronized with the config panel', async () => {
    const { unmount } = render(
      <UnifiedWorkspace gateway={createTestGateway()} />,
    );
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));

    const reference = new File(['image'], 'ref.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [reference] } });

    expect(screen.getByRole('img', { name: '参考图 ref.png' })).toHaveAttribute('src', 'blob:ref.png');
    expect(screen.getByText('ref.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('img', { name: '参考图 ref.png' }));
    const previewDialog = await screen.findByRole('dialog');
    expect(previewDialog).toBeInTheDocument();
    expect(previewDialog.querySelector('img')).toHaveAttribute('src', 'blob:ref.png');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '移除 ref.png' }));
    expect(screen.queryByRole('img', { name: '参考图 ref.png' })).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ref.png');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('hides image references when the create-image tool is off without clearing them', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['image'], 'kept.webp', { type: 'image/webp' })] },
    });
    expect(screen.getByRole('img', { name: '参考图 kept.webp' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    expect(screen.queryByRole('img', { name: '参考图 kept.webp' })).not.toBeInTheDocument();
    expect(screen.queryByText('kept.webp')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    expect(screen.getByRole('img', { name: '参考图 kept.webp' })).toBeInTheDocument();
    expect(screen.getByText('kept.webp')).toBeInTheDocument();
  });

  it('rejects unsupported reference types and caps accepted references at four', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));

    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('仅支持 JPG、PNG 或 WebP');

    const references = Array.from(
      { length: 5 },
      (_, index) => new File(['image'], `ref-${index + 1}.png`, { type: 'image/png' }),
    );
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: references } });

    expect(screen.getAllByRole('img', { name: /参考图 ref-/ })).toHaveLength(4);
    expect(screen.getByRole('alert')).toHaveTextContent('最多可添加 4 张参考图');
    expect(screen.queryByLabelText('上传参考图')).not.toBeInTheDocument();
  });

  it('rejects reference images larger than 10 MB', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));

    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [oversized] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('large.jpg 超过 10 MB');
    expect(screen.queryByRole('img', { name: '参考图 large.jpg' })).not.toBeInTheDocument();
  });

  it('keeps local preview URLs out of the image gateway request', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    const file = new File(['image'], 'payload.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [file] } });
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastImageRequest?.references).toHaveLength(1);
    expect(gateway.lastImageRequest?.references?.[0]).toMatchObject({
      file,
      mimeType: 'image/png',
      name: 'payload.png',
      size: 5,
      status: 'ready',
    });
    expect(gateway.lastImageRequest?.references?.[0]).not.toHaveProperty('previewUrl');
  });

  it('clears image inputs and re-enables submission before post-queue refresh completes', async () => {
    const gateway = createTestGateway(SlowPostSubmitRefreshGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['image'], 'queued.png', { type: 'image/png' })] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成排队后的商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    await waitFor(() => expect(screen.getByRole('textbox', { name: '创作输入' })).toHaveValue(''));
    expect(screen.queryByRole('img', { name: '参考图 queued.png' })).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:queued.png');
    await waitFor(() => expect(screen.getByRole('button', { name: '发送创作请求' })).not.toHaveClass('ant-btn-loading'));
    gateway.releasePostSubmitRefresh();
  });

  it('releases remaining local preview URLs when the workspace unmounts', async () => {
    const { unmount } = render(
      <UnifiedWorkspace gateway={createTestGateway()} />,
    );
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['image'], 'cleanup.png', { type: 'image/png' })] },
    });

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cleanup.png');
  });

  it('allows a natural-language Skill request without fixed required fields', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(await screen.findByRole('button', { name: /模特图/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成秋季外套展示图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('submits the user-edited resolved skill prompt with image creation enabled', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(await screen.findByRole('button', { name: /白底图/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '秋季新品' } });
    fireEvent.change(screen.getByRole('textbox', { name: '本次 Skill 方案' }), {
      target: { value: '生成高级感秋季风衣白底图' },
    });
    expect(screen.getByRole('button', { name: '发送创作请求' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(
      gateway.lastImageRequest,
      screen.queryByRole('alert')?.textContent ?? 'image request was not submitted',
    ).toBeDefined());
    expect(gateway.lastImageRequest?.prompt).toBe('生成高级感秋季风衣白底图\n\n用户要求：秋季新品');
  });

  it('uses the selected provider, model and generation parameters in the image request', async () => {
    const gateway = createTestGateway(MultiModelGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));

    fireEvent.click(screen.getByRole('button', { name: '图片设置 Studio Wide 1:1 1K 2张' }));
    fireEvent.click(screen.getByRole('button', { name: '比例 16:9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Studio · Portrait' }));
    expect(screen.getByRole('button', { name: '图片设置 Studio Portrait 3:4 1K 2张' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '分辨率 2K' }));
    fireEvent.click(screen.getByRole('button', { name: '生成数量 4' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '一张秋日产品海报' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastImageRequest).toMatchObject({
      aspectRatio: '3:4',
      count: 4,
      model: 'portrait',
      provider: 'Studio',
      resolution: '2K',
    });
  }, 60_000);

  it('removes the fixed desktop config panel, collapses the sidebar and reports the asset-library placeholder', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');

    expect(screen.queryByRole('heading', { name: '生成配置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '折叠会话侧栏' }));
    expect(screen.getByRole('button', { name: '展开会话侧栏' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '资产库' }));
    expect(await screen.findByText('资产库暂未开放')).toBeInTheDocument();
  });
});
