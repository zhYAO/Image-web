import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { setupWorkspaceTest, CapturingGateway, createTestGateway } from './workspace-test-fixtures';

describe('UnifiedWorkspace', () => {
  setupWorkspaceTest();

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
