import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  computeInvitationDigest,
  createRateLimiter,
  type RateLimitKey,
} from './rate-limit.js';

const key = (overrides: Partial<RateLimitKey> = {}): RateLimitKey => ({
  ip: '203.0.113.1',
  email: 'designer@zima.cn',
  invitationDigest: computeInvitationDigest('Zima-Invite_2026A'),
  ...overrides,
});

describe('computeInvitationDigest', () => {
  it('is deterministic', () => {
    expect(computeInvitationDigest('Zima-Invite_2026A')).toBe(
      computeInvitationDigest('Zima-Invite_2026A'),
    );
  });

  it('changes when the code changes', () => {
    expect(computeInvitationDigest('Zima-Invite_2026A')).not.toBe(
      computeInvitationDigest('Zima-Invite_2026B'),
    );
  });

  it('trims surrounding whitespace', () => {
    expect(computeInvitationDigest('  Zima-Invite_2026A  ')).toBe(
      computeInvitationDigest('Zima-Invite_2026A'),
    );
  });
});

describe('createRateLimiter', () => {
  it('admits the first request', () => {
    const limiter = createRateLimiter();
    expect(limiter.consume(key()).allowed).toBe(true);
  });

  it('rejects when the IP limit is reached', () => {
    const clock = { value: 0 };
    const limiter = createRateLimiter({
      ipLimit: 2,
      emailLimit: 100,
      invitationLimit: 100,
      now: () => clock.value,
    });

    expect(limiter.consume(key()).allowed).toBe(true);
    expect(limiter.consume(key()).allowed).toBe(true);
    const decision = limiter.consume(key());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('ip');
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rejects when the email limit is reached', () => {
    const clock = { value: 0 };
    const limiter = createRateLimiter({
      ipLimit: 100,
      emailLimit: 1,
      invitationLimit: 100,
      now: () => clock.value,
    });

    expect(limiter.consume(key()).allowed).toBe(true);
    const decision = limiter.consume(key());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('email');
  });

  it('rejects when the invitation limit is reached', () => {
    const clock = { value: 0 };
    const limiter = createRateLimiter({
      ipLimit: 100,
      emailLimit: 100,
      invitationLimit: 1,
      now: () => clock.value,
    });

    expect(limiter.consume(key()).allowed).toBe(true);
    const decision = limiter.consume(key({ ip: '203.0.113.99', email: 'other@zima.cn' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('invitation');
  });

  it('allows requests again after the window expires', () => {
    const clock = { value: 0 };
    const limiter = createRateLimiter({
      ipLimit: 1,
      emailLimit: 1,
      invitationLimit: 1,
      windowMs: 1000,
      now: () => clock.value,
    });

    expect(limiter.consume(key()).allowed).toBe(true);
    expect(limiter.consume(key()).allowed).toBe(false);

    clock.value = 1500;
    expect(limiter.consume(key()).allowed).toBe(true);
  });

  it('hashes all three keys before storing them', () => {
    const limiter = createRateLimiter({ ipLimit: 100, emailLimit: 100, invitationLimit: 100 });
    limiter.consume(key());

    const expectedIpDigest =
      'ip:' + createHash('sha256').update('203.0.113.1').digest('hex');
    expect(limiter.__peek(expectedIpDigest)?.count).toBe(1);
  });
});