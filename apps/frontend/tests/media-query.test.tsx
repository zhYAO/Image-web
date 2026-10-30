import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { useMediaQuery } from '../src/platform/use-media-query';
function Probe() { return <span>{useMediaQuery('(min-width: 900px)') ? 'wide' : 'narrow'}</span>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('uses a safe narrow server snapshot without a browser', () => { expect(renderToString(<Probe />)).toBe('<span>narrow</span>'); });
it('subscribes to the browser media query and cleans up the exact listener', () => {
  let notify = () => {};
  const media = { matches: false, addEventListener: vi.fn((_event: string, callback: () => void) => { notify = callback; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  const view = render(<Probe />);
  expect(screen.getByText('narrow')).not.toBeNull();
  act(() => { media.matches = true; notify(); });
  expect(screen.getByText('wide')).not.toBeNull();
  view.unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith('change', notify);
});
