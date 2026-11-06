import type { ChatEvent } from '@zimage/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ graph: vi.fn(), rpc: vi.fn() }));
vi.mock('@/server/chat/chat-providers',()=>({resolveChatProvider:()=>({edgeRelay:false}),streamOpenAiCompatibleChat:vi.fn()}));
vi.mock('@/server/chat/chat-graph', () => ({ executeChatGraph: mocks.graph }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/server/route-context', () => ({
  executeRoute: (run: (id: string) => unknown) => run('test-correlation'),
  assertTrustedOrigin: vi.fn(), requireVerifiedUserId: async () => '10000000-0000-4000-8000-000000000001',
  readJson: (request: Request) => request.json(),
}));
vi.mock('@/server/chat/supabase-chat-store', () => ({
  SupabaseChatStore: class {
    assertProviderAvailable = async () => true;
    start = async () => ({ created: false, session: { id: '10000000-0000-4000-8000-000000000002' } });
    history = async () => [];
  },
}));
vi.mock('@/server/preview/preview-usage-guard', () => ({
  createPreviewUsageGuard: vi.fn(),
  withPreviewUsageReservation: (_guard: unknown, _input: unknown, run: () => unknown) => run(),
}));
vi.mock('@/server/image/image-service', () => ({ createImageService: () => ({}) }));
vi.mock('@/server/image/supabase-generation-store', () => ({ SupabaseGenerationStore: class {} }));

import { POST } from '@/app/api/chat/route';

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe('chat route terminal events', () => {
  it.each(['message.completed', 'stream.failed'] as const)('does not append another failure after %s when the graph fails during cleanup', async (type) => {
    const terminal: ChatEvent = type === 'message.completed'
      ? { type, messageId: crypto.randomUUID(), content: '完整回复' }
      : { type, error: { code: 'STREAM_INTERRUPTED', message: '真实中断', retryable: false } };
    mocks.graph.mockImplementation(async (_input, _runner, emit) => { await emit(terminal); throw new Error('private-prompt-and-secret'); });
    const response = await POST(new Request('http://app.test/api/chat', { method: 'POST', body: JSON.stringify({ message: '你好', chatModel: 'doubao' }) }));
    const events = (await response.text()).trim().split('\n\n').map((frame) => JSON.parse(frame.slice(6)));
    expect(events).toEqual([terminal]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-prompt-and-secret');
  });

  it('emits a single failure when the graph fails before any terminal event', async () => {
    mocks.graph.mockRejectedValue(new Error('private-detail'));
    const response = await POST(new Request('http://app.test/api/chat', { method: 'POST', body: JSON.stringify({ message: '你好' }) }));
    const events = (await response.text()).trim().split('\n\n');
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.slice(6))).toMatchObject({ type: 'stream.failed', error: { code: 'NETWORK' } });
  });
});

it('rejects unbilled OpenAI before creating a session or forwarding history',async()=>{
 vi.stubEnv('ZIMAGE_CREDITS_ENABLED','false');try{await expect(POST(new Request('http://app.test/api/chat',{method:'POST',body:JSON.stringify({message:'x',chatModel:'gpt-6-astra'})}))).rejects.toMatchObject({status:503});expect(mocks.graph).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
});
