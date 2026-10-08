import { describe, expect, it } from 'vitest';
import { nextPollingDelay } from '@/features/workspace/bounded-polling';

describe('bounded task polling', () => {
  const created = '2026-10-08T00:00:00Z';
  it('slows ordinary generation after two and ten minutes', () => {
    expect(nextPollingDelay(created, 'generation', Date.parse(created))).toBe(3000);
    expect(nextPollingDelay(created, 'generation', Date.parse(created) + 120_000)).toBe(10_000);
    expect(nextPollingDelay(created, 'generation', Date.parse(created) + 600_000)).toBe(60_000);
  });
  it('stops after one hour even if a page is reopened', () => {
    expect(nextPollingDelay(created, 'commerce', Date.parse(created))).toBe(5000);
    expect(nextPollingDelay(created, 'commerce', Date.parse(created) + 120_000)).toBe(15_000);
    expect(nextPollingDelay(created, 'commerce', Date.parse(created) + 3_600_000)).toBeNull();
  });
});
