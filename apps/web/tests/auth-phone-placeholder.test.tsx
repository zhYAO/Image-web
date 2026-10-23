import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPanel } from '../features/auth/AuthPanel';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('phone authentication placeholder', () => {
  it('discloses the unavailable SMS service and cannot submit or establish a session', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const authChanged = vi.fn();
    window.addEventListener('zimage:auth-changed', authChanged);
    try {
      render(<AuthPanel />);
      fireEvent.click(screen.getByRole('button', { name: '手机号验证码' }));
      const phone = screen.getByRole('region', { name: '手机号验证码登录' });
      expect(within(phone).getByText(/短信服务尚未接入/)).toBeVisible();
      expect(within(phone).getByLabelText('手机号')).toBeDisabled();
      expect(within(phone).getByLabelText('验证码')).toBeDisabled();
      const send = within(phone).getByRole('button', { name: '获取验证码' });
      const login = within(phone).getByRole('button', { name: '手机号登录暂未开放' });
      expect(send).toBeDisabled();
      expect(login).toBeDisabled();
      fireEvent.click(send);
      fireEvent.click(login);
      fireEvent.submit(screen.getByLabelText('邮箱').closest('form')!);
      expect(phone.querySelector('form')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(authChanged).not.toHaveBeenCalled();
    } finally { window.removeEventListener('zimage:auth-changed', authChanged); }
  });

  it('preserves the email draft and registration and recovery entries across channel changes', () => {
    render(<AuthPanel legalVersion="approved-test" />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'creator@example.com' } });
    fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: 'Private-draft-42!' } });
    fireEvent.click(screen.getByRole('button', { name: '手机号验证码' }));
    expect(screen.queryByRole('textbox', { name: '邮箱' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '邮箱登录' }));
    expect(screen.getByRole('textbox', { name: '邮箱' })).toHaveValue('creator@example.com');
    expect(screen.getByLabelText('密码', { exact: true })).toHaveValue('Private-draft-42!');
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(screen.getByRole('heading', { name: '创建账号' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '忘记密码' }));
    expect(screen.getByRole('heading', { name: '找回密码' })).toBeVisible();
  });
});
