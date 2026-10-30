import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ graph: vi.fn() }));
vi.mock('@/server/chat/chat-graph', () => ({ executeChatGraph: mocks.graph }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock('@/server/route-context', async () => {
  const { runTrackedRoute } = await import('@/server/lifecycle/request-lifecycle');
  return { executeRoute: (run: (id: string) => Promise<Response>) => runTrackedRoute(() => run('test-correlation')), assertTrustedOrigin: vi.fn(), requireVerifiedUserId: async () => '10000000-0000-4000-8000-000000000001', readJson: (r: Request) => r.json() };
});
vi.mock('@/server/chat/supabase-chat-store', () => ({ SupabaseChatStore: class {
  assertProviderAvailable = async () => true;
  start = async () => ({ created: false, session: { id: '10000000-0000-4000-8000-000000000002' } });
  history = async () => [];
} }));
vi.mock('@/server/credits/credit-service', () => ({ creditsEnabled: () => false }));
vi.mock('@/server/credits/billed-text', () => ({ billedChat: vi.fn() }));
vi.mock('@/server/preview/preview-usage-guard', () => ({ createPreviewUsageGuard: vi.fn(), withPreviewUsageReservation: (_g: unknown, _i: unknown, run: () => unknown) => run() }));
vi.mock('@/server/image/image-service', () => ({ createImageService: () => ({}) }));
vi.mock('@/server/image/supabase-generation-store', () => ({ SupabaseGenerationStore: class {} }));
import { POST } from '@/app/api/chat/route';
import { getDrainState } from '@/server/lifecycle/request-lifecycle';

it('the real chat handler retains its graph finalizer after client disconnect and terminal delivery', async () => {
  let release!: () => void;
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  const before = getDrainState().counters;
  mocks.graph.mockImplementation(async (_input, _runner, emit) => {
    await emit({ type: 'message.completed', messageId: crypto.randomUUID(), content: 'ok' });
    await cleanup;
  });
  const response = await POST(new Request('http://app.test/api/chat', { method: 'POST', body: JSON.stringify({ message: 'hello' }) }));
  const reader = response.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  await reader.cancel();
  expect(getDrainState().counters).toMatchObject({ activeStreams: before.activeStreams, pendingFinalizers: before.pendingFinalizers + 1 });
  release();
  await vi.waitFor(() => expect(getDrainState().counters).toEqual(before));
});
