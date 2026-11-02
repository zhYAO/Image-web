import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('returns from the account panel through client navigation without losing the editor draft', async () => {
    const request = api(); vi.stubGlobal('fetch', request);
    mount();
    const input = await screen.findByLabelText('创作输入', {}, { timeout: 20000 });
    fireEvent.change(input, { target: { value: 'retain this account round-trip draft' } });
    act(() => { window.history.pushState(null, '', '/account'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await screen.findByText('邮箱：owner@example.test', {}, { timeout: 20000 });
    const link = screen.getByRole('link', { name: '返回工作区' });
    expect(link.getAttribute('href')).toBe('/workspace');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    await waitFor(() => expect(window.location.pathname).toBe('/workspace'));
    expect((await screen.findByLabelText('创作输入') as HTMLTextAreaElement).value).toBe('retain this account round-trip draft');
    expect(request.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
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
  it.each([
    '/create/product-main?platform=amazon&template=white-main#examples',
    '/workspace?scene=clone&platform=taobao',
  ])('preserves a guest commerce destination through login: %s', async href => {
    window.history.replaceState(null, '', href);
    const request = api(false); vi.stubGlobal('fetch', request); mount();
    await screen.findByRole('heading', { name: '登录' }, { timeout: 20000 });
    expect(window.location.pathname).toBe('/login');
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(href);
    expect(request.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
    expect(screen.queryByLabelText('创作输入')).toBeNull();
  }, 30000);
});

it.each(['/create/product-set', '/create/apparel-catalog'])('returns from %s to the catalogue through client navigation without business writes', async (route) => {
 window.history.replaceState(null, '', route); const request=api(); vi.stubGlobal('fetch',request); mount();
 const link=await screen.findByRole('link',{name:'工具目录'}, {timeout:20000});
 expect(fireEvent.click(link)).toBe(false);
 await waitFor(()=>expect(window.location.pathname).toBe('/create'));
 expect(request.mock.calls.every(([,init])=>(init?.method??'GET')==='GET')).toBe(true);
},30000);

it.each(['/workspace','/account'])('uses the same real session sidebar on the account route entered from %s', async (initial) => {
 const sessionId='33333333-3333-4333-8333-333333333333'; const original=api();
 const request=vi.fn((path: RequestInfo | URL, init?: RequestInit)=>{ if((init?.method??'GET')!=='GET')throw new Error('Unexpected business write'); if(String(path)==='/api/sessions')return Promise.resolve(Response.json({sessions:[{id:sessionId,title:'真实共享会话',status:'active',createdAt:'2026-11-02T00:00:00.000Z',updatedAt:'2026-11-02T00:00:00.000Z',activityTypes:['chat']}]})); if(String(path).includes('/timeline?'))return Promise.resolve(Response.json({items:[]})); if(String(path).startsWith('/api/creative-tasks?')||String(path).startsWith('/api/apparel-tasks?'))return Promise.resolve(Response.json([]));return original(path,init); });
 window.history.replaceState(null,'',initial); vi.stubGlobal('fetch',request); mount();
 if(initial==='/workspace'){await screen.findByLabelText('创作输入',{}, {timeout:20000}); act(()=>{window.history.pushState(null,'','/account');window.dispatchEvent(new PopStateEvent('popstate'));});}
 await screen.findByText('邮箱：owner@example.test',{}, {timeout:20000});
 const sidebar=screen.getByRole('complementary',{name:'会话侧栏'}); const session=await within(sidebar).findByRole('button',{name:'真实共享会话'}, {timeout:20000});
 fireEvent.click(session); await waitFor(()=>expect(window.location.pathname).toBe('/sessions/'+sessionId));
 expect(request.mock.calls.every(([,init])=>(init?.method??'GET')==='GET')).toBe(true);
},30000);

it('surfaces failed account-sidebar mutations instead of hiding workspace feedback', async()=>{
 const sessionId='33333333-3333-4333-8333-333333333333'; const original=api();const request=vi.fn((path:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==='PATCH')return Promise.reject(new TypeError('Failed to fetch'));if(String(path)==='/api/sessions')return Promise.resolve(Response.json({sessions:[{id:sessionId,title:'可重试会话',status:'active',createdAt:'2026-11-02T00:00:00.000Z',updatedAt:'2026-11-02T00:00:00.000Z',activityTypes:['chat']}]}));return original(path,init);});
 window.history.replaceState(null,'','/account');vi.stubGlobal('fetch',request);mount();
 fireEvent.click(await screen.findByRole('button',{name:'重命名 可重试会话'},{timeout:20000}));fireEvent.change(screen.getByRole('textbox',{name:'会话名称'}),{target:{value:'新名称'}});fireEvent.click(screen.getByRole('button',{name:'保存会话名称'}));
 expect((await screen.findByRole('alert',{name:'会话操作反馈'})).textContent).toContain('请稍后重试');
 fireEvent.click(screen.getByRole('button',{name:'重命名 可重试会话'}));expect(screen.getByRole('dialog',{name:'重命名会话'})).not.toBeNull();
},30000);
