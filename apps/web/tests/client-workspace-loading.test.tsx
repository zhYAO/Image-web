import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { ClientWorkspace } from '@/app/client-workspace';

const state = vi.hoisted(() => ({ status: 'checking', load: vi.fn() }));
vi.mock('@/features/workspace/load-workspace', () => ({
  loadWorkspace: () => { state.load(); return Promise.resolve({ WorkspaceApplication: () => <p>editor ready</p> }); },
  prefetchWorkspace: () => { state.load(); },
}));
vi.mock('@/app/anonymous-auth-gate', () => ({
  AnonymousAuthGate: ({ children }: { children: ReactNode }) => state.status === 'authorized' ? children : <p>{state.status}</p>,
}));

it('does not download the editor while identity is checking, failed or guest', async () => {
  const view = render(<ClientWorkspace />);
  expect(state.load).not.toHaveBeenCalled();
  for (const status of ['error', 'guest']) {
    state.status = status;
    view.rerender(<ClientWorkspace />);
    expect(screen.getByText(status)).toBeVisible();
    expect(state.load).not.toHaveBeenCalled();
  }
  state.status = 'authorized';
  view.rerender(<ClientWorkspace />);
  expect(await screen.findByText('editor ready')).toBeVisible();
  expect(state.load).toHaveBeenCalledTimes(1);
});
