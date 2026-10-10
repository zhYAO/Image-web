import { buildCommerceSlots } from '@zimage/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  client: {} as object,
  sign: vi.fn(async () => ({ data: { signedUrl: 'https://synthetic.invalid/signed' }, error: null })),
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => boundary.client }));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: boundary.sign }) } }),
}));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));

import { GET as generationUrl } from '@/app/api/generations/[id]/asset-url/route';
import { GET as referenceUrl } from '@/app/api/references/[id]/asset-url/route';
import { GET as imageBatch } from '@/app/api/image/[id]/route';
import { getCreativeBatch, getCreativeBatchProgress, listCreativeBatches } from '@/server/commerce/commerce-batch-service';

const userId = 'a5000000-0000-4000-8000-000000000001';
const otherUserId = 'a5000000-0000-4000-8000-000000000002';
const sessionId = 'a5000000-0000-4000-8000-000000000011';
const batchId = 'a5000000-0000-4000-8000-000000000021';
const generationId = 'a5000000-0000-4000-8000-000000000031';
const referenceId = 'a5000000-0000-4000-8000-000000000041';
const createdAt = '2026-10-08T00:00:00Z';

// Supabase DB/Auth/Storage boundaries are mocked, not the guards or handlers.
// Child rows intentionally remain visible after the business parent deletes;
// PostgreSQL policy enforcement is separately covered by database fixtures.
function fixture(options: { status?: string; owner?: string; verified?: boolean; failSessionRead?: boolean } = {}) {
  const brief = { name: '历史商品', facts: '', sellingPoints: '', platform: 'taobao' as const,
    placement: '商品展示', productReferenceIds: [referenceId], styleReferenceIds: [] };
  const settings = { provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '1:1' as const, resolution: '2K' as const };
  const batch = { id: batchId, user_id: userId, session_id: sessionId, request_id: crypto.randomUUID(),
    request_hash: 'history', workflow: 'product-set', global_params: {}, created_at: createdAt,
    updated_at: createdAt, lease_token: null, next_attempt_at: null,
    items: [{ id: crypto.randomUUID(), createRequestId: crypto.randomUUID(), submitRequestId: crypto.randomUUID(),
      status: 'submitted', overrides: {}, plan: { scene: 'product-set', brief, templateId: 'soft-studio',
        slots: buildCommerceSlots(brief, 'product-set', 1, settings) } }] };
  const rows: Record<string, Array<Record<string, unknown>>> = {
    sessions: [{ id: sessionId, user_id: options.owner ?? userId, status: options.status ?? 'active' }],
    creative_batches: [batch],
    generation_batches: [{ id: batchId, user_id: userId, session_id: sessionId, created_at: createdAt,
      config: { aspectRatio: '1:1', count: 1, resolution: '2K' }, provider: 'gemini', model: settings.model,
      prompt: '历史图片', source: 'direct', status: 'succeeded', assets: [{ id: generationId,
        status: 'succeeded', asset_status: 'active', asset_expires_at: '2099-01-01T00:00:00Z', error_code: null }] }],
    generations: [{ id: generationId, batch_id: batchId, status: 'succeeded', asset_status: 'active',
      asset_expires_at: '2099-01-01T00:00:00Z', storage_bucket: 'generated', storage_path: 'synthetic/generated.png' }],
    reference_uploads: [{ id: referenceId, user_id: userId, session_id: sessionId, status: 'active',
      upload_expires_at: '2099-01-01T00:00:00Z', storage_bucket: 'uploads', storage_path: 'synthetic/reference.png' }],
  };
  const progress = { id: batchId, createdAt, updatedAt: createdAt,
    items: [{ id: batch.items[0]!.id, status: 'submitted', total: 1, succeeded: 1, failed: 0, processing: 0, review: 0 }] };
  const rpc = vi.fn(async (name: string) => name === 'require_verified_user_id'
    ? options.verified === false ? { data: null, error: { message: 'unauthorized' } } : { data: userId, error: null }
    : { data: progress, error: null });
  const client = { rpc, from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const result = () => ({
      data: (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)),
      error: table === 'sessions' && options.failSessionRead ? { message: 'read unavailable' } : null,
    });
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      order: () => query,
      limit: () => query,
      maybeSingle: async () => { const value = result(); return { ...value, data: value.data[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } };
  return { client, batch, rpc };
}

beforeEach(() => { boundary.sign.mockClear(); boundary.client = fixture().client; });

describe.each([
  ['generation URL', generationUrl, generationId],
  ['reference URL', referenceUrl, referenceId],
  ['image history', imageBatch, batchId],
] as const)('%s parent session boundary', (_name, handler, id) => {
  const call = () => handler(new Request('https://synthetic.invalid/api/history'), { params: Promise.resolve({ id }) });
  it('keeps active owner historical content available', async () => {
    expect((await call()).status).toBe(200);
  });
  it('rejects a new request after business deletion without signing', async () => {
    boundary.client = fixture({ status: 'deleting' }).client;
    expect((await call()).status).toBe(404);
    expect(boundary.sign).not.toHaveBeenCalled();
  });
  it('rejects a child pointing at another owner business session', async () => {
    boundary.client = fixture({ owner: otherUserId }).client;
    expect((await call()).status).toBe(404);
    expect(boundary.sign).not.toHaveBeenCalled();
  });
  it('rejects revoked login before any Storage signing', async () => {
    boundary.client = fixture({ verified: false }).client;
    expect((await call()).status).toBe(401);
    expect(boundary.sign).not.toHaveBeenCalled();
  });
});

describe.each([
  ['get', (client: object) => getCreativeBatch(client as never, userId, batchId)],
  ['list', (client: object) => listCreativeBatches(client as never, userId, sessionId)],
  ['progress', (client: object) => getCreativeBatchProgress(client as never, userId, batchId)],
] as const)('admin legacy batch %s', (_name, read) => {
  it('keeps the active owner history available', async () => {
    await expect(read(fixture().client)).resolves.toBeDefined();
  });
  it('denies deleted business parent despite admin bypass', async () => {
    await expect(read(fixture({ status: 'deleting' }).client)).rejects.toMatchObject({ status: 404 });
  });
  it('denies a business parent owned by a different user', async () => {
    await expect(read(fixture({ owner: otherUserId }).client)).rejects.toMatchObject({ status: 404 });
  });
  it('fails closed when parent verification cannot complete', async () => {
    await expect(read(fixture({ failSessionRead: true }).client)).rejects.toMatchObject({ status: 404 });
  });
});
