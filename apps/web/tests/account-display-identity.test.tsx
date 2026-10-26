import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPanel } from '@/features/account/AccountPanel';

const state = vi.hoisted(() => ({ status: 'authorized', ownerId: '10000000-0000-4000-8000-000000000001' }));
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const identity = vi.hoisted(() => ({ refresh: vi.fn(), notify: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/features/auth/AuthStatusProvider', () => ({ useAuthStatus: () => ({ ...state, refresh: identity.refresh }), notifyAuthChange: identity.notify }));
vi.mock('@/features/credits/CreditsProvider', () => ({ CreditAccount: () => <p>private credit account</p>, CreditBalance: () => null }));
const oldAccount = { id: '10000000-0000-4000-8000-000000000001', email: 'old@example.test', displayName: 'old name', status: 'active' as const };
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true'); state.status = 'authorized'; state.ownerId = oldAccount.id; });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('cached account display identity', () => {
  it('immediately hides cached private fields and controls after confirmed logout', async () => {
    const view = render(<AccountPanel account={oldAccount} />);
    expect(screen.getByText(`邮箱：${oldAccount.email}`)).toBeVisible();
    state.status = 'guest'; state.ownerId = '';
    view.rerender(<AccountPanel account={oldAccount} />);
    expect(screen.queryByText(`邮箱：${oldAccount.email}`)).toBeNull();
    expect(screen.queryByText('private credit account')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存资料' })).toBeNull();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/home'));
  });
  it('refreshes mismatched cached account props without clearing the new valid identity', async () => {
    const view = render(<AccountPanel account={oldAccount} />);
    state.ownerId = '20000000-0000-4000-8000-000000000002';
    view.rerender(<AccountPanel account={oldAccount} />);
    expect(screen.queryByText(`邮箱：${oldAccount.email}`)).toBeNull();
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(identity.notify).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    view.rerender(<AccountPanel account={{ ...oldAccount, id: state.ownerId, email: 'new@example.test' }} />);
    expect(screen.getByText('邮箱：new@example.test')).toBeVisible();
    expect(screen.queryByText(`邮箱：${oldAccount.email}`)).toBeNull();
  });
  it('hides stale account content during identity errors and retries without claiming logout', async () => {
    const view = render(<AccountPanel account={oldAccount} />);
    state.status = 'error'; state.ownerId = '';
    view.rerender(<AccountPanel account={oldAccount} />);
    expect(screen.queryByText(`邮箱：${oldAccount.email}`)).toBeNull();
    screen.getByRole('button', { name: '重新检查' }).click();
    expect(identity.refresh).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(identity.notify).not.toHaveBeenCalled();
    state.status = 'authorized'; state.ownerId = oldAccount.id;
    view.rerender(<AccountPanel account={oldAccount} />);
    expect(screen.getByText(`邮箱：${oldAccount.email}`)).toBeVisible();
  });
  it('does not expose cached account data while identity is still checking', () => {
    state.status = 'checking'; state.ownerId = '';
    render(<AccountPanel account={oldAccount} />);
    expect(screen.queryByText(`邮箱：${oldAccount.email}`)).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(identity.notify).not.toHaveBeenCalled();
  });
});
