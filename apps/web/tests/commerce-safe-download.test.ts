import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { POST } from '@/app/api/creative-tasks/[id]/download/route';
import { safeExportIds as ids, safeExportTask } from './commerce-safe-export-fixtures';

const boundary = vi.hoisted(() => ({ rpc: vi.fn(), verified: vi.fn(), signed: vi.fn(), generation: vi.fn(), upload: vi.fn(), invoke: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ rpc: boundary.verified }) }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({
  rpc: boundary.rpc,
  from: () => ({ select: () => ({ eq: () => ({ single: boundary.generation }) }) }),
  storage: { from: () => ({ createSignedUrl: boundary.signed, upload: boundary.upload }) },
  functions: { invoke: boundary.invoke },
}) }));

describe('authorized EC03 safe download (local RPC/Storage mocks, real Sharp)', () => {
  let task = safeExportTask();
  let source: Buffer;
  let fetcher: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.clearAllMocks();
    task = safeExportTask();
    source = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#123456' } }).png().toBuffer();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
    boundary.verified.mockResolvedValue({ data: ids.user, error: null });
    boundary.rpc.mockImplementation(async (name, args) => {
      if (name !== 'commerce_dispatch' || !['get', 'export'].includes(args.p_operation)) throw new Error('unexpected_operation');
      if (args.p_user_id !== ids.user || args.p_task_id !== ids.task) throw new Error('unexpected_owner');
      return { error: null, data: args.p_operation === 'get' ? task : { id: ids.request, revision: 1, createdAt: 'now', items: args.p_input.selections } };
    });
    boundary.generation.mockResolvedValue({ error: null, data: { storage_bucket: 'generated', storage_path: 'private/original.png', asset_status: 'active', asset_expires_at: '2099-01-01' } });
    boundary.signed.mockResolvedValue({ error: null, data: { signedUrl: 'https://synthetic.invalid/storage/v1/object/sign/generated/private/original.png?token=synthetic' } });
    fetcher = vi.fn(async (url: URL) => {
      if (url.origin !== 'https://synthetic.invalid' || !url.pathname.includes('/storage/v1/object/sign/')) throw new Error('unexpected_network_or_model_call');
      return new Response(Buffer.from(source), { headers: { 'content-length': String(source.length) } });
    });
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  function request(overrides: Record<string, unknown> = {}, origin = 'http://localhost', engine = '') {
    return new Request(`http://localhost/api/creative-tasks/${ids.task}/download${engine}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: ids.request, revision: 1, selections: [{ slotId: ids.slot, generationId: ids.generation }], mode: 'single', format: 'png', safeExport: 'ec03-white-8', ...overrides }) });
  }
  const context = () => ({ params: Promise.resolve({ id: ids.task }) });
  function assertNoExternalWritesOrGeneration() {
    expect(boundary.upload).not.toHaveBeenCalled();
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.rpc.mock.calls.every(([name, args]) => name === 'commerce_dispatch' && ['get', 'export'].includes(args.p_operation) && args.p_compiled.length === 0)).toBe(true);
  }

  it('returns a safe PNG using the authorized current selection and exactly one source read', async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toContain('safe');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { data, info } = await sharp(new Uint8Array(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([300, 400]);
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(boundary.signed).toHaveBeenCalledTimes(1);
    expect(boundary.rpc.mock.calls.map(([, args]) => args.p_operation)).toEqual(['get', 'export']);
    assertNoExternalWritesOrGeneration();
  });

  it.each([{ mode: 'zip' }, { mode: 'long' }, { format: 'jpg' }, { safeExport: 'unknown' }, { selections: [{ slotId: ids.slot, generationId: ids.generation }, { slotId: ids.slot, generationId: ids.generation }] }])('rejects unsupported request %j before export or source access', async overrides => {
    expect((await POST(request(overrides), context())).status).toBe(400);
    expect(boundary.rpc.mock.calls.filter(([, args]) => args.p_operation === 'export')).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
    assertNoExternalWritesOrGeneration();
  });

  it.each(['soft-studio', 'detail-hero', 'xhs-fresh'])('rejects other template %s before source access', async templateId => {
    task.templateId = templateId;
    expect((await POST(request(), context())).status).toBe(400);
    expect(boundary.rpc).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ outputSpec: 'standard' as const }, { outputSpec: 'desktop' as const }, { outputSpec: 'mobile' as const }, { targetWidth: 970 }, { targetHeight: 600 }])('rejects A+ metadata %j without crop fallback', async metadata => {
    Object.assign(task.slots[0]!, metadata);
    expect((await POST(request(), context())).status).toBe(400);
    expect(boundary.signed).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a generation that is not the current selection before export', async () => {
    expect((await POST(request({ selections: [{ slotId: ids.slot, generationId: ids.request }] }), context())).status).toBe(409);
    expect(boundary.rpc).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects absent or failed current candidates', async () => {
    task.runs = [];
    expect((await POST(request(), context())).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects stale revision before writing an export manifest', async () => {
    task.revision = 2;
    expect((await POST(request(), context())).status).toBe(409);
    expect(boundary.rpc).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps the explicitly requested snapshot when a later selection changes during export', async () => {
    const originalRpc = boundary.rpc.getMockImplementation()!;
    boundary.rpc.mockImplementation(async (name, args) => {
      // A later selection does not change the A bound to this download request.
      if (args.p_operation === 'export') task.selections[0]!.generationId = ids.request;
      return originalRpc(name, args);
    });
    expect((await POST(request(), context())).status).toBe(200);
    const exportCall = boundary.rpc.mock.calls.find(([, args]) => args.p_operation === 'export')!;
    expect(exportCall[1].p_input.selections[0].generationId).toBe(ids.generation);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects the apparel engine rather than silently exporting its ZIP', async () => {
    expect((await POST(request({}, 'http://localhost', '?engine=apparel-catalog'), context())).status).toBe(400);
    expect(boundary.rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps archived tasks downloadable', async () => {
    task.archived = true;
    expect((await POST(request(), context())).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves origin, login, ownership, session and revision guards before source reads', async () => {
    expect((await POST(request({}, 'https://foreign.invalid'), context())).status).toBe(403);
    boundary.verified.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'unauthorized' } });
    expect((await POST(request(), context())).status).toBe(401);
    boundary.verified.mockResolvedValue({ data: ids.user, error: null });
    for (const message of ['task_not_found', 'session_deleting', 'revision_conflict']) {
      boundary.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect((await POST(request(), context())).status).toBe(message === 'revision_conflict' ? 409 : 404);
    }
    expect(fetcher).not.toHaveBeenCalled();
    assertNoExternalWritesOrGeneration();
  });

  it.each([{ asset_status: 'deleted' }, { asset_expires_at: '2000-01-01' }, { storage_bucket: 'references' }])('preserves invalid/expired asset rejection %j', async data => {
    boundary.generation.mockResolvedValue({ error: null, data: { storage_bucket: 'generated', storage_path: 'private/original.png', asset_status: 'active', asset_expires_at: '2099-01-01', ...data } });
    expect((await POST(request(), context())).status).not.toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails on corrupt and oversized bytes without returning the original or retrying', async () => {
    source = Buffer.from([1, 2, 3]);
    const response = await POST(request(), context());
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('json');
    expect((await response.json()).retryable).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    source = Buffer.alloc(20 * 1024 * 1024 + 1);
    expect((await POST(request(), context())).status).not.toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    assertNoExternalWritesOrGeneration();
  });
  it('does not fetch a signed URL outside the authorized Storage origin', async () => {
    boundary.signed.mockResolvedValue({ error: null, data: { signedUrl: 'https://foreign.invalid/storage/v1/object/sign/generated/private/original.png' } });
    expect((await POST(request(), context())).status).not.toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not retry a failed source fetch', async () => {
    fetcher.mockRejectedValue(new Error('synthetic timeout'));
    expect((await POST(request(), context())).status).not.toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    assertNoExternalWritesOrGeneration();
  });
  it.each([undefined, '1'])('cancels oversized source streaming with Content-Length=%s before EOF', async contentLength => {
    let emitted = 0;
    const cancelled = vi.fn();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({
      pull(controller) {
        if (emitted === 25) { controller.close(); return; }
        emitted++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel: cancelled,
    }), { headers: contentLength === undefined ? {} : { 'content-length': contentLength } }));
    const response = await POST(request(), context());
    expect(response.status).toBe(400);
    expect((await response.json()).retryable).toBe(false);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(emitted).toBeLessThan(25);
    expect(fetcher).toHaveBeenCalledTimes(1);
    assertNoExternalWritesOrGeneration();
  });

  it('leaves ordinary PNG/JPG, ZIP and long-image exports available with no safe strategy', async () => {
    for (const overrides of [{ mode: 'single', format: 'png' }, { mode: 'single', format: 'jpg' }, { mode: 'zip', format: 'png' }, { mode: 'long', format: 'png' }]) {
      expect((await POST(request({ ...overrides, safeExport: undefined }), context())).status).toBe(200);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    assertNoExternalWritesOrGeneration();
  });
});
