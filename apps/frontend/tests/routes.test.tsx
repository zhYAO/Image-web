import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationProvider } from '../src/platform/navigation';
import { RuntimeProvider } from '../src/platform/runtime-provider';
import { Routes } from '../src/routes';

beforeEach(() => {
  window.history.replaceState(null, '', '/account');
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const config = { schemaVersion: 1, formalAuth: true, dataMode: 'http', captchaSiteKey: null, approvedLegalVersion: null, registrationEnabled: false };
const meta = { schemaVersion: 1, backendRelease: 'a'.repeat(40), api: { major: 1, minor: 0 }, capabilities: ['runtime.meta.v1', 'runtime.public-config.v1'] };
const descriptor = { apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.meta.v1'] }, allowedBackendReleases: [meta.backendRelease] };
const request = () => vi.fn((url: string) => Promise.resolve(Response.json(url.endsWith('/meta') ? meta : config)));

describe('route integration gates', () => {
  it('blocks private modules while runtime GETs are pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const account = vi.fn(() => <div>PRIVATE</div>);
    render(<NavigationProvider><RuntimeProvider descriptor={descriptor}><Routes pages={{ account }} /></RuntimeProvider></NavigationProvider>);
    expect(account).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('正在确认服务');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex,nofollow');
  });
  it('blocks private modules when candidate identity is outside its allowlist', async () => {
    const api = request();
    vi.stubGlobal('fetch', api);
    const account = vi.fn(() => <div>PRIVATE</div>);
    render(<NavigationProvider><RuntimeProvider><Routes pages={{ account }} /></RuntimeProvider></NavigationProvider>);
    await screen.findByRole('alert');
    expect(account).not.toHaveBeenCalled();
    expect(screen.getByText('当前服务版本不兼容，请稍后再试。')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
    expect(api).toHaveBeenCalledTimes(2);
  });
  it('recovers from 503 only after an explicit retry of the public GETs', async () => {
    let available = false;
    const api = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method !== 'GET' || !['/api/public-config', '/api/meta'].includes(String(url))) throw new Error('Unexpected business request');
      return Promise.resolve(!available && url === '/api/public-config'
        ? new Response(null, { status: 503 }) : Response.json(url === '/api/meta' ? meta : config));
    });
    vi.stubGlobal('fetch', api);
    const account = vi.fn(() => <div>RECOVERED ACCOUNT</div>);
    render(<NavigationProvider><RuntimeProvider descriptor={descriptor}><Routes pages={{ account }} /></RuntimeProvider></NavigationProvider>);
    await screen.findByRole('alert');
    expect(api).toHaveBeenCalledTimes(2);
    expect(account).not.toHaveBeenCalled();
    available = true;
    const retry = screen.getByRole('button', { name: '重新连接' });
    act(() => { retry.click(); retry.click(); });
    await screen.findByText('RECOVERED ACCOUNT');
    expect(api).toHaveBeenCalledTimes(4);
    expect(api.mock.calls.map(([url]) => url)).toEqual(['/api/public-config', '/api/meta', '/api/public-config', '/api/meta']);
  });
  it('does not admit an incompatible backend after a successful retry response', async () => {
    let unavailable = true;
    const api = vi.fn((url: string) => Promise.resolve(unavailable
      ? new Response(null, { status: 503 }) : Response.json(url === '/api/meta' ? { ...meta, backendRelease: 'b'.repeat(40) } : config)));
    vi.stubGlobal('fetch', api);
    const account = vi.fn(() => <div>PRIVATE ACCOUNT</div>);
    render(<NavigationProvider><RuntimeProvider descriptor={descriptor}><Routes pages={{ account }} /></RuntimeProvider></NavigationProvider>);
    await screen.findByRole('button', { name: '重新连接' });
    unavailable = false;
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    await screen.findByText('当前服务版本不兼容，请稍后再试。');
    expect(account).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
    expect(api).toHaveBeenCalledTimes(4);
  });
  it('opens an explicitly supplied module only after the runtime pair is accepted', async () => {
    vi.stubGlobal('fetch', request());
    const account = vi.fn(() => <div>ACCOUNT MODULE STILL OWNS AUTHENTICATED ACCOUNT READ</div>);
    render(<NavigationProvider><RuntimeProvider descriptor={descriptor}><Routes pages={{ account }} /></RuntimeProvider></NavigationProvider>);
    await screen.findByText('ACCOUNT MODULE STILL OWNS AUTHENTICATED ACCOUNT READ');
    expect(account).toHaveBeenCalled();
  });
  it('withdraws the accepted page immediately when its build descriptor changes', async () => {
    const api = request();
    vi.stubGlobal('fetch', api);
    const account = () => <div>PRIVATE ACCOUNT</div>;
    const view = render(<NavigationProvider><RuntimeProvider descriptor={descriptor}><Routes pages={{ account }} /></RuntimeProvider></NavigationProvider>);
    await screen.findByText('PRIVATE ACCOUNT');
    api.mockImplementation(() => new Promise(() => {}));
    view.rerender(<NavigationProvider><RuntimeProvider><Routes pages={{ account }} /></RuntimeProvider></NavigationProvider>);
    expect(screen.queryByText('PRIVATE ACCOUNT')).toBeNull();
  });
  it('does not invent a private page when no implementation was supplied', async () => {
    vi.stubGlobal('fetch', request());
    render(<NavigationProvider><RuntimeProvider descriptor={descriptor}><Routes /></RuntimeProvider></NavigationProvider>);
    expect((await screen.findByRole('alert')).textContent).toContain('此入口暂不可用');
  });
  it('keeps the public home readable after runtime service failure', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    render(<NavigationProvider><RuntimeProvider descriptor={descriptor}><Routes /></RuntimeProvider></NavigationProvider>);
    expect(screen.getByText('让灵感，')).not.toBeNull();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('成为下一张好图。')).not.toBeNull();
  });
});
