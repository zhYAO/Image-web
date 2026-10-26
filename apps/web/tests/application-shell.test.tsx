import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationShell } from '@/app/application-shell';

const route = vi.hoisted(() => ({ pathname: '/home' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/providers', () => ({ AppProviders: ({ children }: { children: ReactNode }) => {
  const [count, setCount] = useState(0);
  return <><button onClick={() => setCount(n => n + 1)}>runtime {count}</button>{children}</>;
} }));
vi.mock('@/features/credits/CreditsProvider', () => ({ CreditsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/app/client-workspace', () => ({ ClientWorkspace: () => <p>editor</p> }));

describe('public landing runtime boundary', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); route.pathname = '/home'; });
  it('renders the public homepage without starting private identity checks', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'true');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    render(<ApplicationShell><h1>public homepage</h1></ApplicationShell>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'public homepage' })).toBeVisible());
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /runtime/ })).toBeNull();
  });
  it('retains the application provider tree after visiting the homepage', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', 'false');
    route.pathname = '/';
    const view = render(<ApplicationShell><h1>outlet</h1></ApplicationShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'runtime 0' }));
    route.pathname = '/home';
    view.rerender(<ApplicationShell><h1>public homepage</h1></ApplicationShell>);
    expect(screen.getByRole('button', { name: 'runtime 1' })).toBeVisible();
    route.pathname = '/';
    view.rerender(<ApplicationShell><h1>outlet</h1></ApplicationShell>);
    expect(screen.getByRole('button', { name: 'runtime 1' })).toBeVisible();
  });
});
