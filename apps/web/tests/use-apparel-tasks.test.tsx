import { renderHook, waitFor } from '@testing-library/react';
import type { ApparelGateway } from '@zimage/domain';
import { expect, it, vi } from 'vitest';
import { useApparelTasks } from '@/features/commerce/use-apparel-tasks';

it('loads a newly selected session while the previous session request is still pending', async () => {
  let resolveFirst!: (value: unknown[]) => void;
  const first = new Promise<unknown[]>(resolve => { resolveFirst = resolve; });
  const list = vi.fn((sessionId: string) => sessionId === 'first' ? first : Promise.resolve([]));
  const gateway = { list } as unknown as ApparelGateway;
  const view = renderHook(({ sessionId }) => useApparelTasks(gateway, sessionId),
    { initialProps: { sessionId: 'first' } });
  expect(list).toHaveBeenCalledWith('first');
  view.rerender({ sessionId: 'second' });
  await waitFor(() => expect(list).toHaveBeenCalledWith('second'));
  resolveFirst([]);
  await waitFor(() => expect(view.result.current.loading).toBe(false));
});
