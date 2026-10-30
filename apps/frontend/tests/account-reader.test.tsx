import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountData, useAccountData } from '../src/pages/account-data';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const profile = { id: owner, email: 'owner@example.test', displayName: null, status: 'active' };
function Consumer() { const data = useAccountData(); return <output>{data.status === 'ready' ? data.account.email : data.status}</output>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('API-driven account data', () => {
  it('reads the account through authenticated no-store GET', async () => {
    const request = vi.fn().mockResolvedValue(Response.json(profile));
    vi.stubGlobal('fetch', request);
    render(<AccountData ownerId={owner}><Consumer /></AccountData>);
    await screen.findByText(profile.email);
    expect(request).toHaveBeenCalledWith('/api/account', expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it('rejects a valid but wrong-owner response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...profile, id: other })));
    render(<AccountData ownerId={owner}><Consumer /></AccountData>);
    await screen.findByText('error');
    expect(screen.queryByText(profile.email)).toBeNull();
  });
  it('ignores late owner-A data after switching to B', async () => {
    let finish: ((value: Response) => void) | undefined;
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(Response.json({ ...profile, id: other, email: 'other@example.test' }));
    vi.stubGlobal('fetch', request);
    const view = render(<AccountData ownerId={owner}><Consumer /></AccountData>);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    view.rerender(<AccountData ownerId={other}><Consumer /></AccountData>);
    await screen.findByText('other@example.test');
    finish?.(Response.json(profile));
    await Promise.resolve();
    expect(screen.queryByText(profile.email)).toBeNull();
  });
  it('returns error rather than guest for a 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    render(<AccountData ownerId={owner}><Consumer /></AccountData>);
    await screen.findByText('error');
  });
});
