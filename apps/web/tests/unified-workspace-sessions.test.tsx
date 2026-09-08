import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { setupWorkspaceTest, CapturingGateway, ControlledTimelineGateway, RetryTimelineGateway, BackgroundChatGateway, ControlledImageGateway, createTestGateway } from './workspace-test-fixtures';

describe('UnifiedWorkspace', () => {
  setupWorkspaceTest();

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
    // Restore initialization before selecting a fixture session; populated
    // histories no longer flash the empty workspace while loading.
    await screen.findByRole('button', { name: '快会话' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: '创作输入' })).toBeEnabled());
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
    await screen.findByRole('button', { name: '可重试会话' });
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
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '生成 A 的图片' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    expect(screen.getByTestId('optimistic-image-turn')).toHaveTextContent('生成 A 的图片');

    fireEvent.click(screen.getByRole('button', { name: '聊天会话 B' }));
    await waitFor(() => expect(screen.queryByTestId('timeline-loading')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '创建图片' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: 'B 的聊天' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    expect(screen.getByText('B 的聊天')).toBeInTheDocument();

    gateway.releaseImageAdmission();
    fireEvent.click(screen.getByRole('button', { name: '图片会话 A' }));
    await waitFor(() => expect(screen.queryByTestId('optimistic-image-turn')).not.toBeInTheDocument());
    expect(screen.getByText('生成 A 的图片')).toBeInTheDocument();
  });

  it('keeps the assistant bubble stable across the stream-to-completed transition (no flash, cursor gone)', async () => {
    let releaseStream!: () => void;
    const frameGate = new Promise<void>((resolve) => { releaseStream = resolve; });
    class ObservedStreamGateway extends CapturingGateway {
      override async *streamChat(...args: Parameters<CapturingGateway['streamChat']>) {
        for await (const event of super.streamChat(...args)) {
          yield event;
          if (event.type === 'message.delta') await frameGate;
        }
      }
    }
    // Hold the intermediate frame until it is observed, independent of CPU speed.
    const gateway = createTestGateway(ObservedStreamGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('你好，想创作什么？');

    const input = screen.getByRole('textbox', { name: '创作输入' });
    fireEvent.change(input, { target: { value: '聊聊配色' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));

    // While the stream is producing bytes, the trailing cursor must be live.
    await waitFor(() => expect(screen.getByTestId('chat-stream-cursor')).toBeInTheDocument());

    releaseStream();
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


});
