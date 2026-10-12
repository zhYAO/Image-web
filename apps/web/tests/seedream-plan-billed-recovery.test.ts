import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashCanonicalRequest } from '@/server/image/image-service';
import { creditFailure } from '@/server/credits/credit-service';

const guard = vi.hoisted(() => ({ reserve: vi.fn(async (_guard: unknown, _input: unknown, run: () => Promise<unknown>) => run()) }));
vi.mock('@/server/preview/preview-usage-guard', () => ({ createPreviewUsageGuard: () => ({}), withPreviewUsageReservation: guard.reserve }));
import { billedChat } from '@/server/credits/billed-text';

async function legacyFixture(model: string) {
  const userId = crypto.randomUUID(), requestId = crypto.randomUUID(), sessionId = crypto.randomUUID(), batchId = crypto.randomUUID(), toolMessageId = crypto.randomUUID();
  const provider = model.startsWith('gemini') ? 'gemini' : 'seedream';
  const input = { requestId, message: '生成原商品图片', imageProvider: provider, tools: ['generate_image'] as ('generate_image')[], billing: { version: '2026-10-06.1', totalMinor: provider === 'gemini' ? 80 : 30 } };
  const config = { aspectRatio: '1:1' as const, count: 1, resolution: '2K' as const, registryVersion: '2026-10-06.1' };
  const requestHash = await hashCanonicalRequest({ config, model, provider, prompt: input.message, source: 'chat_tool', userId });
  const snapshot = { id: batchId, session_id: sessionId, config, model, provider, request_hash: requestHash, skill_id: null, skill_version: null, source: 'chat_tool' };
  let exists = true, active = true;
  const expected = { config, idempotencyKey: requestId, model, prompt: input.message, provider, requestHash, source: 'chat_tool', userId, requestId, chatMessage: input.message };
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const payload = args.p_input as Record<string, unknown>;
    const { billing: _billing, correlationId: _correlation, ...material } = payload;
    void _billing; void _correlation;
    if (exists && args.p_action === 'image' && await hashCanonicalRequest(material) === await hashCanonicalRequest(expected)) return { data: { batchId, sessionId, toolMessageId, status: 'pending', deduplicated: true }, error: null };
    return { data: null, error: { message: exists ? 'idempotency_conflict' : 'credit_price_changed' } };
  });
  const from = (table: string) => {
    const filters = new Map<string, unknown>();
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.set(key, value); return query; }, maybeSingle: async () => ({ data: table === 'generation_batches' ? exists && filters.get('user_id') === userId && filters.get('idempotency_key') === requestId ? snapshot : null : active && filters.get('user_id') === userId && filters.get('id') === sessionId ? { id: sessionId } : null, error: null }) };
    return query;
  };
  return { userId, input, batchId, toolMessageId, rpc, admin: { rpc, from } as unknown as SupabaseClient, missing: () => { exists = false; }, inactive: () => { active = false; } };
}

describe('billed chat image recovery across the Plan cutover', () => {
  it.each(['seedream-5.0-flash', 'seedream-5.0-pro', 'gemini-3-pro-image'])('recovers the original %s batch and assistant receipt without preview reservation', async model => {
    guard.reserve.mockClear();
    const f = await legacyFixture(model);
    const response = await billedChat(f.admin, f.userId, f.input, new Request('http://localhost/api/chat'), crypto.randomUUID());
    const body = await response.text();
    expect(body).toContain(f.batchId);
    expect(body).toContain(f.toolMessageId);
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(guard.reserve).not.toHaveBeenCalled();
  });

  it.each(['message', 'references', 'intent', 'skill'])('rejects changed %s on the same committed request before any mutation', async change => {
    const f = await legacyFixture('seedream-5.0-pro');
    const input = { ...f.input, ...(change === 'message' ? { message: '生成另一商品图片' } : change === 'references' ? { images: [crypto.randomUUID()] } : change === 'intent' ? { tools: [] } : { skillId: 'white-background' }) };
    await expect(billedChat(f.admin, f.userId, input, new Request('http://localhost/api/chat'), crypto.randomUUID())).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('does not recover a missing retired Gemini request or an inactive session', async () => {
    const missing = await legacyFixture('gemini-3-pro-image'); missing.missing();
    await expect(billedChat(missing.admin, missing.userId, missing.input, new Request('http://localhost/api/chat'), crypto.randomUUID())).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    expect(missing.rpc).not.toHaveBeenCalled();
    const inactive = await legacyFixture('seedream-5.0-pro'); inactive.inactive();
    await expect(billedChat(inactive.admin, inactive.userId, inactive.input, new Request('http://localhost/api/chat'), crypto.randomUUID())).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(inactive.rpc).not.toHaveBeenCalled();
  });

  it.each(['image_model_unavailable', 'image_model_upgrade_required'])('maps %s to a definite model update rejection', message => {
    expect(creditFailure({ message })).toMatchObject({ code: 'bad_request', status: 400, retryable: false, message: expect.stringContaining('主动更新') });
  });
});
