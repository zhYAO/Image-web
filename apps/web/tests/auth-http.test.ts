import { afterEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock('../lib/supabase/server', () => ({ createSupabaseServerClient: () => ({ rpc: vi.fn().mockResolvedValue({ error: { code: '42501' } }) }) }));
vi.mock('../server/observability', () => ({ reportServerError: vi.fn() }));
import { rateLimit } from '../server/auth/http';
import { POST as register } from '../app/api/auth/register/route';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('auth HTTP boundaries', () => {
  it('uses the server-only RPC permission for a local development request', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    rpc.mockResolvedValue({ data: { allowed: true }, error: null });
    await expect(rateLimit(new Request('http://localhost:3000/api/auth/login'), 'login', 'audit@example.com')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('consume_auth_rate_limit', expect.objectContaining({ p_action: 'login' }));
  });
  it('reports missing rate-limit infrastructure as unavailable, not too many attempts', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202' }, data: null });
    await expect(rateLimit(new Request('http://localhost:3000/api/auth/login', { headers: { 'x-real-ip': '127.0.0.1' } }), 'login', 'audit@example.com')).rejects.toMatchObject({ status: 503 });
  });
  it('preserves real rate-limit denials', async () => {
    rpc.mockResolvedValue({ data: { allowed: false }, error: null });
    await expect(rateLimit(new Request('http://localhost:3000/api/auth/login', { headers: { 'x-real-ip': '127.0.0.1' } }), 'login', 'audit@example.com')).rejects.toMatchObject({ status: 429 });
  });
  it('returns an error status when registration has not been enabled', async () => {
    vi.stubEnv('APPROVED_LEGAL_VERSION', '');
    const response = await register(new Request('http://localhost:3000/api/auth/register', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'audit@example.com', password: 'Unique-4G!qR8', legalVersion: 'draft' }) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ message: expect.stringMatching(/注册暂未开放/) });
  });
});
