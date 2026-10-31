import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreditsProvider, useCredits } from '@/features/credits/CreditsProvider';
const state = vi.hoisted(() => ({ ownerId: 'a', status: 'authorized', catalog: vi.fn(), wallet: vi.fn() }));
vi.mock('@/features/auth/AuthStatusProvider', () => ({ useAuthStatus: () => state }));
vi.mock('@/gateways', () => ({ getWorkspaceGateway: () => ({ getCreditCatalog: state.catalog, getCreditWallet: state.wallet }) }));
function Wallet() {
  const value = useCredits();
  return <button onClick={value.refresh}>{value.wallet?.availableMinor ?? 'pending'}</button>;
}
function FrozenBalance() {
  const value = useCredits();
  return <button onClick={value.refresh}>frozen {value.wallet?.frozenMinor ?? 'pending'}</button>;
}
beforeEach(() => { state.catalog.mockReset(); state.wallet.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); state.ownerId = 'a'; state.status = 'authorized'; });

it('queues one follow-up when direct refresh arrives during an old wallet request', async () => {
  let resolveOld!: (value: unknown) => void;
  state.catalog.mockResolvedValue({ enabled: false });
  state.wallet.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ availableMinor: 311, frozenMinor: 60, spentMinor: 629 });
  render(<CreditsProvider><FrozenBalance /></CreditsProvider>);
  await act(async () => {});
  expect(state.wallet).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button'));
  expect(state.wallet).toHaveBeenCalledTimes(1);
  await act(async () => resolveOld({ availableMinor: 311, frozenMinor: 90, spentMinor: 599 }));
  expect(state.wallet).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button').textContent).toBe('frozen 60');
});

it('refreshes invalidated hidden data immediately on visibility even within the focus throttle', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  state.catalog.mockResolvedValue({ enabled: false });
  state.wallet.mockResolvedValueOnce({ availableMinor: 311, frozenMinor: 90, spentMinor: 599 })
    .mockResolvedValue({ availableMinor: 311, frozenMinor: 60, spentMinor: 629 });
  render(<CreditsProvider><FrozenBalance /></CreditsProvider>);
  await act(async () => {});
  expect(screen.getByRole('button').textContent).toBe('frozen 90');
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => window.dispatchEvent(new Event('zimage:credits-changed')));
  expect(state.wallet).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(state.wallet).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button').textContent).toBe('frozen 60');
});

it('retains an in-flight credits event when its old response finishes while hidden', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  let resolveOld!: (value: unknown) => void;
  state.catalog.mockResolvedValue({ enabled: false });
  state.wallet.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ availableMinor: 311, frozenMinor: 60, spentMinor: 629 });
  render(<CreditsProvider><FrozenBalance /></CreditsProvider>);
  await act(async () => {});
  act(() => {
    window.dispatchEvent(new Event('zimage:credits-changed'));
    window.dispatchEvent(new Event('zimage:credits-changed'));
  });
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => resolveOld({ availableMinor: 311, frozenMinor: 90, spentMinor: 599 }));
  expect(state.wallet).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(state.wallet).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button').textContent).toBe('frozen 60');
});

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
  expect(screen.getByRole('button').textContent).toBe('pending');
  await act(async () => resolvers[1]!({ availableMinor: 200 }));
  expect(screen.getByRole('button').textContent).toBe('200');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(state.wallet).toHaveBeenCalledTimes(2);
});
