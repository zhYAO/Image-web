import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

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
