import { act, fireEvent, render, screen } from '@testing-library/react';
import type { GenerationBatch, TimelineItem } from '@zimage/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnifiedWorkspace } from '@/features/workspace/UnifiedWorkspace';
import { createTestGateway, setupWorkspaceTest } from './workspace-test-fixtures';

describe('image settlement wallet refresh', () => {
  setupWorkspaceTest();
  afterEach(() => vi.useRealTimers());

  async function fixture(expired = false) {
    vi.useFakeTimers();
    const gateway = createTestGateway();
    const session = await gateway.createSession('普通图片结算');
    const createdAt = new Date(Date.now() - (expired ? 3_600_001 : 0)).toISOString();
    const generationId = crypto.randomUUID();
    let batch: GenerationBatch = { id: crypto.randomUUID(), sessionId: session.id, source: 'direct', prompt: '陶瓷杯商品图',
      provider: 'seedream', model: 'doubao-seedream-5.0-pro', config: { count: 1, aspectRatio: '1:1', resolution: '2K' },
      createdAt, status: 'processing', assets: [{ id: generationId, status: 'processing' }] };
    const initial = batch;
    vi.spyOn(gateway.commerce, 'list').mockResolvedValue([]);
    vi.spyOn(gateway, 'getTimeline').mockImplementation(async (): Promise<TimelineItem[]> => [
      { id: crypto.randomUUID(), sessionId: session.id, sequence: 1, createdAt, type: 'generation', batch: initial },
    ]);
    const read = vi.spyOn(gateway, 'getGenerationBatch').mockImplementation(async () => batch);
    const submit = vi.spyOn(gateway, 'submitImage');
    const recreate = vi.spyOn(gateway, 'recreateGeneration');
    const changed = vi.fn(); window.addEventListener('zimage:credits-changed', changed);
    const view = render(<UnifiedWorkspace gateway={gateway} route={{ kind: 'session', sessionId: session.id }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getAllByLabelText('普通图片结算 正在处理').length).toBeGreaterThan(0);
    return { read, submit, recreate, changed,
      settle(status: 'succeeded' | 'failed') { batch = { ...batch, status, assets: [{ id: generationId, status }] }; },
      dispose() { view.unmount(); window.removeEventListener('zimage:credits-changed', changed); },
    };
  }

  it.each(['succeeded', 'failed'] as const)('refreshes credits once after polling %s without another paid request', async status => {
    const f = await fixture();
    try {
      f.settle(status);
      // Let React commit the first terminal response before advancing again;
      // the supplied mock gateway uses the existing 300 ms preview interval.
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.changed).toHaveBeenCalledTimes(1);
      expect(screen.queryAllByLabelText('普通图片结算 正在处理')).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.changed).toHaveBeenCalledTimes(1);
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.recreate).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });

  it('refreshes credits after a manual read settles an old task', async () => {
    const f = await fixture(true);
    try {
      f.settle('succeeded');
      fireEvent.click(screen.getByRole('button', { name: '手动刷新进度' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.changed).toHaveBeenCalledTimes(1);
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.recreate).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
});
