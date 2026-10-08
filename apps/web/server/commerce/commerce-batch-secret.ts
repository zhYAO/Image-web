import { timingSafeEqual } from 'node:crypto';

export function hasBatchWorkerSecret(received: string | null, configured: string | undefined) {
  if (!received || !configured) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(configured);
  return left.length === right.length && timingSafeEqual(left, right);
}
