import { describe, expect, it } from 'vitest';
import { hasBatchWorkerSecret } from '@/server/commerce/commerce-batch-secret';

describe('creative batch worker authorization', () => {
  it('rejects a missing configuration and a wrong secret', () => {
    expect(hasBatchWorkerSecret('abc', undefined)).toBe(false);
    expect(hasBatchWorkerSecret('abc', 'abd')).toBe(false);
    expect(hasBatchWorkerSecret(null, 'abc')).toBe(false);
  });
  it('accepts only the exact configured secret', () => {
    expect(hasBatchWorkerSecret('abc', 'abc')).toBe(true);
    expect(hasBatchWorkerSecret('abc ', 'abc')).toBe(false);
  });
});
