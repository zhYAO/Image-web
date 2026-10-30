import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeBoundary } from '../src/platform/runtime-boundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('offers explicit recovery without exposing an exception or retrying a business request', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const request = vi.spyOn(globalThis, 'fetch');
  function Broken(): never { throw new Error('private payload must not be shown'); }
  render(<RuntimeBoundary><Broken /></RuntimeBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('暂时无法打开创作空间');
  expect(screen.getByRole('button', { name: '重新打开' })).not.toBeNull();
  expect(screen.queryByText('private payload must not be shown')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
