import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSupabaseSession } from '@/lib/supabase/proxy';

const mocks = vi.hoisted(() => ({ environment: vi.fn(), claims: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/supabase/env', () => ({ readSupabasePublicEnv: mocks.environment }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.client }));
// NextRequest uses the runtime Headers class; jsdom otherwise installs another
// realm's Headers that fails NextResponse's middleware identity check.
beforeEach(() => vi.stubGlobal('Headers', new NextRequest('https://fixture.test').headers.constructor));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe('public landing proxy isolation', () => {
  it.each(['GET', 'HEAD'])('serves public /home %s without auth configuration, refresh, cookie changes or blocking', async (method) => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
    mocks.environment.mockImplementation(() => { throw Error('auth service unavailable'); });
    const request = new NextRequest('https://www.zimage.store/home', { method, headers: { cookie: 'sb-test-auth-token=retained' } });
    const response = await updateSupabaseSession(request);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(request.cookies.get('sb-test-auth-token')?.value).toBe('retained');
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(['/', '/api/auth/session', '/api/account', '/sessions/private', '/create/product-set', '/home/private'])('retains identity refresh for %s', async (pathname) => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    mocks.environment.mockReturnValue({ url: 'https://fixture.supabase.co', publishableKey: 'fixture' });
    mocks.claims.mockResolvedValue({ data: null });
    mocks.client.mockReturnValue({ auth: { getClaims: mocks.claims } });
    await updateSupabaseSession(new NextRequest(`https://www.zimage.store${pathname}`));
    expect(mocks.claims).toHaveBeenCalledTimes(1);
  });
  it('retains the legacy bootstrap path outside formal authentication mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'false');
    mocks.environment.mockReturnValue({ url: 'https://fixture.supabase.co', publishableKey: 'fixture' });
    mocks.claims.mockResolvedValue({ data: { claims: { sub: 'legacy' } } });
    mocks.client.mockReturnValue({ auth: { getClaims: mocks.claims } });
    await updateSupabaseSession(new NextRequest('https://www.zimage.store/home'));
    expect(mocks.claims).toHaveBeenCalledTimes(1);
  });
  it('does not extend the public document exception to POST', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    mocks.environment.mockReturnValue({ url: 'https://fixture.supabase.co', publishableKey: 'fixture' });
    mocks.claims.mockResolvedValue({ data: null });
    mocks.client.mockReturnValue({ auth: { getClaims: mocks.claims } });
    await updateSupabaseSession(new NextRequest('https://www.zimage.store/home', { method: 'POST' }));
    expect(mocks.claims).toHaveBeenCalledTimes(1);
  });
});
