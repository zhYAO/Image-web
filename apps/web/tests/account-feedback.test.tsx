import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountPanel } from '../features/account/AccountPanel';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
const account = { id: 'd9428888-122b-11e1-b85c-61cd3cbb3210', email: 'audit@example.com', displayName: null, status: 'active' as const };
describe('account feedback', () => {
  it('does not report a rejected password update as successful', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ updated: false })));
    render(<AccountPanel account={account} />);
    fireEvent.submit(screen.getByLabelText('新密码').closest('form')!);
    expect(await screen.findByText('密码更新失败。')).toBeInTheDocument();
  });
  it('does not report deletion as accepted after password rejection', async () => {
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accepted: false })));
    render(<AccountPanel account={account} />);
    fireEvent.submit(screen.getByLabelText('重新输入密码').closest('form')!);
    expect(await screen.findByText('密码验证失败，注销未受理。')).toBeInTheDocument();
  });
});
