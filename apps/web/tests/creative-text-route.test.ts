import { transferableAbortController } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.user }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));
import { POST } from '@/app/api/creative-text/optimize/route';
const userId = '10000000-0000-4000-8000-000000000001';
function request(body: unknown = { field: 'title', text: '旧标题' }, origin = 'https://app.test') {
  return new Request('https://app.test/api/creative-text/optimize', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
let operations: Array<{ name: string; input: Record<string, unknown> }>;
beforeEach(() => {
  vi.clearAllMocks(); operations = [];
  mocks.user.mockResolvedValue({ rpc: async () => ({ data: userId, error: null }) });
  mocks.admin.mockReturnValue({ rpc: async (name: string, input: Record<string, unknown>) => { operations.push({ name, input }); return { data: true, error: null }; } });
  vi.stubEnv('ARK_API_KEY', 'test'); vi.stubEnv('ZIMAGE_DOUBAO_CHAT_MODEL', 'test');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ text: '新标题' }) } }] })}\n\ndata: [DONE]\n\n`)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('stateless field optimization route', () => {
  it('blocks cross-origin before auth', async () => {
    expect((await POST(request(undefined, 'https://evil.test'))).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it('requires verified auth', async () => {
    mocks.user.mockResolvedValue({ rpc: async () => ({ data: null, error: null }) });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each([{ field: 'other', text: 'text' }, { field: 'title', text: 'a'.repeat(161) }, { field: 'title', text: 'ok', context: 'x'.repeat(2001) }, { field: 'title', text: 'ok', sessionId: userId }])('rejects invalid request %#', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('charges chat preview with no session creation or image writes', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '新标题', mock: false });
    expect(operations.map(op => op.name)).toEqual(['assert_chat_provider_available', 'reserve_preview_usage', 'record_chat_provider_result', 'commit_preview_usage']);
    expect(operations[1]?.input).toMatchObject({ p_user_id: userId, p_operation: 'chat', p_creates_session: false });
  });
  it('uses an explicitly selected minimax provider', async () => {
    vi.stubEnv('MINIMAX_API_KEY', 'test'); vi.stubEnv('ZIMAGE_MINIMAX_CHAT_MODEL', 'minimax-test');
    const response = await POST(request({ field: 'title', text: '旧标题', chatModel: 'minimax' }));
    expect(response.status).toBe(200);
    expect(operations[0]?.input).toEqual({ p_provider: 'minimax' });
    expect(fetch).toHaveBeenCalledWith('https://api.minimaxi.com/v1/chat/completions', expect.objectContaining({ body: expect.stringContaining('minimax-test') }));
  });
  it('releases reservation when already canceled before provider submission', async () => {
    const controller = transferableAbortController();
    const pending = new Request(request(), { signal: controller.signal });
    controller.abort();
    const response = await POST(pending);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(operations.map(op => op.name)).toContain('release_preview_usage');
  });
  it('retains reservation after canceling an already submitted provider request', async () => {
    const controller = transferableAbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"text":"result"}' } }] })}\n\ndata: [DONE]\n\n`);
    }));
    const response = await POST(new Request(request(), { signal: controller.signal }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(operations.map(op => op.name)).toContain('reserve_preview_usage');
    expect(operations.map(op => op.name)).not.toContain('release_preview_usage');
  });
  it('retains quota when a consumed model response fails validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'not JSON' } }] })}\n\ndata: [DONE]\n\n`)));
    const response = await POST(request());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(operations.map(op => op.name)).toContain('record_chat_provider_result');
    expect(operations.map(op => op.name)).not.toContain('release_preview_usage');
  });
  it('retains consumed quota even when provider health recording also fails', async () => {
    mocks.admin.mockReturnValue({ rpc: async (name: string, input: Record<string, unknown>) => {
      operations.push({ name, input });
      return { data: true, error: name === 'record_chat_provider_result' ? { message: 'health unavailable' } : null };
    } });
    const response = await POST(request());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(operations.map(op => op.name)).not.toContain('release_preview_usage');
  });
  it('fails closed when quota exhausted before provider work', async () => {
    mocks.admin.mockReturnValue({ rpc: async (name: string) => ({ data: name !== 'reserve_preview_usage', error: name === 'reserve_preview_usage' ? { message: 'preview_quota_exceeded' } : null }) });
    expect((await POST(request())).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
});
