import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Node 26 exposes an unavailable experimental localStorage as `undefined` when
// no --localstorage-file is supplied. Vitest then keeps that Node global instead
// of copying jsdom's browser storage into the test window.
const jsdomWindow = (globalThis as typeof globalThis & { jsdom?: { window: Window } }).jsdom?.window;
if (typeof window.localStorage === 'undefined' && jsdomWindow) {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: jsdomWindow.localStorage,
  });
}

globalThis.ResizeObserver = class {
  disconnect() {}
  observe() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;

const nativeGetComputedStyle = window.getComputedStyle.bind(window);
const zeroLengthProperties = new Set([
  'border-bottom-width',
  'border-top-width',
  'padding-bottom',
  'padding-top',
]);

Object.defineProperty(window, 'getComputedStyle', {
  value: (element: Element) => {
    // jsdom does not implement pseudo-element layout (used by Ant Design's scroll lock).
    const declaration = nativeGetComputedStyle(element);
    const getPropertyValue = declaration.getPropertyValue.bind(declaration);
    Object.defineProperty(declaration, 'getPropertyValue', {
      configurable: true,
      value: (property: string) => {
        const value = getPropertyValue(property);
        if (zeroLengthProperties.has(property) && !Number.isFinite(Number.parseFloat(value))) {
          return '0px';
        }
        return value;
      },
    });
    return declaration;
  },
  writable: true,
});

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
