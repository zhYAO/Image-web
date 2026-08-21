import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

globalThis.ResizeObserver = class {
  disconnect() {}
  observe() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;

Object.defineProperty(window, 'matchMedia', {
  value: (query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
  writable: true,
});
