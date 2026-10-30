import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@/server/apparel/apparel-renderer', () => ({ renderApparelPages: mocks.render }));
import { createApparelService } from '@/server/apparel/apparel-service';
import { getDrainState } from '@/server/lifecycle/request-lifecycle';
import { apparelFixture, apparelIds } from './apparel-fixtures';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('the real apparel service waits for the running renewal RPC after Sharp and Storage completion', async () => {
  vi.useFakeTimers();
  const before = getDrainState().counters;
  let finishRender!: () => void, finishRenewal!: () => void, enteredRender!: () => void;
  const entered = new Promise<void>(r => { enteredRender = r; });
  const rendering = new Promise<void>(r => { finishRender = r; });
  const renewal = new Promise<void>(r => { finishRenewal = r; });
  const task = { id: apparelIds[7]!, sessionId: apparelIds[7]!, engine: 'apparel-catalog', revision: 1, plan: apparelFixture, createdAt: '2026-10-06', updatedAt: '2026-10-06', runs: [], archived: false };
  mocks.render.mockImplementation(async function* () { enteredRender(); await rendering; });
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    if (args.p_operation === 'renew') await renewal;
    return { data: args.p_operation === 'submit' ? { claimed: true, runId: apparelIds[2], claimToken: apparelIds[3], plan: apparelFixture, task }
      : args.p_operation === 'sources' ? [] : task, error: null };
  });
  let settled = false;
  const request = createApparelService({ rpc, storage: { from: () => ({ download: vi.fn(), upload: vi.fn() }) } })
    .dispatch(apparelIds[0]!, 'submit', task.id, { requestId: apparelIds[1]!, revision: 1 }, apparelIds[2]!)
    .finally(() => { settled = true; });
  await entered;
  await vi.advanceTimersByTimeAsync(25001);
  expect(rpc.mock.calls.some(([, args]) => args.p_operation === 'renew')).toBe(true);
  finishRender();
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  expect(getDrainState().counters).toMatchObject({ activeRenders: before.activeRenders + 1, pendingFinalizers: before.pendingFinalizers + 1 });
  finishRenewal(); await request;
  expect(getDrainState().counters).toEqual(before);
});
