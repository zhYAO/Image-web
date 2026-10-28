import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/globals.css'), 'utf8');
const light = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';
const dark = css.match(/:root\[data-z-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? '';
const token = (block: string, name: string) => new RegExp(`--z-${name}:\\s*([^;]+);`).exec(block)?.[1];

describe('reference system palette', () => {
  it('keeps reference reading surfaces and violet brand in light mode', () => {
    expect(token(light, 'bg')).toBe('#f5f4f8');
    expect(token(light, 'panel')).toBe('#fff');
    expect(token(light, 'text')).toBe('#292630');
    expect(token(light, 'primary')).toBe('#7050b5');
  });
  it('keeps reference dark surfaces with readable foregrounds', () => {
    expect(token(dark, 'panel')).toBe('#25212d');
    expect(token(dark, 'text')).toBe('#f2edf7');
    expect(token(dark, 'primary')).toBe('#b99ae9');
  });
});
