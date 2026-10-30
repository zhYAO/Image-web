import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getAll: vi.fn(), set: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => store }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));
import { updateSupabaseSession } from '@/lib/supabase/proxy';
import { GET as session } from '@/app/api/auth/session/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as upload } from '@/app/api/uploads/route';

const owner = '10000000-0000-4000-8000-000000000001';
const user = { id: owner, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated' };
function jwt(expires: number) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: owner, exp: expires, session_id: 'fixture-session', aud: 'authenticated' })}.fixture-signature`;
}
function authSession(expires: number) {
  return { access_token: jwt(expires), refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
}
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubGlobal('Headers', new NextRequest('https://fixture.test').headers.constructor);
  // Exercise SSR, without jsdom creating browser BroadcastChannels between
  // the independent server clients used by these requests.
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  vi.stubGlobal('fetch', fetcher);
  vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture');
  const expired = `base64-${Buffer.from(JSON.stringify(authSession(Math.floor(Date.now() / 1000) - 3600))).toString('base64url')}`;
  store.getAll.mockReturnValue([{ name: 'sb-fixture-auth-token', value: expired }]);
  fetcher.mockImplementation(async (url: string | URL) => {
    const path = String(url);
    if (path.includes('/auth/v1/token?grant_type=refresh_token')) return Response.json(authSession(Math.floor(Date.now() / 1000) + 3600));
    if (path.includes('/auth/v1/user')) return Response.json(user);
    if (path.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    if (path.includes('/rest/v1/rpc/require_verified_user_id')) return Response.json(owner);
    throw Error('Unexpected SDK request path');
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('locked Supabase SDK with local HTTP fixtures', () => {
  it('refreshes an expired Cookie using only the session API and returns the complete SDK response effects', async () => {
    const response = await session();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: owner });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('grant_type=refresh_token'))).toHaveLength(1);
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(response.headers.getSetCookie().join()).toContain('sb-fixture-auth-token=base64-');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('expires')).toBe('0');
    // Next's mutable-cookie merger collapses same-name scoped deletions;
    // executeRoute owns these writes directly, legacy pages keep Next writes.
    expect(store.set).not.toHaveBeenCalled();
  });

  it('passes a proxy refresh to the route without refreshing the token twice', async () => {
    const request = new NextRequest('https://fixture.test/api/auth/session', {
      headers: { cookie: store.getAll().map(({ name, value }: { name: string; value: string }) => `${name}=${value}`).join('; ') },
    });
    const proxy = await updateSupabaseSession(request);
    expect(proxy.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(proxy.headers.get('x-middleware-request-cookie')).toContain('sb-fixture-auth-token=base64-');
    store.getAll.mockReturnValue(request.cookies.getAll());
    const response = await session();
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('grant_type=refresh_token'))).toHaveLength(1);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('still rejects a refreshed, locally valid JWT when the live session RPC confirms revocation', async () => {
    fetcher.mockImplementation(async (url: string | URL) => {
      if (String(url).includes('/auth/v1/token')) return Response.json(authSession(Math.floor(Date.now() / 1000) + 3600));
      if (String(url).includes('/rest/v1/rpc/require_verified_user_id')) return Response.json({ code: 'P0001', message: 'unauthorized' }, { status: 400 });
      throw Error('Unexpected SDK request path');
    });
    const response = await session();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it('returns local sign-out deletions and never exposes tokens in the response body', async () => {
    const response = await logout(new Request('https://fixture.test/api/auth/logout', {
      method: 'POST', headers: { origin: 'https://fixture.test', 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedOut: true });
    expect(response.headers.getSetCookie().some(value => value.includes('Max-Age=0'))).toBe(true);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('preserves a refresh outage as 503 instead of falling back to a guest RPC on upload', async () => {
    fetcher.mockImplementation(async (url: string | URL) => {
      if (String(url).includes('/auth/v1/token')) return Response.json({ code: 'fixture_unavailable', message: 'Synthetic refresh outage' }, { status: 503 });
      if (String(url).includes('/rest/v1/rpc/require_verified_user_id')) return Response.json({ code: 'PGRST301', message: 'Anonymous fallback rejected' }, { status: 401 });
      throw Error('Unexpected SDK request path');
    });
    const response = await upload(new Request('https://fixture.test/api/uploads', {
      method: 'POST', headers: { origin: 'https://fixture.test', 'content-type': 'multipart/form-data; boundary=fixture' }, body: 'fixture',
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/rest/v1/rpc/'))).toHaveLength(0);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/auth/v1/token'))).toBe(true);
  });
});
