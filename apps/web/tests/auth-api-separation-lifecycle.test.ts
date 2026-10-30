import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CookieMethodsServer } from '@supabase/ssr';

const mocks = vi.hoisted(() => ({ client: vi.fn(), environment: vi.fn(), maintenance: false, invalidControl: false }));
vi.mock('@supabase/ssr', async original => ({
  ...await original<typeof import('@supabase/ssr')>(), createServerClient: mocks.client,
}));
vi.mock('@/lib/supabase/env', () => ({ readSupabasePublicEnv: mocks.environment }));
vi.mock('@/server/lifecycle/request-lifecycle', async original => {
  const actual = await original<typeof import('@/server/lifecycle/request-lifecycle')>();
  const fixture = new actual.RequestLifecycle(() => {
    if (mocks.invalidControl) throw Error('unavailable maintenance control');
    return { schemaVersion: 2, mode: mocks.maintenance ? "draining" : "open", operationId: 'fixture-operation' };
  }, () => ({ protocolVersion: 1, barrierId: 'node-http-create-server-v1', installed: true,
    wrappedServerCount: 1, activeHttpRequests: 0, activeFrameworkWork: 0, controlValid: !mocks.invalidControl,
    frameworkWork: { protocolVersion: 1, installed: true, nextVersion: '16.4.1', hook: 'response-cache-revalidate-v1', controlValid: true },
    schemaVersion: 2, admissionEpoch: 'fixture-operation', admissionMode: mocks.maintenance ? 'draining' : 'open' }));
  return { ...actual, lifecycle: fixture,
    assertMutationAdmission: () => fixture.admission(),
    beginWork: (kind: Parameters<typeof actual.beginWork>[0]) => fixture.begin(kind),
    getDrainState: () => fixture.snapshot(),
  };
});
import { updateSupabaseSession } from '@/lib/supabase/proxy';
import { getDrainState, lifecycle } from '@/server/lifecycle/request-lifecycle';

beforeEach(() => {
  vi.stubGlobal('Headers', new NextRequest('https://fixture.test').headers.constructor);
  vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
  mocks.maintenance = false;
  mocks.invalidControl = false;
  mocks.environment.mockReturnValue({ url: 'https://fixture.supabase.co', publishableKey: 'fixture' });
  mocks.client.mockReturnValue({ auth: { getClaims: async () => ({ data: { claims: { sub: 'owner' } } }) } });
});
afterEach(() => {
  expect(getDrainState().counters.activeMutations).toBe(0);
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks();
});

describe('Proxy authentication participates in backend drain', () => {
  it.each([false, true])('waits for a pending SDK refresh and releases its counter on rejected=%s', async rejected => {
    let resume!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>(resolve => { resume = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    mocks.client.mockImplementation((_url, _key, { cookies }: { cookies: CookieMethodsServer }) => ({ auth: { getClaims: async () => {
      started();
      await barrier;
      if (rejected) throw Error('refresh dependency unavailable');
      await cookies.setAll!([{ name: 'sb-fixture-auth-token', value: 'refreshed', options: { path: '/', secure: true, sameSite: 'lax' } }], { 'Cache-Control': 'private, no-store', Expires: '0', Pragma: 'no-cache' });
      return { data: { claims: { sub: 'owner' } } };
    } } }));
    const pending = updateSupabaseSession(new NextRequest('https://fixture.test/api/auth/session'));
    await entered;
    mocks.maintenance = true;
    const during = getDrainState();
    resume(); // Always settle the fixture before asserting on its result.
    const response = await pending;
    expect(during.counters.activeMutations).toBe(1);
    expect(during.drained).toBe(false);
    expect(response.status).toBe(rejected ? 503 : 200);
    if (!rejected) expect(response.headers.getSetCookie().join()).toContain('auth-token=refreshed');
    expect(getDrainState().drained).toBe(true);
  });

  it.each([
    ['/api/auth/login', 'POST'], ['/api/account', 'PATCH'], ['/api/account', 'DELETE'], ['/api/chat', 'POST'],
  ])('rejects a new write %s %s before configuration or authentication work starts', async (path, method) => {
    mocks.maintenance = true;
    const response = await updateSupabaseSession(new NextRequest(`https://fixture.test${path}`, { method }));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('fails closed on an unreadable control without starting a new authentication write', async () => {
    mocks.invalidControl = true;
    const response = await updateSupabaseSession(new NextRequest('https://fixture.test/api/auth/verify', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(['/api/meta', '/api/public-config'])('keeps exact public %s reads independent of auth and admission failures', async path => {
    mocks.invalidControl = true;
    mocks.environment.mockImplementation(() => { throw Error('auth unavailable'); });
    const begin = vi.spyOn(lifecycle, 'begin');
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const response = await updateSupabaseSession(new NextRequest(`https://fixture.test${path}`, { method }));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
    expect(begin).not.toHaveBeenCalled();
    expect(mocks.environment).not.toHaveBeenCalled();
  });

  it('checks admission before legacy GET bootstrap creates an anonymous identity', async () => {
    mocks.maintenance = true;
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'false');
    const bootstrap = vi.fn();
    mocks.client.mockReturnValue({ auth: { getClaims: async () => ({ data: null }), signInAnonymously: bootstrap } });
    const response = await updateSupabaseSession(new NextRequest('https://fixture.test/workspace', { headers: { accept: 'text/html' } }));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
