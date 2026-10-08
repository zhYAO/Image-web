import { describe, expect, it } from 'vitest';
import { nextBatchAttempt } from '@/server/commerce/commerce-batch-schedule';

describe('creative batch retry schedule', () => {
  it('backs off and stops after four transient failures', () => {
    const now = new Date('2026-10-08T00:00:00Z');
    expect([1, 2, 3, 4].map(attempt => nextBatchAttempt(attempt, now))).toEqual([
      '2026-10-08T00:00:30.000Z',
      '2026-10-08T00:02:00.000Z',
      '2026-10-08T00:05:00.000Z',
      '2026-10-08T00:15:00.000Z',
    ]);
    expect(nextBatchAttempt(5, now)).toBeNull();
  });
});
