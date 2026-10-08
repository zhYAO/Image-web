import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPanel } from '../features/auth/AuthPanel';
import { VerifyPanel } from '../features/auth/VerifyPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/script', () => ({ default: ({ onReady, onError }: { onReady: () => void; onError: () => void }) => <><button type="button" onClick={onReady}>加载安全验证</button><button type="button" onClick={onError}>模拟脚本失败</button></> }));
const renderChallenge = vi.fn();
const removeChallenge = vi.fn();
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
  renderChallenge.mockReturnValue('widget');
  Object.defineProperty(window, 'turnstile', { configurable: true, value: { render: renderChallenge, remove: removeChallenge } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); delete window.turnstile; });
async function solve() {
  fireEvent.click(screen.getByRole('button', { name: '加载安全验证' }));
  await waitFor(() => expect(renderChallenge).toHaveBeenCalled());
  const options = renderChallenge.mock.calls.at(-1)![1];
  act(() => options.callback('fresh-challenge'));
  return options;
}

describe('formal email authentication CAPTCHA', () => {
  it.each(['login', 'register', 'recovery'] as const)('%s displays light flexible verification and accurate success/expiry/retry states', async (mode) => {
    render(<AuthPanel legalVersion="approved-test" />);
    if (mode !== 'login') fireEvent.click(screen.getByRole('button', { name: mode === 'register' ? '注册' : '忘记密码' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载安全验证');
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    const options = await solve();
    expect(options).toMatchObject({ theme: 'light', size: 'flexible' });
    expect(screen.getByRole('status')).toHaveTextContent('安全验证已通过');
    expect(screen.queryByText('请完成安全验证后提交。')).not.toBeInTheDocument();
    act(() => options['expired-callback']());
    expect(screen.getByRole('alert')).toHaveTextContent('安全验证已过期');
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    expect(removeChallenge).toHaveBeenCalledWith('widget');
    expect(screen.getByLabelText('邮箱')).toHaveValue('audit@example.com');
    act(() => options.callback('stale-token'));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载安全验证');
    await solve();
    expect(screen.getByRole('status')).toHaveTextContent('安全验证已通过');
  });

  it('reports widget and script failures and keeps submission blocked', async () => {
    render(<AuthPanel />);
    const options = await solve();
    act(() => options['error-callback']());
    expect(screen.getByRole('alert')).toHaveTextContent('安全验证未完成');
    expect(within(screen.getByLabelText('邮箱').closest('form')!).getByRole('button', { name: '登录' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '模拟脚本失败' }));
    expect(screen.getByRole('alert')).toHaveTextContent('安全验证加载失败');
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
  });

  it.each(['login', 'register', 'recovery'] as const)('%s waits for a challenge and requires a new one after a failed attempt', async (mode) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: '暂时失败' }, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    render(<AuthPanel legalVersion="approved-test" />);
    if (mode !== 'login') fireEvent.click(screen.getByRole('button', { name: mode === 'register' ? '注册' : '忘记密码' }));
    const form = screen.getByLabelText('邮箱').closest('form')!;
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    if (mode === 'register') fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(form);
    expect(fetcher).not.toHaveBeenCalled();
    await solve();
    fireEvent.submit(form);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ captchaToken: 'fresh-challenge' });
    await screen.findByText('暂时失败');
    fireEvent.submit(form);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears expired tokens and preserves the entered email when retrying the challenge', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<AuthPanel />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    const options = await solve();
    act(() => options['expired-callback']());
    fireEvent.submit(screen.getByLabelText('邮箱').closest('form')!);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByLabelText('邮箱')).toHaveValue('audit@example.com');
  });
  it('requires and forwards a challenge when resending a registration code', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ accepted: true })); vi.stubGlobal('fetch', fetcher);
    render(<VerifyPanel />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'audit@example.com' } });
    expect(screen.getByRole('button', { name: '重新发送验证码' })).toBeDisabled();
    await solve();
    fireEvent.click(screen.getByRole('button', { name: '重新发送验证码' }));
    await screen.findByRole('button', { name: '60 秒后可重发' });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ captchaToken: 'fresh-challenge' });
  });
});
