import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from '@/features/brand/landing/LandingPage';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const owner = '123e4567-e89b-42d3-a456-426614174000';
describe('public landing authentication', () => {
  it('sends every guest creation CTA directly to login with a workspace return', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<LandingPage />);
    for (const link of screen.getAllByRole('link', { name: /开始创作/ }))
      expect(link).toHaveAttribute('href', '/login?returnTo=%2Fworkspace');
    expect(screen.getAllByRole('link', { name: '登录' }).length).toBeGreaterThan(0);
  });
  it('hides both login links for a verified account and handles session expiry', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: owner }))));
    render(<LandingPage />);
    await waitFor(() => expect(screen.queryAllByRole('link', { name: '登录' })).toHaveLength(0));
    for (const link of screen.getAllByRole('link', { name: /开始创作/ }))
      expect(link).toHaveAttribute('href', '/workspace');
    act(() => window.dispatchEvent(new Event('zimage:auth-required')));
    await waitFor(() => expect(screen.getAllByRole('link', { name: '登录' }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('link', { name: /开始创作/ })[0]).toHaveAttribute('href', '/login?returnTo=%2Fworkspace');
  });
  it('keeps the homepage and login usable during an identity failure', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole('link', { name: '登录' }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('link', { name: /开始创作/ })[0]).toHaveAttribute('href', '/login?returnTo=%2Fworkspace');
  });
});
