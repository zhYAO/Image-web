import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPanel } from '../features/auth/AuthPanel';
import { ResetPasswordPanel } from '../features/auth/ResetPasswordPanel';
import { VerifyPanel } from '../features/auth/VerifyPanel';
import { AuthService } from '../server/auth/auth-service';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function submitForm() { fireEvent.submit(screen.getByLabelText('邮箱').closest('form')!); }

describe('auth delivery feedback', () => {
  it('does not claim mail was sent when registration was rejected with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accepted: false, reason: 'legal_unavailable' })));
    render(<AuthPanel legalVersion="approved-test-version" />);
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: 'Unique-4G!qR8' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'Unique-4G!qR8' } });
    fireEvent.click(screen.getByRole('checkbox'));
    submitForm();
    expect(await screen.findByRole('alert')).toHaveTextContent(/注册暂未开放/);
    expect(screen.queryByText('请检查邮箱并按提示继续。')).not.toBeInTheDocument();
  });
  it('shows a service failure instead of hiding it behind a credentials error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: '认证服务暂不可用，请联系管理员。' }, { status: 503 })));
    render(<AuthPanel />); submitForm();
    expect(await screen.findByRole('alert')).toHaveTextContent('认证服务暂不可用');
  });
  it('recovers from a network failure and unlocks submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<AuthPanel />); submitForm();
    expect(await screen.findByRole('alert')).toHaveTextContent(/网络/);
    expect(screen.getAllByRole('button', { name: '登录' })[0]).toBeEnabled();
  });
  it('does not report password reset success when updated is false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ updated: false })));
    render(<ResetPasswordPanel />); submitForm();
    expect(await screen.findByRole('alert')).toHaveTextContent(/验证码/);
    expect(screen.queryByText(/密码已重置/)).not.toBeInTheDocument();
  });
  it('omits absent returnTo rather than submitting null to the OTP contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: '验证码无效' }, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    render(<VerifyPanel />); submitForm();
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body)).not.toHaveProperty('returnTo');
  });
});

describe('mail delivery failures', () => {
  it.each(['resendSignup', 'requestPasswordReset'] as const)('%s rejects delivery errors', async (method) => {
    const fail = vi.fn().mockResolvedValue({ data: {}, error: { code: 'over_email_send_rate_limit', status: 429 } });
    const auth = new AuthService({ auth: { resend: fail, resetPasswordForEmail: fail } } as never);
    await expect(auth[method]('audit@example.com', 'http://localhost:3000/auth/reset')).rejects.toMatchObject({ status: 429 });
  });
  it('does not report a password update as successful after provider rejection', async () => {
    const auth = new AuthService({ auth: { updateUser: vi.fn().mockResolvedValue({ error: { code: 'weak_password' } }) } } as never);
    await expect(auth.updatePassword('weak')).rejects.toMatchObject({ status: 401 });
  });
});

describe('verification navigation and resend', () => {
  it('provides a verification entry after an accepted registration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accepted: true })));
    render(<AuthPanel legalVersion="approved-test-version" />);
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    submitForm();
    expect(await screen.findByRole('link', { name: '输入邮箱验证码' })).toHaveAttribute('href', '/auth/verify?email=audit%40example.com&returnTo=%2F');
  });
  it('shows resend failure and never claims delivery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: '邮件暂时无法发送' }, { status: 503 })));
    render(<VerifyPanel />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '重新发送验证码' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/无法发送/);
    expect(screen.getByRole('button', { name: '重新发送验证码' })).toBeEnabled();
  });
  it('prevents immediate repeated delivery after successful resend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accepted: true })));
    render(<VerifyPanel />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '重新发送验证码' }));
    expect(await screen.findByRole('button', { name: '60 秒后可重发' })).toBeDisabled();
  });
});
