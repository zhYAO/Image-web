const RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 900_000] as const;

export function nextBatchAttempt(attempt: number, now: Date = new Date()): string | null {
  const delay = RETRY_DELAYS_MS[attempt - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay).toISOString();
}
