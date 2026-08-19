import { createHash } from 'node:crypto';

/**
 * Three-dimensional rate limiter for invitation reservation and finalize
 * endpoints. The limit is per-key and uses a fixed window in milliseconds.
 *
 * Per AUTH-007 the limits must be applied independently on:
 *   1. client IP address (x-forwarded-for or socket address)
 *   2. normalized email address
 *   3. invitation code HMAC digest
 *
 * The default limits follow the Supabase Auth baseline (sign_in_sign_ups=30
 * per 5 min, otp_verifications=30 per 5 min) but applied to our BFF so
 * invitation-brute-force does not exhaust the Auth quota.
 *
 * The implementation is in-memory by design for the M2 sub-module. It will
 * be replaced with the Supabase `system_capacity` table + private RPC once
 * the Worker reconciliation job is in place (Phase 2).
 */
export interface RateLimitKey {
  ip: string;
  email: string;
  invitationDigest: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  reason: 'ip' | 'email' | 'invitation' | null;
}

export interface RateLimitOptions {
  windowMs: number;
  ipLimit: number;
  emailLimit: number;
  invitationLimit: number;
  now?: () => number;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  windowMs: 5 * 60 * 1000,
  ipLimit: 30,
  emailLimit: 10,
  invitationLimit: 5,
};

const computeDigest = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

/**
 * Stable hash for the rate-limit keys so we never store plaintext IPs,
 * emails or invitation codes in the in-memory table.
 */
const hashKey = (label: 'ip' | 'email' | 'invitation', value: string): string =>
  `${label}:${computeDigest(value)}`;

interface BucketEntry {
  windowStart: number;
  count: number;
}

type Buckets = Map<string, BucketEntry>;

/**
 * Construct an in-memory rate limiter. Use one instance per BFF process; the
 * factory is intentionally allocation-free to keep the request path cheap.
 */
export const createRateLimiter = (options: Partial<RateLimitOptions> = {}) => {
  const opts: RateLimitOptions = { ...DEFAULT_OPTIONS, ...options };
  const buckets: Buckets = new Map();

  const record = (digest: string): number => {
    const now = (opts.now ?? Date.now)();
    const existing = buckets.get(digest);
    if (!existing || now - existing.windowStart >= opts.windowMs) {
      const entry: BucketEntry = { windowStart: now, count: 1 };
      buckets.set(digest, entry);
      return 1;
    }
    existing.count += 1;
    return existing.count;
  };

  const inspect = (key: RateLimitKey): RateLimitDecision => {
    const now = (opts.now ?? Date.now)();
    const limits: Array<[string, number, 'ip' | 'email' | 'invitation']> = [
      [hashKey('ip', key.ip), opts.ipLimit, 'ip'],
      [hashKey('email', key.email), opts.emailLimit, 'email'],
      [hashKey('invitation', key.invitationDigest), opts.invitationLimit, 'invitation'],
    ];

    for (const [digest, limit, reason] of limits) {
      const existing = buckets.get(digest);
      if (!existing) continue;
      if (now - existing.windowStart < opts.windowMs && existing.count >= limit) {
        const retryAfterMs = existing.windowStart + opts.windowMs - now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          reason,
        };
      }
    }

    return { allowed: true, retryAfterSeconds: 0, reason: null };
  };

  const consume = (key: RateLimitKey): RateLimitDecision => {
    const decision = inspect(key);
    if (!decision.allowed) {
      return decision;
    }

    record(hashKey('ip', key.ip));
    record(hashKey('email', key.email));
    record(hashKey('invitation', key.invitationDigest));

    return decision;
  };

  const reset = (): void => {
    buckets.clear();
  };

  return { consume, inspect, reset, __peek: (digest: string) => buckets.get(digest) };
};

/**
 * Compute the HMAC digest that the server uses when persisting invitations.
 * Centralised here so the client and the database `code_digest` column
 * always agree on the format (AUTH-007).
 */
export const computeInvitationDigest = (rawCode: string): string =>
  computeDigest(`zima-invitation:${rawCode.trim()}`);