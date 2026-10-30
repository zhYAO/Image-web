import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStatusProvider, notifyAuthChange, useAuthStatus } from '../src/platform/auth-status';
import { RuntimeProvider } from '../src/platform/runtime-provider';

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const config = { schemaVersion: 1, formalAuth: true, dataMode: 'http', captchaSiteKey: null, approvedLegalVersion: null, registrationEnabled: false };
const meta = { schemaVersion: 1, backendRelease: 'a'.repeat(40), api: { major: 1, minor: 0 }, capabilities: ['runtime.meta.v1'] };
const descriptor = { apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.meta.v1'] }, allowedBackendReleases: [meta.backendRelease] };
function Identity() {
  const identity = useAuthStatus();
  return <><output>{identity.status}:{identity.ownerId}</output><button onClick={identity.refresh}>refresh</button></>;
}
function mount() { return render(<RuntimeProvider descriptor={descriptor}><AuthStatusProvider><Identity /></AuthStatusProvider></RuntimeProvider>); }
function api(identity: (init?: RequestInit) => Promise<Response>) {
  return vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
    if (path === '/api/public-config') return Promise.resolve(Response.json(config));
    if (path === '/api/meta') return Promise.resolve(Response.json(meta));
    if (path === '/api/auth/session') return identity(init);
    throw new Error('unexpected request');
  });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('real HTTP identity lifecycle', () => {
  it('uses server-verified UUID identity and same-origin cookies', async () => {
    const request = api(async () => Response.json({ id: ownerA }));
    vi.stubGlobal('fetch', request);
    mount();
    await screen.findByText(`authorized:${ownerA}`);
    const call = request.mock.calls.find(([path]) => path === '/api/auth/session');
    expect(call?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  });
  it.each([503, 429, 403])('keeps %s separate from a confirmed guest', async status => {
    vi.stubGlobal('fetch', api(async () => new Response(null, { status })));
    mount();
    await screen.findByText('error:');
  });
  it('recognizes only 401 as guest', async () => {
    vi.stubGlobal('fetch', api(async () => new Response(null, { status: 401 })));
    mount();
    await screen.findByText('guest:');
  });
  it('discards late old-owner reads after logout and a later login', async () => {
    let finish: ((response: Response) => void) | undefined;
    const identity = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(Response.json({ id: ownerB }));
    vi.stubGlobal('fetch', api(identity));
    mount();
    await waitFor(() => expect(identity).toHaveBeenCalledOnce());
    notifyAuthChange(false);
    await screen.findByText('guest:');
    notifyAuthChange(true);
    await screen.findByText(`authorized:${ownerB}`);
    finish?.(Response.json({ id: ownerA }));
    await Promise.resolve();
    expect(screen.getByText(`authorized:${ownerB}`)).not.toBeNull();
  });
  it('aborts a pending read when the runtime unmounts', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', api(init => { signal = init?.signal ?? undefined; return new Promise(() => {}); }));
    const view = mount();
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it('can retry a dependency outage explicitly', async () => {
    const identity = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(Response.json({ id: ownerA }));
    vi.stubGlobal('fetch', api(identity));
    mount();
    await screen.findByText('error:');
    fireEvent.click(screen.getByText('refresh'));
    await screen.findByText(`authorized:${ownerA}`);
  });
  it('requires a fresh identity after a runtime descriptor is replaced', async () => {
    const identity = vi.fn().mockResolvedValueOnce(Response.json({ id: ownerA })).mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', api(identity));
    const view = mount();
    await screen.findByText(`authorized:${ownerA}`);
    view.rerender(<RuntimeProvider descriptor={{ ...descriptor }}><AuthStatusProvider><Identity /></AuthStatusProvider></RuntimeProvider>);
    await waitFor(() => expect(identity).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(`authorized:${ownerA}`)).toBeNull();
    expect(screen.getByText('checking:')).not.toBeNull();
  });
});
