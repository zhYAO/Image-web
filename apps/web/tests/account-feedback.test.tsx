import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountPanel } from '../features/account/AccountPanel';
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });
const account = { id: 'd9428888-122b-11e1-b85c-61cd3cbb3210', email: 'audit@example.com', displayName: null, status: 'active' as const };
describe('account feedback', () => {
  it('reports a network failure and lets the user retry saving their profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(Response.json({ updated: true })));
    render(<AccountPanel account={account} />);
    fireEvent.submit(screen.getByLabelText('显示名称').closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent('网络连接失败');
    fireEvent.submit(screen.getByLabelText('显示名称').closest('form')!);
    expect(await screen.findByText('已保存。')).toBeInTheDocument();
  });
  it('reports an unsuccessful logout instead of leaving the user without feedback', async () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'network' }, { status: 503 })));
    render(<AccountPanel account={account} />);
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('status')).toHaveTextContent('退出失败');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(dispatched.mock.calls.some(([event]) => event.type === 'zimage:auth-changed')).toBe(false);
  });
  it('returns a confirmed logout to the homepage and clears only the known signed-out presentation', async () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ signedOut: true })));
    render(<AccountPanel account={account} />);
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/home'));
    const changed = dispatched.mock.calls.find(([event]) => event.type === 'zimage:auth-changed')?.[0] as CustomEvent;
    expect(changed.detail).toBe(false);
    expect(navigation.push).not.toHaveBeenCalled();
  });
  it('returns an explicitly expired account action to the homepage', async () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'unauthorized' }, { status: 401 })));
    render(<AccountPanel account={account} />);
    fireEvent.submit(screen.getByLabelText('显示名称').closest('form')!);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/home'));
    expect(dispatched.mock.calls.some(([event]) => event.type === 'zimage:auth-changed' && (event as CustomEvent).detail === false)).toBe(true);
  });
  it('does not treat a profile service failure as logout or redirect a valid account', async () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'network' }, { status: 503 })));
    render(<AccountPanel account={account} />);
    fireEvent.submit(screen.getByLabelText('显示名称').closest('form')!);
    await screen.findByText('保存失败。');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(dispatched.mock.calls.some(([event]) => event.type === 'zimage:auth-changed')).toBe(false);
    expect(screen.getByText(`邮箱：${account.email}`)).toBeVisible();
  });
  it.each([200, 503])('does not clear a valid session after an ambiguous logout 401 when the identity probe returns %s', async (identityStatus) => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ code: 'unauthorized', message: '认证请求失败' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json(identityStatus === 200 ? { id: account.id } : { code: 'network' }, { status: identityStatus }));
    vi.stubGlobal('fetch', fetcher);
    render(<AccountPanel account={account} />);
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('status')).toHaveTextContent('退出失败');
    expect(fetcher).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ cache: 'no-store' }));
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(dispatched.mock.calls.some(([event]) => event.type === 'zimage:auth-changed')).toBe(false);
  });
  it('requires the actual signedOut success contract before clearing a session', async () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ signedOut: false })));
    render(<AccountPanel account={account} />);
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('status')).toHaveTextContent('退出失败');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(dispatched.mock.calls.some(([event]) => event.type === 'zimage:auth-changed')).toBe(false);
  });
  it('does not report a rejected password update as successful', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ updated: false })));
    render(<AccountPanel account={account} />);
    fireEvent.submit(screen.getByLabelText('新密码').closest('form')!);
    expect(await screen.findByText('密码更新失败。')).toBeInTheDocument();
  });
  it('does not report deletion as accepted after password rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accepted: false })));
    render(<AccountPanel account={account} />);
    fireEvent.submit(screen.getByLabelText('重新输入密码').closest('form')!);
    fireEvent.click(await screen.findByRole('button', { name: '确认注销' }));
    expect(await screen.findByText('密码验证失败，注销未受理。')).toBeInTheDocument();
  });
  it('only sends account deletion after explicit dialog confirmation and lets cancellation retry', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ accepted: true }));
    vi.stubGlobal('fetch', fetcher);
    render(<AccountPanel account={account} />);
    fireEvent.change(screen.getByLabelText('重新输入密码'), { target: { value: 'test-password' } });
    fireEvent.submit(screen.getByLabelText('重新输入密码').closest('form')!);
    expect(await screen.findByRole('dialog', { name: '确认注销账号' })).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText('重新输入密码').closest('form')!);
    fireEvent.click(await screen.findByRole('button', { name: '确认注销' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/account', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ password: 'test-password', confirmation: 'DELETE' }),
    })));
  });

});
