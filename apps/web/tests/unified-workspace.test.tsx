import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { setupWorkspaceTest, CapturingGateway, createTestGateway } from './workspace-test-fixtures';

describe('UnifiedWorkspace', () => {
  setupWorkspaceTest();

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

  it('fills inspiration into the composer and lets the user edit before generation', async () => {
    const gateway = createTestGateway(CapturingGateway);
    const sessions = await gateway.listSessions();
    let releaseInitialization!: () => void;
    vi.spyOn(gateway, 'listSessions').mockImplementationOnce(() => new Promise((resolve) => {
      releaseInitialization = () => resolve(sessions);
    }));
    render(<UnifiedWorkspace gateway={gateway} />);
    expect(screen.queryByRole('button', { name: /光影与静物/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '创作输入' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'ZImage 正在载入' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => releaseInitialization());
    fireEvent.click(await screen.findByRole('button', { name: /光影与静物/ }));
    expect(screen.getByRole('textbox', { name: '创作输入' })).toHaveValue('生成一张晨光下的陶瓷花瓶图片，柔和阴影，留白构图');
    expect(screen.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '创建图片' })).toBeEnabled();
    expect(gateway.lastImageRequest).toBeUndefined();
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

  it('keeps official skills hidden from toolbar and mobile configuration', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    expect(screen.queryByRole('button', { name: '选择技能' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.click(screen.getByRole('button', { name: '打开移动端生成配置' }));
    await screen.findByText('生成配置');
    expect(screen.getByLabelText('移动端生成模型')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /选择技能/ })).not.toBeInTheDocument();
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


});
