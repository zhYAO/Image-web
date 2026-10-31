import { act, fireEvent, render, screen } from '@testing-library/react';
import { buildCommerceSlots, type CommerceTask, type GenerationBatch, type TimelineItem } from '@zimage/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

// Keep the real workspace, task polling, and session status coordination. The
// image card only displays server state; this fixture never submits generation.
vi.mock('@/features/commerce/CommerceTaskCard', () => ({
  CommerceTaskCard: ({ task }: { task: CommerceTask }) => <div data-testid="settlement-task">{task.runs[0]?.items[0]?.status}</div>,
}));

describe('commerce settlement refresh', () => {
  setupWorkspaceTest();
  afterEach(() => vi.useRealTimers());

  async function fixture() {
    vi.useFakeTimers();
    const gateway = createTestGateway();
    const session = await gateway.createSession('结算刷新商品');
    const brief = { name: '陶瓷杯', facts: '', sellingPoints: '', platform: 'taobao' as const,
      placement: '商品展示', productReferenceIds: [crypto.randomUUID()], styleReferenceIds: [] };
    const slots = buildCommerceSlots(brief, 'product-main', 1, {
      provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '1:1', resolution: '2K',
    });
    const createdAt = new Date().toISOString();
    const batchId = crypto.randomUUID(), generationId = crypto.randomUUID();
    let task: CommerceTask = { id: crypto.randomUUID(), sessionId: session.id, revision: 1, createdAt, updatedAt: createdAt,
      brief, scene: 'product-main', templateId: 'soft-studio', slots, slotHashes: { [slots[0]!.id]: 'hash' },
      archived: false, selections: [], runs: [{ id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 1, createdAt,
        items: [{ slotId: slots[0]!.id, batchId, generationId, status: 'processing', compatibilityHash: 'hash', selectionVersion: 0 }] }] };
    let batch: GenerationBatch = { id: batchId, sessionId: session.id, source: 'direct', prompt: '商品主图',
      provider: 'seedream', model: 'doubao-seedream-5.0-pro', config: { count: 1, aspectRatio: '1:1', resolution: '2K' },
      createdAt, status: 'processing', assets: [{ id: generationId, status: 'processing' }] };
    const list = vi.spyOn(gateway.commerce, 'list').mockImplementation(async () => [task]);
    const timeline = vi.spyOn(gateway, 'getTimeline').mockImplementation(async (): Promise<TimelineItem[]> => [
      { id: crypto.randomUUID(), sessionId: session.id, sequence: 1, createdAt, type: 'generation', batch },
    ]);
    const sessions = vi.spyOn(gateway, 'listSessions');
    const quota = vi.spyOn(gateway, 'getQuota');
    const submit = vi.spyOn(gateway.commerce, 'submit');
    const changed = vi.fn(); window.addEventListener('zimage:credits-changed', changed);
    const view = render(<UnifiedWorkspace gateway={gateway} route={{ kind: 'session', sessionId: session.id, taskId: task.id, view: 'results' }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('settlement-task').textContent).toBe('processing');
    expect(screen.getAllByLabelText('结算刷新商品 正在处理').length).toBeGreaterThan(0);
    return { list, timeline, sessions, quota, submit, changed,
      update(status: 'succeeded' | 'failed', error?: string) {
        task = { ...task, runs: [{ ...task.runs[0]!, items: [{ ...task.runs[0]!.items[0]!, status, error }] }] };
        if (!error?.includes('unknown')) batch = { ...batch, status, assets: [{ id: generationId, status }] };
      },
      dispose() { view.unmount(); window.removeEventListener('zimage:credits-changed', changed); },
    };
  }

  it.each(['succeeded', 'failed'] as const)('refreshes wallet, quota, sessions and the busy timeline after polled %s', async status => {
    const f = await fixture();
    try {
      const before = { timeline: f.timeline.mock.calls.length, sessions: f.sessions.mock.calls.length, quota: f.quota.mock.calls.length };
      f.update(status);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(screen.getByTestId('settlement-task').textContent).toBe(status);
      expect(f.changed).toHaveBeenCalledTimes(1);
      expect(f.timeline.mock.calls.length).toBeGreaterThan(before.timeline);
      expect(f.sessions.mock.calls.length).toBeGreaterThan(before.sessions);
      expect(f.quota.mock.calls.length).toBeGreaterThan(before.quota);
      expect(screen.queryAllByLabelText('结算刷新商品 正在处理')).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(f.changed).toHaveBeenCalledTimes(1);
      expect(f.submit).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });

  it('keeps unknown results pending and reconciles a later confirmed result without resubmitting', async () => {
    const f = await fixture();
    try {
      f.update('failed', 'provider_result_unknown');
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(f.changed).not.toHaveBeenCalled();
      expect(screen.getAllByLabelText('结算刷新商品 正在处理').length).toBeGreaterThan(0);
      f.update('succeeded');
      fireEvent.click(screen.getByRole('button', { name: '手动刷新任务' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(f.changed).toHaveBeenCalledTimes(1);
      expect(screen.queryAllByLabelText('结算刷新商品 正在处理')).toHaveLength(0);
      expect(f.submit).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
});
