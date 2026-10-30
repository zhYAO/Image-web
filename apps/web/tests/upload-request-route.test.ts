import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), validate: vi.fn(), intent: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.user }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock('@/server/assets/reference-upload-service', () => ({ validateReferenceUpload: mocks.validate }));
vi.mock('@/server/assets/reference-promotion-service', () => ({ referenceWriteIntent: mocks.intent, compensateReferenceWrite: vi.fn() }));
vi.mock('@/server/preview/preview-usage-guard', () => ({ createPreviewUsageGuard: () => ({}), withPreviewUsageReservation: (_g: unknown, _i: unknown, run: () => unknown) => run() }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));
import { POST } from '@/app/api/uploads/route';
import { getUploadBudgetState, MAX_UPLOAD_BODY_BYTES } from '@/server/assets/upload-request-budget';
import { getDrainState, lifecycle, MaintenanceError } from '@/server/lifecycle/request-lifecycle';

const userId = '00000000-0000-4000-8000-000000000001', sessionId = '00000000-0000-4000-8000-000000000002';
beforeEach(() => {
  vi.stubGlobal('File', NodeFile);
  mocks.user.mockReset(); mocks.admin.mockReset(); mocks.validate.mockReset(); mocks.intent.mockReset();
  const chain = { select: vi.fn(), eq: vi.fn(), or: vi.fn(), maybeSingle: async () => ({ data: { id: sessionId }, error: null }) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.or.mockResolvedValue({ count: 0, error: null });
  mocks.user.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: userId } }, error: null }) }, rpc: async () => ({ data: userId, error: null }), from: () => chain });
  const persisted = { id: crypto.randomUUID(), mime_type: 'image/png', original_filename: 'reference.png', size_bytes: 1, width: 1, height: 1, upload_expires_at: new Date(Date.now() + 60000).toISOString() };
  mocks.admin.mockReturnValue({ from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: persisted, error: null }) }) }) }), storage: { from: () => ({ upload: async () => ({ error: null }) }) } });
  mocks.validate.mockResolvedValue({ extension: 'png', width: 1, height: 1 });
  mocks.intent.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function upload(bytes = new Uint8Array([1]), origin = 'http://app.test') {
  const prefix = new TextEncoder().encode(`--test\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${sessionId}\r\n--test\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`);
  const suffix = new TextEncoder().encode('\r\n--test--\r\n');
  return new Request('http://app.test/api/uploads', { method: 'POST', duplex: 'half', headers: { origin, 'content-type': 'multipart/form-data; boundary=test' }, body: new ReadableStream({ start(c) { c.enqueue(prefix); c.enqueue(bytes); c.enqueue(suffix); c.close(); } }) } as RequestInit);
}

it('enforces Origin and maintenance before SDK, parsing, bytes or Storage', async () => {
  expect((await POST(upload(undefined, 'http://untrusted.test'))).status).toBe(403);
  vi.spyOn(lifecycle, 'admission').mockImplementation(() => { throw new MaintenanceError(); });
  const response = await POST(upload());
  expect(response.status).toBe(503); expect(response.headers.get('retry-after')).toBe('30');
  expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  expect(getUploadBudgetState().activeUploads).toBe(0);
});

it('rejects actual oversized input before Sharp, quota reservation or Storage', async () => {
  const response = await POST(upload(new Uint8Array(MAX_UPLOAD_BODY_BYTES)));
  expect(response.status).toBe(413);
  expect(mocks.validate).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(getUploadBudgetState().activeUploads).toBe(0));
});

it('holds the real upload route and slot until Storage finalization completes', async () => {
  let release!: () => void, entered!: () => void;
  const finish = new Promise<void>(r => { release = r; });
  const finalizing = new Promise<void>(r => { entered = r; });
  const before = getDrainState().counters.activeMutations;
  mocks.intent.mockImplementation(async (_admin, _user, _upload, stage) => { if (stage === 'finalize') { entered(); await finish; } });
  const request = POST(upload());
  await finalizing;
  expect(getUploadBudgetState().activeUploads).toBe(1);
  expect(getDrainState().counters.activeMutations).toBe(before + 1);
  release(); const response = await request;
  expect(response.status).toBe(201);
  await vi.waitFor(() => expect(getUploadBudgetState().activeUploads).toBe(0));
  expect(getDrainState().counters.activeMutations).toBe(before);
});
