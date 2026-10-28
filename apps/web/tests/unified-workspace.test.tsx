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
    expect(await screen.findByText('已收到的部分回复')).toBeInTheDocument();
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

  it('separates image models and parameters without exposing quantity', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway()} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.click(screen.getByRole('combobox', { name: /^生成模型/ }));
    expect(screen.getByRole('listbox', { name: '生成模型' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^生成参数/ }));
    expect(screen.queryByRole('listbox', { name: '生成模型' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '生成参数' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成数量/ })).not.toBeInTheDocument();
  });

  it('waits for initialization and shows commerce without submitting a request', async () => {
    const gateway = createTestGateway(CapturingGateway);
    const sessions = await gateway.listSessions();
    let releaseInitialization!: () => void;
    vi.spyOn(gateway, 'listSessions').mockImplementationOnce(() => new Promise((resolve) => {
      releaseInitialization = () => resolve(sessions);
    }));
    render(<UnifiedWorkspace gateway={gateway} />);
    expect(screen.queryByRole('button', { name: /光影与静物/ })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '创作输入' })).toBeVisible();
    expect(screen.getByRole('region', { name: '会话列表' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => releaseInitialization());
    expect(await screen.findByRole('region', { name: '电商生图' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '创作输入' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '创建图片' })).toBeEnabled();
    expect(gateway.lastImageRequest).toBeUndefined();
  });

  it('keeps navigation and editing available while quota and model status are slow', async () => {
    const gateway = createTestGateway();
    vi.spyOn(gateway, 'getQuota').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(gateway, 'getProviderCapabilities').mockImplementation(() => new Promise(() => {}));
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');
    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '继续编辑，不等待额度' } });
    expect(input).toHaveValue('继续编辑，不等待额度');
    expect(screen.getByRole('button', { name: '新对话' })).toBeVisible();
    expect(screen.queryByRole('main', { name: 'ZImage 正在载入' })).toBeNull();
  });

  it('retains a new session when the initial session list arrives late', async () => {
    const gateway = createTestGateway();
    const oldSessions = await gateway.listSessions();
    let finish!: () => void;
    vi.spyOn(gateway, 'listSessions').mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve(oldSessions);
    }));
    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    await screen.findByRole('button', { name: '重命名 新的创作' });
    await act(async () => finish());
    expect(screen.getByRole('button', { name: '重命名 新的创作' })).toBeInTheDocument();
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
    const gateway = createTestGateway(CapturingGateway);
    const session = await gateway.createSession('阅读构图建议');
    render(<UnifiedWorkspace gateway={gateway} route={{ kind:'session', sessionId:session.id }} />);
    await screen.findByText('你好，想创作什么？');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1000);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(400);
    fireEvent.scroll(window);
    expect(screen.getByRole('button', { name:'回到底部' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name:'创作输入' }), { target:{ value:'继续最新对话' } });
    fireEvent.click(screen.getByRole('button', { name:'发送创作请求' }));
    expect(screen.queryByRole('button', { name:'回到底部' })).not.toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({ behavior:'smooth', top:1000 });
  });


});
