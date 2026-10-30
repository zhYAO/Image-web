import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CookieMethodsServer } from '@supabase/ssr';

const mocks = vi.hoisted(() => ({ client: vi.fn(), cookies: vi.fn(), environment: vi.fn() }));
vi.mock('@supabase/ssr', async (original) => ({
  ...await original<typeof import('@supabase/ssr')>(), createServerClient: mocks.client,
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/supabase/env', () => ({ readSupabasePublicEnv: mocks.environment }));
vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));

import { updateSupabaseSession } from '@/lib/supabase/proxy';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { GET as account, PATCH, DELETE } from '@/app/api/account/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as verify } from '@/app/api/auth/verify/route';
import { POST as recoveryVerify } from '@/app/api/auth/recovery/verify/route';
import { POST as password } from '@/app/api/auth/password/route';

const owner = '10000000-0000-4000-8000-000000000001';
const sdkHeaders = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0', Pragma: 'no-cache',
};
const options = { path: '/', secure: true, sameSite: 'lax' as const };
const expiredCookie = { name: 'sb-fixture-auth-token.1', value: '', options: { ...options, maxAge: 0 } };

beforeEach(() => {
  vi.stubGlobal('Headers', new NextRequest('https://fixture.test').headers.constructor);
  vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
  mocks.environment.mockReturnValue({ url: 'https://fixture.supabase.co', publishableKey: 'fixture' });
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('API-only session response lifecycle', () => {
  it('keeps every cookie batch, scope, deletion and SDK response header at the proxy', async () => {
    mocks.client.mockImplementation((_url, _key, { cookies }: { cookies: CookieMethodsServer }) => ({
      auth: { getClaims: async () => {
        await cookies.setAll!([expiredCookie, { ...expiredCookie, options: { ...expiredCookie.options, domain: '.fixture.test' } }], sdkHeaders);
        await cookies.setAll!([{ name: 'sb-fixture-auth-token.0', value: 'renewed', options }], sdkHeaders);
        return { data: { claims: { sub: owner } }, error: null };
      } },
    }));
    const request = new NextRequest('https://fixture.test/api/account', { headers: { cookie: 'sb-fixture-auth-token.0=expired; sb-fixture-auth-token.1=stale' } });
    const response = await updateSupabaseSession(request);
    const writes = response.headers.getSetCookie();
    expect(writes).toHaveLength(3);
    expect(writes.filter(value => value.includes('Max-Age=0'))).toHaveLength(2);
    expect(writes.some(value => value.includes('Domain=.fixture.test'))).toBe(true);
    expect(request.cookies.get('sb-fixture-auth-token.0')?.value).toBe('renewed');
    expect(response.headers.get('expires')).toBe('0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
  });

  it.each([false, true])('returns route-created refresh cookies and SDK headers even on error=%s', async (fail) => {
    const cookieStore = { getAll: () => [], set: vi.fn() };
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.client.mockImplementation((_url, _key, { cookies }: { cookies: CookieMethodsServer }) => ({
      rpc: async () => {
        await cookies.setAll!([expiredCookie, { ...expiredCookie, options: { ...expiredCookie.options, domain: '.fixture.test' } }], sdkHeaders);
        if (fail) return { data: null, error: { code: 'P0001', message: 'unauthorized' } };
        return { data: owner, error: null };
      },
    }));
    const response = await executeRoute(async () => {
      const id = await requireVerifiedUserId(await createSupabaseServerClient());
      return Response.json({ id }, { headers: { 'cache-control': 'public, no-transform' } });
    });
    expect(response.status).toBe(fail ? 401 : 200);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('cache-control')).not.toContain('public');
    if (!fail) expect(response.headers.get('cache-control')).toContain('no-transform');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('expires')).toBe('0');
  });

  it('keeps cookieStore writes for legacy Server Components and Server Actions', async () => {
    const cookieStore = { getAll: () => [], set: vi.fn() };
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.client.mockImplementation((_url, _key, { cookies }: { cookies: CookieMethodsServer }) => ({
      auth: { getClaims: async () => cookies.setAll!([expiredCookie], sdkHeaders) },
    }));
    await (await createSupabaseServerClient()).auth.getClaims();
    expect(cookieStore.set).toHaveBeenCalledWith(expiredCookie.name, '', expiredCookie.options);
    cookieStore.set.mockImplementation(() => { throw Error('read-only Server Component'); });
    await expect((await createSupabaseServerClient()).auth.getClaims()).resolves.toBeUndefined();
  });

  it('isolates concurrent requests and passes updated cookies to subsequent clients in one route', async () => {
    let count = 0;
    let unblock!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    mocks.client.mockImplementation((_url, _key, { cookies }: { cookies: CookieMethodsServer }) => {
      const index = ++count;
      return { auth: { getClaims: async () => {
        if (index === 1) await blocked;
        await cookies.setAll!([{ name: 'sb-fixture-auth-token', value: String(index), options }], sdkHeaders);
        return { data: { claims: { sub: owner } } };
      } }, cookieValues: () => cookies.getAll() };
    });
    const first = executeRoute(async () => {
      await (await createSupabaseServerClient()).auth.getClaims();
      return Response.json({ done: true });
    });
    const second = await executeRoute(async () => {
      await (await createSupabaseServerClient()).auth.getClaims();
      const nextClient = await createSupabaseServerClient() as unknown as { cookieValues(): unknown };
      expect(nextClient.cookieValues()).toContainEqual({ name: 'sb-fixture-auth-token', value: '2' });
      return Response.json({ done: true });
    });
    unblock();
    expect(second.headers.getSetCookie().join()).toContain('auth-token=2;');
    expect((await first).headers.getSetCookie().join()).toContain('auth-token=1;');
  });

  it.each(['rpc-reject', 'configuration'] as const)('classifies %s outages as retryable 503, with private no-store', async failure => {
    if (failure === 'configuration') mocks.environment.mockImplementation(() => { throw Error('unavailable configuration'); });
    else mocks.client.mockReturnValue({ rpc: async () => { throw Error('connection unavailable'); } });
    const response = await executeRoute(async () => Response.json({ id: await requireVerifiedUserId(await createSupabaseServerClient()) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'network', retryable: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([200, 401, 503])('serves the initial account API read with private no-store at %s', async status => {
    const profile = { display_name: 'Fixture', status: 'active' };
    mocks.client.mockReturnValue({
      rpc: async () => status === 200 ? { data: owner, error: null } : { data: null, status, error: status === 401 ? { code: 'P0001', message: 'unauthorized' } : { code: 'PGRST202' } },
      auth: { getUser: async () => ({ data: { user: { id: owner, email: 'fixture@example.test' } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }) }),
    });
    const response = await account();
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    if (status === 200) expect(await response.json()).toEqual({ id: owner, email: 'fixture@example.test', displayName: 'Fixture', status: 'active' });
  });

  it('rejects a profile read whose Supabase user differs from the verified live owner', async () => {
    mocks.client.mockReturnValue({
      rpc: async () => ({ data: owner, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: '20000000-0000-4000-8000-000000000002', email: 'other@example.test' } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { display_name: 'Fixture', status: 'active' }, error: null }) }) }) }),
    });
    const response = await account();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('other@example.test');
  });

  it('keeps a thrown account dependency failure distinct from an expired login', async () => {
    mocks.client.mockReturnValue({
      rpc: async () => ({ data: owner, error: null }),
      auth: { getUser: async () => { throw Error('account service transport failed'); } },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    });
    const response = await account();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([login, logout, verify, recoveryVerify, password, PATCH, DELETE])('rejects cross-site and missing Origin writes before using Supabase (%#)', async handler => {
    for (const origin of [undefined, 'https://evil.test', 'null']) {
      const response = await handler(new Request('https://fixture.test/api/auth/fixture', {
        method: 'POST', headers: origin ? { origin } : {}, body: '{}',
      }));
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.client).not.toHaveBeenCalled();
    }
  });

  it.each([new Error('refresh unavailable'), { name: 'AuthRetryableFetchError', status: 0 }])('reports refresh dependency outages as private 503 at the API proxy (%#)', async error => {
    mocks.client.mockReturnValue({ auth: { getClaims: async () => {
      if (error instanceof Error) throw error;
      return { data: null, error };
    } } });
    const response = await updateSupabaseSession(new NextRequest('https://fixture.test/api/auth/session'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ code: 'network', retryable: true, correlationId: expect.any(String) });
    expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
  });

  it.each(['client-construction', 'legacy-bootstrap'])('fails closed with private 503 for a thrown %s dependency', async failure => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'false');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    mocks.client.mockImplementation(() => {
      if (failure === 'client-construction') throw Error('SDK unavailable');
      return { auth: { getClaims: async () => ({ data: null }), signInAnonymously: async () => { throw Error('bootstrap transport failed'); } } };
    });
    const response = await updateSupabaseSession(new NextRequest('https://fixture.test/workspace', { headers: { accept: 'text/html' } }));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
