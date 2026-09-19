import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { setupWorkspaceTest, CapturingGateway, SlowPostSubmitRefreshGateway, createTestGateway, revokeObjectURL } from './workspace-test-fixtures';

describe('UnifiedWorkspace', () => {
  setupWorkspaceTest();

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


});
