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

  it('keeps independent chat and image drafts while switching modes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');

    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '聊天草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.change(input, { target: { value: '生图草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    expect(input).toHaveValue('聊天草稿');
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    expect(input).toHaveValue('生图草稿');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('NaN');
  });

  it('auto-enables the image tool for a skill and restores the explicit choice when cleared', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    fireEvent.click(await screen.findByRole('button', { name: /白底图/ }));

    expect(screen.queryByRole('switch', { name: '图片工具' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除技能' }));
    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    expect(screen.getByRole('switch', { name: '图片工具' })).not.toBeChecked();
  });

  it('derives a locked image-tool selection in image mode and restores the chat preference', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const imageTool = screen.getByRole('switch', { name: '图片工具' });
    const chatMode = screen.getByRole('button', { name: '聊天模式' });
    const imageMode = screen.getByRole('button', { name: '生图模式' });
    expect(imageTool).not.toBeChecked();
    expect(imageTool).toBeEnabled();
    expect(chatMode).toHaveAttribute('aria-pressed', 'true');
    expect(imageMode).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(imageMode);
    expect(screen.queryByRole('switch', { name: '图片工具' })).not.toBeInTheDocument();
    expect(chatMode).toHaveAttribute('aria-pressed', 'false');
    expect(imageMode).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chatMode);
    const restoredImageTool = screen.getByRole('switch', { name: '图片工具' });
    expect(restoredImageTool).not.toBeChecked();
    expect(restoredImageTool).toBeEnabled();

    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '只讨论提示词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastChatRequest?.imageToolEnabled).toBe(false);
  });

  it('selects a toolbar skill without leaving chat mode', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '选择技能' }));
    const dialog = screen.getByRole('dialog', { name: '技能配置' });
    fireEvent.click(dialog.querySelector('[aria-label="选择技能 白底图"]') as HTMLElement);

    expect(screen.getByRole('button', { name: '聊天模式' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('switch', { name: '图片工具' })).toBeChecked();
    expect(screen.getByRole('switch', { name: '图片工具' })).toBeDisabled();
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

    expect(screen.getByRole('button', { name: '聊天模式' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.body.querySelector('[aria-label="使用场景"]')).toBeInTheDocument();
    fireEvent.click(document.body.querySelector('[aria-label="清除技能"]') as HTMLElement);
    expect(document.body.querySelector('[aria-label="使用场景"]')).not.toBeInTheDocument();
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

  it('renames the active session in image mode too', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    await waitFor(() => expect(gateway.lastCreatedSession).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '生成秋季外套海报' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() =>
      expect(gateway.lastCreatedSession?.title).toBe('生成秋季外套海报'),
    );
  });

  it('preserves an explicitly enabled chat image tool across mode switches', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const imageTool = screen.getByRole('switch', { name: '图片工具' });
    fireEvent.click(imageTool);
    expect(imageTool).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    expect(imageTool).toBeChecked();

    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastChatRequest?.imageToolEnabled).toBe(true);
  });

  it('uses the first available image provider for the initial chat image-tool request', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('switch', { name: '图片工具' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '请生成一张白底马克杯商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastChatRequest?.imageProvider).toBe('seedream');
  });

  it('blocks explicit chat image intent before submitting an unavailable image provider', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.click(screen.getByRole('button', { name: /生成模型/ }));
    fireEvent.click(screen.getByRole('button', { name: 'gemini · Gemini 3 Pro Image' }));
    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    fireEvent.click(screen.getByRole('switch', { name: '图片工具' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '请生成一张白底马克杯商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    expect(await screen.findByText('所选图片服务暂时不可用，请在图片生成模式切换 provider。')).toBeInTheDocument();
    expect(gateway.lastChatRequest).toBeUndefined();
  });

  it('allows ordinary chat when only the selected image provider is unavailable', async () => {
    const gateway = createTestGateway(SeedreamOnlyGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.click(screen.getByRole('button', { name: /生成模型/ }));
    fireEvent.click(screen.getByRole('button', { name: 'gemini · Gemini 3 Pro Image' }));
    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    fireEvent.click(screen.getByRole('switch', { name: '图片工具' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '只讨论白底商品图的构图原则' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastChatRequest?.imageProvider).toBe('gemini');
    expect(gateway.lastImageRequest).toBeUndefined();
  });

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
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));

    const reference = new File(['image'], 'ref.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传参考图'), { target: { files: [reference] } });

    expect(screen.getByRole('img', { name: '参考图 ref.png' })).toHaveAttribute('src', 'blob:ref.png');
    expect(screen.getByText('ref.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除 ref.png' }));
    expect(screen.queryByRole('img', { name: '参考图 ref.png' })).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ref.png');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('hides image references in chat mode without clearing them', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['image'], 'kept.webp', { type: 'image/webp' })] },
    });
    expect(screen.getByRole('img', { name: '参考图 kept.webp' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    expect(screen.queryByRole('img', { name: '参考图 kept.webp' })).not.toBeInTheDocument();
    expect(screen.queryByText('kept.webp')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    expect(screen.getByRole('img', { name: '参考图 kept.webp' })).toBeInTheDocument();
    expect(screen.getByText('kept.webp')).toBeInTheDocument();
  });

  it('rejects unsupported reference types and caps accepted references at four', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));

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
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));

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
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
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

  it('releases remaining local preview URLs when the workspace unmounts', async () => {
    const { unmount } = render(
      <UnifiedWorkspace gateway={createTestGateway()} />,
    );
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['image'], 'cleanup.png', { type: 'image/png' })] },
    });

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cleanup.png');
  });

  it('validates required skill fields before submitting', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    fireEvent.click(await screen.findByRole('button', { name: /模特图/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成秋季外套展示图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('请填写必填技能参数'));
    expect(screen.getByRole('dialog', { name: '技能配置' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '模特风格' })).toHaveFocus();
  });

  it('submits the user-edited resolved skill prompt in image mode', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(await screen.findByRole('button', { name: /白底图/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '商品名称' }), { target: { value: '风衣' } });
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '秋季新品' } });
    fireEvent.change(screen.getByRole('textbox', { name: '最终提示词' }), {
      target: { value: '生成高级感秋季风衣白底图' },
    });
    expect(screen.getByRole('button', { name: '发送创作请求' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(
      gateway.lastImageRequest,
      screen.queryByRole('alert')?.textContent ?? 'image request was not submitted',
    ).toBeDefined());
    expect(gateway.lastImageRequest?.prompt).toBe('生成高级感秋季风衣白底图');
  });

  it('uses the selected provider, model and generation parameters in the image request', async () => {
    const gateway = createTestGateway(MultiModelGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));

    fireEvent.click(screen.getByRole('button', { name: '生成参数 1:1 1K 2张' }));
    fireEvent.click(screen.getByRole('button', { name: '比例 16:9' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /生成模型/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Studio · Portrait' }));
    expect(screen.getByRole('button', { name: '生成参数 3:4 1K 2张' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成参数 3:4 1K 2张' }));
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
