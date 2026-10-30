import { File } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), promote: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.user }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));
vi.mock('@/server/assets/reference-promotion-service', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/assets/reference-promotion-service')>(),
  createReferencePromotionService: () => ({ promote: mocks.promote }),
}));
import { POST as promote } from '@/app/api/creative-tasks/[id]/promote/route';
import { POST as upload } from '@/app/api/uploads/route';
const userId = '10000000-0000-4000-8000-000000000001';
const taskId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const generationId = '40000000-0000-4000-8000-000000000001';
const context = { params: Promise.resolve({ id: taskId }) };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=', 'base64');
function request(origin: string | null = 'https://app.test', body: unknown = { requestId, generationId }) {
  return new Request(`https://app.test/api/creative-tasks/${taskId}/promote`, {
    method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: userId, error: null }) });
  mocks.admin.mockReturnValue({});
});
afterEach(() => vi.unstubAllGlobals());
describe('promotion protected HTTP boundary', () => {
  it.each([null, 'https://untrusted.test'])('rejects untrusted origin %s before auth or Storage', async origin => {
    expect((await promote(request(origin), context)).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('requires a verified live login', async () => {
    mocks.user.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ status: 401, data: null, error: { code: '42501' } }) });
    expect((await promote(request(), context)).status).toBe(401);
    expect(mocks.promote).not.toHaveBeenCalled();
  });
  it('rejects non-UUID input', async () => {
    expect((await promote(request('https://app.test', { requestId, generationId: 'https://source.test/image.png' }), context)).status).toBe(400);
    expect(mocks.promote).not.toHaveBeenCalled();
  });
  it('returns the exact four-field contract and passes the verified identity', async () => {
    const result = { id: requestId, name: 'reference.png', mimeType: 'image/png', size: 68 };
    mocks.promote.mockResolvedValue({ ...result, storagePath: 'private/path' });
    const response = await promote(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.promote).toHaveBeenCalledWith(userId, taskId, { requestId, generationId }, expect.any(String));
  });
});
function uploadFixture(count: number, fail?: 'register' | 'finalize' | 'unconfirmed-register') {
  const sequence: string[] = [];
  const userTable = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: taskId }, error: null }),
    or: vi.fn().mockResolvedValue({ count, error: null }),
  };
  mocks.user.mockResolvedValue({
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: userId } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: userId, error: null }), from: () => userTable,
  });
  const insert = vi.fn((row: Record<string, unknown>) => {
    sequence.push('metadata');
    return { select: () => ({ single: async () => ({ data: { ...row, upload_expires_at: '2026-10-01T00:00:00Z' }, error: null }) }) };
  });
  const admin = {
    from: () => ({ insert, delete: () => { sequence.push('delete_metadata'); return { eq: () => ({ eq: async () => ({ error: null }) }) }; } }),
    rpc: vi.fn(async (name: string, input: Record<string, unknown>) => {
      const operation = name === 'reference_write_intent' ? String(input.p_operation) : name;
      sequence.push(operation);
      return { data: operation === 'abandon' ? { remove: true }
        : operation === 'finalize' ? { id: input.p_reference_id, name: 'reference.png', mimeType: 'image/png', size: 68 }
          : operation === 'register' && fail === 'unconfirmed-register' ? false : true, error: fail === operation ? { message: 'unavailable' } : null };
    }),
    storage: { from: () => ({
      upload: vi.fn(async () => { sequence.push('upload'); return { error: null }; }),
      remove: vi.fn(async () => { sequence.push('remove'); return { error: null }; }),
    }) },
  };
  mocks.admin.mockReturnValue(admin);
  vi.stubGlobal('File', File);
  const prefix = new TextEncoder().encode(`--reference-fixture\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${taskId}\r\n--reference-fixture\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`);
  const suffix = new TextEncoder().encode('\r\n--reference-fixture--\r\n');
  const req = new Request('https://app.test/api/uploads', {
    method: 'POST', duplex: 'half',
    headers: { origin: 'https://app.test', 'content-type': 'multipart/form-data; boundary=reference-fixture' },
    body: new ReadableStream({ start(controller) { controller.enqueue(prefix); controller.enqueue(png); controller.enqueue(suffix); controller.close(); } }),
  } as RequestInit);
  return { run: () => upload(req), sequence, insert };
}
describe('ordinary uploads share durable reference intents', () => {
  it('accepts a fifth history reference and registers before upload and finalizes before response', async () => {
    const f = uploadFixture(4);
    const response = await f.run();
    expect(response.status).toBe(201);
    expect(f.sequence).toEqual(['reserve_preview_usage', 'metadata', 'register', 'upload', 'finalize', 'commit_preview_usage']);
    expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
  });
  it('rejects the 65th retained reference', async () => {
    const f = uploadFixture(64);
    const response = await f.run();
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('64');
    expect(f.sequence).toEqual([]);
  });
  it.each(['register', 'unconfirmed-register'] as const)('does no object upload when intent registration fails: %s', async failure => {
    const f = uploadFixture(0, failure);
    expect((await f.run()).status).toBe(503);
    expect(f.sequence).toEqual(['reserve_preview_usage', 'metadata', 'register', 'delete_metadata', 'release_preview_usage']);
  });
  it('leaves durable abandonment before removing a failed finalization object', async () => {
    const f = uploadFixture(0, 'finalize');
    expect((await f.run()).status).toBe(503);
    expect(f.sequence.slice(-4)).toEqual(['finalize', 'abandon', 'remove', 'release_preview_usage']);
  });
});
