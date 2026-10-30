import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Application, prefetchWorkspace } from '../src/application';
import { NavigationProvider } from '../src/platform/navigation';
import { RuntimeProvider } from '../src/platform/runtime-provider';
import { TRIAL_CREDIT_CATALOG } from '@zimage/domain';

const owner = '11111111-1111-4111-8111-111111111111';
const config = { schemaVersion: 1, formalAuth: true, dataMode: 'http', captchaSiteKey: null, approvedLegalVersion: null, registrationEnabled: false };
const meta = { schemaVersion: 1, backendRelease: 'a'.repeat(40), api: { major: 1, minor: 0 }, capabilities: ['runtime.meta.v1'] };
const descriptor = { apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.meta.v1'] }, allowedBackendReleases: [meta.backendRelease] };
beforeEach(() => {
  window.history.replaceState(null, '', '/workspace');
  window.sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('scrollTo', () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() { return render(<NavigationProvider prefetchWorkspace={prefetchWorkspace}><RuntimeProvider descriptor={descriptor}><Application /></RuntimeProvider></NavigationProvider>); }
function api(authorized = true) {
  return vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') throw new Error('This integration test must not submit a business operation');
    const values: Record<string, unknown> = {
      '/api/public-config': config, '/api/meta': meta, '/api/auth/session': { id: owner },
      '/api/credits/pricing': TRIAL_CREDIT_CATALOG,
      '/api/credits': { availableMinor: 1000, frozenMinor: 0, spentMinor: 0 },
      '/api/sessions': { sessions: [] }, '/api/skills': { registryVersion: 'fixture-v1', skills: [] },
      '/api/quotas': { limit: 10, used: 0, resetsAt: new Date().toISOString() },
      '/api/health/providers': { registryVersion: 'fixture-v1', capabilities: [], health: [] },
      '/api/account': { id: owner, email: 'owner@example.test', displayName: null, status: 'active' },
    };
    if (path === '/api/auth/session' && !authorized) return new Response(null, { status: 401 });
    if (!(String(path) in values)) throw new Error(`Unexpected test HTTP path ${String(path)}`);
    return Response.json(values[String(path)]);
  });
}
describe('actual migrated business modules over HTTP fixtures', () => {
  it('loads the existing editor and retains the same draft across home navigation', async () => {
    const request = api(); vi.stubGlobal('fetch', request);
    mount();
    const input = await screen.findByLabelText('创作输入', {}, { timeout: 20000 });
    fireEvent.change(input, { target: { value: 'keep this real editor draft' } });
    act(() => { window.history.pushState(null, '', '/home'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await screen.findByText('让灵感，');
    act(() => { window.history.pushState(null, '', '/workspace'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect((await screen.findByLabelText('创作输入') as HTMLTextAreaElement).value).toBe('keep this real editor draft');
    expect(request.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
    expect(request.mock.calls.some(([path]) => path === '/api/sessions')).toBe(true);
  }, 30000);
  it('loads the existing account forms from account API data', async () => {
    window.history.replaceState(null, '', '/account');
    vi.stubGlobal('fetch', api()); mount();
    await screen.findByText('邮箱：owner@example.test', {}, { timeout: 20000 });
    expect(screen.getByRole('button', { name: '保存资料' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '修改密码' })).not.toBeNull();
  }, 30000);
  it('renders actual login UI and keeps registration closed without legal approval', async () => {
    window.history.replaceState(null, '', '/login?returnTo=%2Fworkspace');
    vi.stubGlobal('fetch', api(false)); mount();
    await screen.findByRole('heading', { name: '登录' }, { timeout: 20000 });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await screen.findByText('注册暂未开放，请等待服务条款确认后再试。');
    expect(screen.getAllByRole('button', { name: '注册' }).some(button => (button as HTMLButtonElement).disabled)).toBe(true);
  }, 30000);
  it('returns guests from a private workspace to the public home', async () => {
    vi.stubGlobal('fetch', api(false)); mount();
    await waitFor(() => expect(window.location.pathname).toBe('/home'), { timeout: 20000 });
    expect(screen.queryByLabelText('创作输入')).toBeNull();
  }, 30000);
});
