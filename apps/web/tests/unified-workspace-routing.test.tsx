import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { useWorkspaceStore } from '@/store/workspace-store';
import { setupWorkspaceTest, CapturingGateway, createTestGateway } from './workspace-test-fixtures';

describe('ordinary creation stays independent from commerce', () => {
  setupWorkspaceTest();

  it('ignores a stale official Skill when sending an ordinary image request', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    act(() => {
      useWorkspaceStore.getState().selectSkill('white-background');
      useWorkspaceStore.getState().setExplicitImageToolEnabled(true);
    });
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '生成一张月球风景图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastImageRequest?.prompt).toBe('生成一张月球风景图'));
    expect(gateway.lastImageRequest?.skillId).toBeUndefined();
    expect(screen.queryByRole('region', { name: /向导/ })).not.toBeInTheDocument();
  });

  it('does not consume image edit language when no commerce task exists', async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '第三张背景换成米色' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastChatRequest?.message).toBe('第三张背景换成米色'));
    expect(screen.queryByText(/请先点击要修改任务/)).not.toBeInTheDocument();
  });

  it('does not depend on the hidden Skill registry to initialize ordinary creation', async () => {
    const gateway = createTestGateway(CapturingGateway);
    vi.spyOn(gateway, 'getSkills').mockRejectedValue(new Error('legacy registry unavailable'));
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), {
      target: { value: '你好' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(screen.queryByRole('link', { name: '官方 Skill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '技能配置' })).not.toBeInTheDocument();
  });
});
