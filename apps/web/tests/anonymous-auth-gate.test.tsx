import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnonymousAuthGate } from '@/app/anonymous-auth-gate';

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  signInAnonymously: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: mocks }),
}));

vi.mock('next/script', () => ({
  default: ({ onReady }: { onReady?: () => void }) => (
    <button onClick={onReady} type="button">加载挑战脚本</button>
  ),
}));

describe('anonymous CAPTCHA gate', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DATA_MODE = 'http';
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'turnstile-test-site-key';
    mocks.getClaims.mockReset();
    mocks.signInAnonymously.mockReset();
  });

  it('renders the workspace immediately when the cookie identity is valid', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: crypto.randomUUID() } }, error: null });
    render(<AnonymousAuthGate><span>workspace ready</span></AnonymousAuthGate>);
    expect(await screen.findByText('workspace ready')).toBeVisible();
  });

  it('passes the browser challenge token to anonymous sign-in before mounting the workspace', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: new Error('missing session') });
    mocks.signInAnonymously.mockResolvedValue({ data: {}, error: null });
    const renderChallenge = vi.fn().mockReturnValue('captcha-widget');
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: { remove: vi.fn(), render: renderChallenge },
    });

    render(<AnonymousAuthGate><span>workspace ready</span></AnonymousAuthGate>);
    fireEvent.click(await screen.findByRole('button', { name: '加载挑战脚本' }));
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1));

    const options = renderChallenge.mock.calls[0]![1] as { callback(token: string): Promise<void> };
    await act(() => options.callback('captcha-token'));

    expect(mocks.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'captcha-token' } });
    expect(await screen.findByText('workspace ready')).toBeVisible();
  });

  it('offers a retry when the existing identity check fails unexpectedly', async () => {
    mocks.getClaims.mockRejectedValue(new Error('network unavailable'));

    render(<AnonymousAuthGate><span>workspace ready</span></AnonymousAuthGate>);

    expect(await screen.findByRole('button', { name: '重新验证' })).toBeVisible();
  });

  it('offers a retry when anonymous sign-in rejects', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: new Error('missing session') });
    mocks.signInAnonymously.mockRejectedValue(new Error('network unavailable'));
    const renderChallenge = vi.fn().mockReturnValue('captcha-widget');
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: { remove: vi.fn(), render: renderChallenge },
    });

    render(<AnonymousAuthGate><span>workspace ready</span></AnonymousAuthGate>);
    fireEvent.click(await screen.findByRole('button', { name: '加载挑战脚本' }));
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1));
    const options = renderChallenge.mock.calls[0]![1] as { callback(token: string): void };
    act(() => options.callback('captcha-token'));

    expect(await screen.findByRole('button', { name: '重新验证' })).toBeVisible();
  });

  it('offers a retry when the challenge widget cannot render', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: new Error('missing session') });
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: { remove: vi.fn(), render: vi.fn(() => { throw new Error('render failed'); }) },
    });

    render(<AnonymousAuthGate><span>workspace ready</span></AnonymousAuthGate>);
    fireEvent.click(await screen.findByRole('button', { name: '加载挑战脚本' }));

    expect(await screen.findByRole('button', { name: '重新验证' })).toBeVisible();
  });
});
