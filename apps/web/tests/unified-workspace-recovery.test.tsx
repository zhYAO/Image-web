import type { ChatEvent, ChatRequest } from '@zimage/domain';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { useWorkspaceStore } from '@/store/workspace-store';
import { CapturingGateway, createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

class RecoveringGateway extends CapturingGateway {
  requests: ChatRequest[] = [];
  release?: () => void;
  override async *streamChat(request: ChatRequest, signal?: AbortSignal) {
    this.requests.push(request);
    if (this.requests.length > 1) await new Promise<void>((resolve) => { this.release = resolve; });
    yield* super.streamChat({ ...request, scenario: this.requests.length === 1 ? 'provider-unavailable' : 'happy' }, signal);
  }
}

async function sendChat() {
  await screen.findByText('你好，想创作什么？');
  fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '解释陶瓷杯的构图' } });
  fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
  await screen.findByRole('button', { name: /^重\s*试$/ });
}

describe('workspace failure recovery', () => {
  setupWorkspaceTest();

  it('keeps a completed reply successful even when iterator cleanup throws', async () => {
    class LateFailureGateway extends CapturingGateway {
      override async *streamChat(request: ChatRequest): AsyncGenerator<ChatEvent> {
        try { yield* super.streamChat({ ...request, scenario: 'happy' }); }
        finally { throw new Error('transport closed after completion'); }
      }
    }
    render(<UnifiedWorkspace gateway={createTestGateway(LateFailureGateway)} />);
    await screen.findByText('你好，想创作什么？');
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '唯一问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送创作请求' }));
    await screen.findByText(/建议突出主体材质/);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '创作输入' })).toHaveValue(''));
    expect(screen.queryByRole('button', { name: /^重\s*试$/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/服务暂时不可用|回复未完成|网络连接/)).not.toBeInTheDocument();
  });

  it('retries the original chat model and prompt once, preserving an unrelated draft', async () => {
    const gateway = createTestGateway(RecoveringGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await sendChat();
    act(() => useWorkspaceStore.getState().setSelectedChatModel('minimax'));
    fireEvent.change(screen.getByRole('textbox', { name: '创作输入' }), { target: { value: '新的未发送内容' } });
    const retry = screen.getByRole('button', { name: /^重\s*试$/ });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(gateway.requests).toHaveLength(2));
    expect(gateway.requests[1]).toMatchObject({ message: '解释陶瓷杯的构图', chatModel: 'doubao', sessionId: gateway.requests[0]?.sessionId, imageToolEnabled: false });
    expect(screen.getByRole('textbox', { name: '创作输入' })).toHaveValue('新的未发送内容');
    await act(async () => gateway.release?.());
    expect(await screen.findByText(/建议突出主体材质/)).toBeInTheDocument();
  });

  it('reconciles the persisted failure with the local error without hiding the failure', async () => {
    render(<UnifiedWorkspace gateway={createTestGateway(RecoveringGateway)} />);
    await sendChat();
    await waitFor(() => expect(screen.getAllByText('聊天服务暂时不可用，请稍后重试。')).toHaveLength(1));
  });

  it('refreshes authoritative quota after a successful recreation without reloading', async () => {
    const gateway = createTestGateway(CapturingGateway);
    const [session] = await gateway.listSessions();
    const batch = await gateway.submitImage({ sessionId: session!.id, prompt: '额度回归图', count: 1, aspectRatio: '1:1', resolution: '2K' });
    await waitFor(async () => expect((await gateway.getGenerationBatch(batch.id)).status).toBe('succeeded'));
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('✦ 29 张');
    fireEvent.click(await screen.findByRole('button', { name: '重新生成第 1 张' }));
    await waitFor(() => expect(screen.getAllByRole('article', { name: '图片生成结果' })).toHaveLength(2));
    await waitFor(() => expect(screen.getByText('✦ 28 张')).toBeInTheDocument());
  });
  it('uses terminal quota reconciliation even when an older admission quota response arrives late', async () => {
    class DelayedQuotaGateway extends CapturingGateway {
      quotaReads = 0;
      releaseQuota?: () => void;
      override async getQuota() {
        const read = ++this.quotaReads;
        const quota = await super.getQuota();
        if (read === 2) return new Promise<typeof quota>((resolve) => {
          this.releaseQuota = () => resolve({ ...quota, used: 1 });
        });
        return quota;
      }
    }
    const gateway = createTestGateway(DelayedQuotaGateway);
    const [session] = await gateway.listSessions();
    const batch = await gateway.submitImage({ sessionId: session!.id, prompt: '终态额度', count: 1, aspectRatio: '1:1', resolution: '2K' });
    await waitFor(async () => expect((await gateway.getGenerationBatch(batch.id)).status).toBe('succeeded'));
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText('✦ 29 张');
    fireEvent.click(await screen.findByRole('button', { name: '重新生成第 1 张' }));
    // Wait for terminal polling to supersede the deliberately held admission response.
    await screen.findByText('✦ 28 张', {}, { timeout: 10_000 });
    await act(async () => gateway.releaseQuota?.());
    expect(screen.getByText('✦ 28 张')).toBeInTheDocument();
  });

});
