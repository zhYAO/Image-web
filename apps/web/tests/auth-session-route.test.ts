import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));
import { GET } from '@/app/api/auth/session/route';

describe('lightweight workspace identity', () => {
  afterEach(() => vi.resetAllMocks());
  it('returns only the verified owner, without fetching a profile or email', async () => {
    mocks.rpc.mockResolvedValue({ data: '10000000-0000-4000-8000-000000000001', error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '10000000-0000-4000-8000-000000000001' });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('require_verified_user_id');
  });
  it.each([
    { status: 401, result: { data: null, error: { code: 'P0001', message: 'unauthorized' } } },
    { status: 401, result: { data: null, status: 401, error: { code: 'PGRST301', message: 'JWT expired' } } },
    { status: 503, result: { data: null, status: 503, error: { code: 'PGRST000', message: 'unavailable' } } },
    { status: 503, result: { data: null, status: 200, error: null } },
  ])('distinguishes confirmed invalid identity from dependency failures ($status)', async ({ status, result }) => {
    mocks.rpc.mockResolvedValue(result);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });
});
