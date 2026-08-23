import type { ChatRequest, ImageRequest, ProviderCapability } from '@zimage/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  lastImageRequest?: ImageRequest;

  override async *streamChat(request: ChatRequest, signal?: AbortSignal) {
    this.lastChatRequest = request;
    yield* super.streamChat(request, signal);
  }

  override async submitImage(request: ImageRequest) {
    this.lastImageRequest = request;
    return super.submitImage(request);
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

const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
const revokeObjectURL = vi.fn();

describe('UnifiedWorkspace', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

  it('keeps independent chat and image drafts while switching modes', async () => {
    render(<UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />);
    await screen.findByText('你好，想创作什么？');

    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '聊天草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.change(input, { target: { value: '生图草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    expect(input).toHaveValue('聊天草稿');
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    expect(input).toHaveValue('生图草稿');
  });

  it('auto-enables the image tool for a skill and restores the explicit choice when cleared', async () => {
    render(<UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />);
    fireEvent.click(await screen.findByRole('button', { name: /白底图/ }));

    expect(screen.getByRole('switch', { name: '图片工具' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '清除技能' }));
    expect(screen.getByRole('switch', { name: '图片工具' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '聊天模式' }));
    expect(screen.getByRole('switch', { name: '图片工具' })).not.toBeChecked();
  });

  it('derives a locked image-tool selection in image mode and restores the chat preference', async () => {
    const gateway = new CapturingGateway({ storage: new TestStorage() });
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
    expect(imageTool).toBeChecked();
    expect(imageTool).toBeDisabled();
    expect(chatMode).toHaveAttribute('aria-pressed', 'false');
    expect(imageMode).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chatMode);
    expect(imageTool).not.toBeChecked();
    expect(imageTool).toBeEnabled();

    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '只讨论提示词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastChatRequest?.imageToolEnabled).toBe(false);
  });

  it('preserves an explicitly enabled chat image tool across mode switches', async () => {
    const gateway = new CapturingGateway({ storage: new TestStorage() });
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

  it('shows an inline reference thumbnail that stays synchronized with the config panel', async () => {
    const { unmount } = render(
      <UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />,
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
    render(<UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />);
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
    render(<UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />);
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
    render(<UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />);
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
    const gateway = new CapturingGateway({ storage: new TestStorage() });
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '生图模式' }));
    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['image'], 'payload.png', { type: 'image/png' })] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成商品图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(gateway.lastImageRequest?.references).toEqual([
      { mimeType: 'image/png', name: 'payload.png', size: 5, status: 'ready' },
    ]);
  });

  it('releases remaining local preview URLs when the workspace unmounts', async () => {
    const { unmount } = render(
      <UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />,
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
    render(<UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />);
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

  it('uses the selected provider, model and generation parameters in the image request', async () => {
    const gateway = new MultiModelGateway({ storage: new TestStorage() });
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
  });

  it('removes the fixed desktop config panel, collapses the sidebar and reports the asset-library placeholder', async () => {
    render(<UnifiedWorkspace gateway={new MockWorkspaceGateway({ storage: new TestStorage() })} />);
    await screen.findByText('你好，想创作什么？');

    expect(screen.queryByRole('heading', { name: '生成配置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '折叠会话侧栏' }));
    expect(screen.getByRole('button', { name: '展开会话侧栏' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '资产库' }));
    expect(await screen.findByText('资产库暂未开放')).toBeInTheDocument();
  });
});
