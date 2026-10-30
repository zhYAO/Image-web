import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateSupabaseSession } from '@/lib/supabase/proxy';
import { GET as getPublicConfig } from '@/app/api/public-config/route';
import { GET as getApiMeta } from '@/app/api/meta/route';

const mocks = vi.hoisted(() => ({ environment: vi.fn(), claims: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/supabase/env', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/supabase/env')>(),
  readSupabasePublicEnv: mocks.environment,
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.client }));

const release = '48e35686e0e4d6b302a1940cb12f5ea1be84860e';
const publicPaths = ['/api/meta', '/api/public-config'] as const;

beforeEach(() => {
  vi.stubGlobal('Headers', new NextRequest('https://fixture.test').headers.constructor);
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
  vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture_only');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
  vi.stubEnv('APPROVED_LEGAL_VERSION', 'approved-fixture');
  vi.stubEnv('ZIMAGE_BUILD_SHA', release);
  mocks.environment.mockReturnValue({ url: 'https://fixture.supabase.co', publishableKey: 'fixture' });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: 'fixture-owner' } } });
  mocks.client.mockReturnValue({ auth: { getClaims: mocks.claims } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('public runtime metadata at the session proxy boundary', () => {
  it.each(publicPaths.flatMap(path => ['GET', 'HEAD', 'OPTIONS'].map(method => [path, method])))('keeps %s %s uncached without refreshing or changing a session', async (pathname, method) => {
    const request = new NextRequest(`https://www.zimage.store${pathname}?fresh=1`, {
      method,
      headers: { cookie: 'sb-fixture-auth-token=retained' },
    });
    const response = await updateSupabaseSession(request);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(request.cookies.get('sb-fixture-auth-token')?.value).toBe('retained');
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(publicPaths)('serves %s even when identity configuration or refresh is unavailable', async (pathname) => {
    mocks.environment.mockImplementation(() => { throw Error('identity service unavailable'); });
    const pending = updateSupabaseSession(new NextRequest(`https://www.zimage.store${pathname}`));
    await expect(pending).resolves.toHaveProperty('status', 200);
    expect((await pending).headers.get('set-cookie')).toBeNull();
  });

  it.each(publicPaths)('does not bootstrap an anonymous session for %s in the legacy mode', async (pathname) => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'false');
    const response = await updateSupabaseSession(new NextRequest(`https://www.zimage.store${pathname}`, {
      headers: { accept: 'text/html' },
    }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    { pathname: '/api/meta', handler: getApiMeta, mode: 'configured', status: 200 },
    { pathname: '/api/meta', handler: getApiMeta, mode: 'missing', status: 503 },
    { pathname: '/api/public-config', handler: getPublicConfig, mode: 'configured', status: 200 },
    { pathname: '/api/public-config', handler: getPublicConfig, mode: 'missing', status: 503 },
  ] as const)('preserves the safe $status response for $pathname with $mode configuration', async ({ pathname, handler, mode, status }) => {
    mocks.environment.mockImplementation(() => { throw Error('identity service unavailable'); });
    if (mode === 'missing') {
      vi.stubEnv('ZIMAGE_BUILD_SHA', '');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    }
    const request = new NextRequest(`https://www.zimage.store${pathname}`);
    const proxyResponse = await updateSupabaseSession(request);
    expect(proxyResponse.headers.get('x-middleware-next')).toBe('1');
    const response = handler();
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const body = await response.json();
    if (status === 503) expect(body.code).toBe('service_not_ready');
    else if (pathname === '/api/meta') expect(body.backendRelease).toBe(release);
    else expect(body).toMatchObject({ dataMode: 'http', formalAuth: true });
  });

  it.each(['/api/meta/private', '/api/meta.json', '/api/public-config/private', '/api/public-configuration', '/api/auth/session', '/api/account', '/workspace'])('keeps identity verification on the neighboring or protected path %s', async (pathname) => {
    await updateSupabaseSession(new NextRequest(`https://www.zimage.store${pathname}`));
    expect(mocks.claims).toHaveBeenCalledTimes(1);
  });

  it.each(publicPaths.flatMap(path => ['POST', 'PUT', 'PATCH', 'DELETE'].map(method => [path, method])))('does not extend the read-only exception to %s %s', async (pathname, method) => {
    await updateSupabaseSession(new NextRequest(`https://www.zimage.store${pathname}`, { method }));
    expect(mocks.claims).toHaveBeenCalledTimes(1);
  });
});
