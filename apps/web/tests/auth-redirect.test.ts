import { describe, expect, it } from 'vitest';

import { safeReturnTo } from '@/features/auth/return-to';

describe('auth return paths', () => {
  it.each([
    ['/workspace', '/workspace'],
    ['/skills/photo?tab=detail', '/skills/photo?tab=detail'],
    [null, '/workspace'],
    ['https://evil.example', '/workspace'],
    ['//evil.example/path', '/workspace'],
    ['/api/account', '/workspace'],
    ['/api', '/workspace'],
    ['/\\evil.example', '/workspace'],
    ['/auth/verify', '/workspace'],
    ['/a/../api/account', '/workspace'],
  ])('keeps only safe in-app paths: %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
