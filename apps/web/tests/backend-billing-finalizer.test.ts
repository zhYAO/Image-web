import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ optimize: vi.fn(), record: vi.fn() }));
vi.mock('@/server/creative-text/creative-text-service', () => ({ optimizeCreativeText: mocks.optimize }));
vi.mock('@/server/chat/supabase-chat-store', () => ({ SupabaseChatStore: class {
  assertProviderAvailable = async () => true;
  recordProviderResult = mocks.record;
} }));
vi.mock('@/server/chat/chat-providers', () => ({ resolveChatProvider: () => ({}), ChatProviderFailure: class extends Error {}, streamOpenAiCompatibleChat: vi.fn() }));
vi.mock('@/server/credits/credit-service', () => ({
  creditCall: async () => ({ claimed: true }), startText: async () => ({ status: 'reserved' }), textStep: async () => ({}),
  creditFailure: () => new Error('credit failure'), pendingCreditError: () => new Error('pending'),
}));
vi.mock('@/server/preview/preview-usage-guard', () => ({ createPreviewUsageGuard: () => ({}), withPreviewUsageReservation: (_g: unknown, _i: unknown, run: () => unknown) => run() }));
import { billedOptimize } from '@/server/credits/billed-text';
import { getDrainState } from '@/server/lifecycle/request-lifecycle';
import type { CreativeTextOptimizeRequest } from '@zimage/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
afterEach(() => vi.clearAllMocks());

it.each([false, true])('retains delayed provider status RPC after optimize returns/fails (failure=%s)', async (failed) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  mocks.record.mockReturnValue(pending);
  if (failed) mocks.optimize.mockRejectedValue(new Error('provider interrupted'));
  else mocks.optimize.mockResolvedValue({ optimizedPrompt: 'ready' });
  const before = getDrainState().counters.pendingFinalizers;
  const operation = billedOptimize({} as SupabaseClient, crypto.randomUUID(), { requestId: crypto.randomUUID() } as CreativeTextOptimizeRequest, new Request('http://app.test/api/creative-text/optimize'));
  if (failed) await expect(operation).rejects.toThrow('pending'); else await operation;
  expect(getDrainState().counters.pendingFinalizers).toBe(before + 1);
  expect(mocks.record).toHaveBeenCalledWith('doubao', failed);
  release();
  await vi.waitFor(() => expect(getDrainState().counters.pendingFinalizers).toBe(before));
});
