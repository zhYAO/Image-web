import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreativeTextOptimizeRequest } from '@zimage/domain';

const provider = vi.hoisted(() => ({ output: '', calls: 0, fail: false }));
vi.mock('@/server/chat/chat-providers', () => ({
  resolveChatProvider: () => ({}),
  ChatProviderFailure: class extends Error {},
  streamOpenAiCompatibleChat: async function* () {
    provider.calls++;
    if (provider.fail) throw new Error('unknown upstream result');
    yield JSON.stringify({ text: provider.output });
  },
}));
vi.mock('@/server/preview/preview-usage-guard', () => ({
  createPreviewUsageGuard: () => ({}),
  withPreviewUsageReservation: async (_guard: unknown, _input: unknown, work: () => Promise<unknown>) => work(),
}));
import { billedOptimize } from '@/server/credits/billed-text';

function fixture() {
  let operation: Record<string, unknown> | undefined;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'assert_chat_provider_available' || name === 'record_chat_provider_result') return { data: true, error: null };
    const input = args.p_input as Record<string, unknown>;
    if (args.p_action === 'text_start') operation ??= { id: crypto.randomUUID(), status: 'reserved', result: null, started: null, session_id: null };
    if (args.p_action === 'text_claim') { operation!.status = 'processing'; return { data: { claimed: true }, error: null }; }
    if (args.p_action === 'text_result') Object.assign(operation!, { status: 'result', result: input.result });
    if (args.p_action === 'text_complete') operation!.status = 'succeeded';
    if (args.p_action === 'text_refund') operation!.status = 'refunded';
    if (args.p_action === 'text_unknown') operation!.status = 'needs_review';
    return { data: structuredClone(operation), error: null };
  });
  const input: CreativeTextOptimizeRequest = {
    requestId: crypto.randomUUID(), field: 'strategy', text: '模块：品牌首屏、核心卖点',
    expectedModules: ['品牌首屏', '核心卖点'], productContext: { facts: 'A100 陶瓷杯，容量 500毫升' },
    billing: { version: '2026-10-12.1', totalMinor: 5 },
  };
  const admin = { rpc } as unknown as SupabaseClient;
  const user = crypto.randomUUID();
  return { rpc, input, operation: () => operation, run: () => billedOptimize(admin, user, input, new Request('http://localhost/api/creative-text/optimize')) };
}

beforeEach(() => { provider.calls = 0; provider.fail = false; });
describe('commerce copy settles only usable model output', () => {
  it.each([
    { strategy: '简洁留白' },
    { strategy: '简洁留白', modules: [{ name: '品牌首屏', copy: 'A100 陶瓷杯' }] },
    { strategy: '简洁留白', modules: [{ name: '品牌首屏', copy: 'A100 陶瓷杯' }, { name: '核心卖点', copy: '500千克' }] },
  ])('refunds completed invalid output without storing or capturing it %#', async result => {
    provider.output = JSON.stringify(result);
    const f = fixture();
    await expect(f.run()).rejects.toMatchObject({ code: 'provider_error' });
    expect(f.operation()?.status).toBe('refunded');
    expect(f.rpc.mock.calls.some(([, args]) => ['text_result', 'text_complete'].includes(String(args.p_action)))).toBe(false);
    expect(provider.calls).toBe(1);
  });

  it('captures and replays one valid legacy response without a second model request', async () => {
    provider.output = JSON.stringify({ strategy: '简洁留白', modules: [{ name: '品牌首屏', copy: 'A100 陶瓷杯' }, { name: '核心卖点', copy: '500毫升' }] });
    const f = fixture();
    delete f.input.expectedModules;
    expect((await f.run()).text).toBe(provider.output);
    expect((await f.run()).text).toBe(provider.output);
    expect(f.operation()?.status).toBe('succeeded');
    expect(provider.calls).toBe(1);
  });

  it('keeps an interrupted provider call pending instead of treating it as invalid output', async () => {
    provider.fail = true;
    const f = fixture();
    await expect(f.run()).rejects.toMatchObject({ code: 'billing_pending' });
    expect(f.operation()?.status).toBe('needs_review');
    await expect(f.run()).rejects.toMatchObject({ code: 'billing_pending' });
    expect(provider.calls).toBe(1);
  });
});
