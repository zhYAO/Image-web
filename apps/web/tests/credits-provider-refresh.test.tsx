import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CreditsProvider, useCredits } from '@/features/credits/CreditsProvider';
const state = vi.hoisted(() => ({ ownerId: 'a', status: 'authorized', catalog: vi.fn(), wallet: vi.fn() }));
vi.mock('@/features/auth/AuthStatusProvider', () => ({ useAuthStatus: () => state }));
vi.mock('@/gateways', () => ({ getWorkspaceGateway: () => ({ getCreditCatalog: state.catalog, getCreditWallet: state.wallet }) }));
function Wallet() {
  const value = useCredits();
  return <button onClick={value.refresh}>{value.wallet?.availableMinor ?? 'pending'}</button>;
}
afterEach(() => { vi.restoreAllMocks(); state.ownerId = 'a'; state.status = 'authorized'; });
it('coalesces refreshes, suspends hidden polling, and rejects a previous owner result', async () => {
  const resolvers: Array<(value: unknown) => void> = [];
  state.catalog.mockResolvedValue({ enabled: false });
  state.wallet.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
  const view = render(<CreditsProvider><Wallet /></CreditsProvider>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button'));
  expect(state.wallet).toHaveBeenCalledTimes(1);
  state.ownerId = 'b';
  view.rerender(<CreditsProvider><Wallet /></CreditsProvider>);
  await act(async () => {});
  expect(state.wallet).toHaveBeenCalledTimes(2);
  await act(async () => resolvers[0]!({ availableMinor: 100 }));
  expect(screen.getByRole('button')).toHaveTextContent('pending');
  await act(async () => resolvers[1]!({ availableMinor: 200 }));
  expect(screen.getByRole('button')).toHaveTextContent('200');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(state.wallet).toHaveBeenCalledTimes(2);
});
