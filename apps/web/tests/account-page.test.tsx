import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiRouteError } from '../server/api-error';
import AccountPage from '../app/account/page';
const mocks = vi.hoisted(() => ({ readAccount: vi.fn() }));
vi.mock('../lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('../server/auth/account-service', () => ({ readAccount: mocks.readAccount }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, useRouter: () => ({}) }));
describe('account page service failures', () => {
  it('keeps a service outage distinct from an expired login', async () => {
    mocks.readAccount.mockRejectedValue(new ApiRouteError({ code: 'network', status: 503, retryable: true, message: 'private backend detail' }));
    render(await AccountPage());
    expect(screen.getByRole('heading')).toHaveTextContent('账号服务暂时不可用');
    expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '重新加载' })).toHaveAttribute('href', '/account');
  });
  it('redirects an expired login to the account return path', async () => {
    mocks.readAccount.mockRejectedValue(new ApiRouteError({ code: 'unauthorized', status: 401, retryable: true, message: 'expired' }));
    await expect(AccountPage()).rejects.toThrow('redirect:/login?returnTo=/account');
  });
});
