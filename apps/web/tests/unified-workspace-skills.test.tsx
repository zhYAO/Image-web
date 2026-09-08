import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { setupWorkspaceTest, CapturingGateway, createTestGateway } from './workspace-test-fixtures';

describe('UnifiedWorkspace', () => {
  setupWorkspaceTest();

  it('ignores a legacy skill query instead of opening commerce on ordinary send', async () => {
    window.history.replaceState({}, '', '/?skill=white-background&new=1');
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '生成一张星空图片' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await screen.findByRole('article', { name: '图片生成结果' });
    expect(gateway.lastImageRequest?.prompt).toBe('生成一张星空图片');
    expect(screen.queryByRole('region', { name: /向导/ })).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
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
