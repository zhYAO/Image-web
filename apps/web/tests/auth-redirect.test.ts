import { describe, expect, it } from 'vitest';

import { safeReturnTo } from '@/features/auth/return-to';

describe('auth return paths', () => {
  it.each([
    ['/workspace', '/workspace'],
    ['/skills/photo?tab=detail', '/skills/photo?tab=detail'],
    [null, '/'],
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/api/account', '/'],
    ['/api', '/'],
    ['/\\evil.example', '/'],
    ['/auth/verify', '/'],
    ['/a/../api/account', '/'],
  ])('keeps only safe in-app paths: %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
