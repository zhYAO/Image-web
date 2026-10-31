import { act, render, screen } from '@testing-library/react';
import { buildCommerceSlots, IMAGE_PROVIDER_CAPABILITIES, type CommerceTask } from '@zimage/domain';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CommerceWorkspace, type CommerceWorkspaceHandle } from '@/features/commerce/CommerceWorkspace';
import { createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

vi.mock('@/features/commerce/CommerceTaskCard', () => ({
  CommerceTaskCard: ({ task }: { task: CommerceTask }) => <div data-testid="deep-link-task">{task.id}</div>,
}));

describe('commerce deep-link loading', () => {
  setupWorkspaceTest();
  const missing = '任务不存在或不属于此会话，请选择其他任务。';
  const sessionId = '10000000-0000-4000-8000-000000000001';
  function fixture() {
    const gateway = createTestGateway().commerce;
    const brief = { name: '杯子', facts: '', sellingPoints: '', platform: 'taobao' as const,
      placement: '商品展示', productReferenceIds: [], styleReferenceIds: [] };
    const settings = { provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '1:1' as const, resolution: '2K' as const };
    const slots = buildCommerceSlots(brief, 'product-set', 1, settings);
    const task: CommerceTask = { id: crypto.randomUUID(), sessionId, revision: 1, brief, slots,
      scene: 'product-set', templateId: 'soft-studio', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      archived: false, selections: [], runs: [], slotHashes: { [slots[0]!.id]: 'hash' } };
    let resolve!: (tasks: CommerceTask[]) => void;
    let reject!: (reason: Error) => void;
    vi.spyOn(gateway, 'list').mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    const props = { ref: createRef<CommerceWorkspaceHandle>(), gateway, requestedTaskId: task.id, routeDriven: true,
      capabilities: IMAGE_PROVIDER_CAPABILITIES, settings, references: [], items: [],
      onReferenceAdd: vi.fn(), onReferenceRemove: vi.fn(), onReferenceUploaded: vi.fn(), onReferencesAdopt: () => true,
      renderTimeline: (_items: unknown, _tail: boolean, _hasCommerce: boolean, loading: boolean) => loading ? <p>正在加载会话</p> : null };
    return { task, props, resolve: (tasks: CommerceTask[]) => resolve(tasks), reject: () => reject(new Error('暂时不可用')) };
  }

  it.each([true, false])('waits for session and task loading before deciding existence (exists: %s)', async exists => {
    const f = fixture();
    const view = render(<CommerceWorkspace {...f.props} timelineLoading />);
    try {
      expect(screen.queryByText(missing)).toBeNull();
      view.rerender(<CommerceWorkspace {...f.props} sessionId={sessionId} timelineLoading={false} />);
      await act(async () => {});
      expect(screen.queryByText(missing)).toBeNull();
      await act(async () => f.resolve(exists ? [f.task] : []));
      if (exists) {
        expect(screen.getByTestId('deep-link-task').textContent).toBe(f.task.id);
        expect(screen.queryByText(missing)).toBeNull();
      } else expect(screen.queryByText(missing)).not.toBeNull();
    } finally { view.unmount(); }
  });

  it('reports a failed task read without also claiming the task does not exist', async () => {
    const f = fixture();
    const view = render(<CommerceWorkspace {...f.props} sessionId={sessionId} timelineLoading={false} />);
    try {
      await act(async () => {});
      await act(async () => f.reject());
      expect(screen.queryByText(/电商任务加载失败：暂时不可用/)).not.toBeNull();
      expect(screen.queryByText(missing)).toBeNull();
    } finally { view.unmount(); }
  });
});
