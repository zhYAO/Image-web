import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';

afterEach(() => vi.restoreAllMocks());
it.each(['light', 'dark'])('applies the %s system preference without changing child layout', mode => {
  const original = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    ...original(query), matches: mode === 'dark' && query === '(prefers-color-scheme: dark)',
  }));
  render(<AppProviders><p>Workspace content</p></AppProviders>);
  expect(document.documentElement.dataset.zTheme).toBe(mode);
  expect(screen.getByText('Workspace content')).toBeInTheDocument();
});

it('tracks a live system theme change', () => {
  const listeners = new Set<() => void>();
  let dark = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    matches: dark && query === '(prefers-color-scheme: dark)', media: query,
    onchange: null, addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as () => void),
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as () => void),
  }));
  const view = render(<AppProviders><p>Workspace content</p></AppProviders>);
  act(() => { dark = true; listeners.forEach(listener => listener()); });
  expect(document.documentElement.dataset.zTheme).toBe('dark');
  view.unmount();
  expect(listeners.size).toBe(0);
});
