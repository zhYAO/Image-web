import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { useWorkspaceStore } from '@/store/workspace-store';
import { CapturingGateway, createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

describe('explicit creation modes', () => {
  setupWorkspaceTest();
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('submits a descriptive prompt to Seedream when image creation is selected', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    act(() => {
      const store = useWorkspaceStore.getState();
      store.setSelectedProvider('seedream');
      store.setSelectedModelId('seedream-4.5');
      store.setCount(1);
      store.setAspectRatio('4:3');
    });
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '一只橘猫坐在窗边，午后阳光，写实摄影' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastImageRequest ?? gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastImageRequest).toMatchObject({
      prompt: '一只橘猫坐在窗边，午后阳光，写实摄影',
      provider: 'seedream', model: 'seedream-4.5', count: 1, aspectRatio: '4:3', resolution: '2K',
    });
    expect(gateway.lastChatRequest).toBeUndefined();
  });

  it('uses the upload-first commerce form without a chat composer and restores chat when cancelled after upload', async () => {
    window.history.replaceState({}, '', '/?scene=product-main');
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByRole('region', { name: 'AI 商品图向导' }, { timeout: 10000 });
    expect(screen.queryByRole('textbox', { name: '创作输入' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送创作请求' })).not.toBeInTheDocument();
    expect(screen.getByText('上传或拖放图片至此处，开始创作')).toBeVisible();
    fireEvent.change(within(screen.getByRole('complementary', { name: '电商方案预览' })).getByLabelText('上传电商参考图'), {
      target: { files: [new File(['image'], 'product.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消方案' }));
    expect(await screen.findByRole('textbox', { name: '创作输入' })).toBeInTheDocument();
  });
});
