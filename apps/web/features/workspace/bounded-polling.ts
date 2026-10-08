export function nextPollingDelay(createdAt: string, kind: 'generation' | 'commerce', now = Date.now()): number | null {
  const age = now - Date.parse(createdAt);
  if (!Number.isFinite(age) || age >= 3_600_000) return null;
  if (age < 120_000) return kind === 'generation' ? 3000 : 5000;
  if (age < 600_000) return kind === 'generation' ? 10_000 : 15_000;
  return 60_000;
}
