import { describe, expect, it } from 'vitest';

import {
  authErrorCodeSchema,
  finalizeInvitationResultSchema,
  finalizeInvitationSchema,
  invitationCodeInputSchema,
  normalizeEmailAddress,
  normalizedEmailSchema,
  reservationPublicViewSchema,
  reserveInvitationSchema,
} from './invitation.js';

describe('invitationCodeInputSchema', () => {
  it('accepts a conservative alphanumeric code', () => {
    const parsed = invitationCodeInputSchema.parse({ code: 'Zima-Invite_2026A' });
    expect(parsed.code).toBe('Zima-Invite_2026A');
  });

  it('rejects whitespace, symbols and overly short codes', () => {
    expect(() => invitationCodeInputSchema.parse({ code: 'short' })).toThrow();
    expect(() => invitationCodeInputSchema.parse({ code: 'has space' })).toThrow();
    expect(() => invitationCodeInputSchema.parse({ code: 'has;symbol' })).toThrow();
    expect(() => invitationCodeInputSchema.parse({ code: '' })).toThrow();
    expect(() => invitationCodeInputSchema.parse({ code: 'x'.repeat(200) })).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      invitationCodeInputSchema.parse({ code: 'Zima-Invite_2026A', supplier: 'aliyun' }),
    ).toThrow();
  });
});

describe('normalizedEmailSchema', () => {
  it('lowercases and trims input', () => {
    expect(normalizedEmailSchema.parse('  Foo.Bar@Example.COM ')).toBe('foo.bar@example.com');
  });

  it('rejects invalid email syntax', () => {
    expect(() => normalizedEmailSchema.parse('not-an-email')).toThrow();
  });
});

describe('normalizeEmailAddress', () => {
  it('exposes the parsed canonical form', () => {
    expect(normalizeEmailAddress('Designer@Zima.cn')).toBe('designer@zima.cn');
  });
});

describe('reserveInvitationSchema', () => {
  it('accepts the canonical payload', () => {
    const parsed = reserveInvitationSchema.parse({
      code: 'Zima-Invite_2026A',
      email: 'designer@zima.cn',
      idempotencyKey: 'client-uuid-0123456789abcdef',
    });
    expect(parsed.idempotencyKey).toBe('client-uuid-0123456789abcdef');
  });

  it('rejects unknown fields to avoid supplier leakage', () => {
    expect(() =>
      reserveInvitationSchema.parse({
        code: 'Zima-Invite_2026A',
        email: 'designer@zima.cn',
        idempotencyKey: 'client-uuid-0123456789abcdef',
        providerId: 'aliyun-bailian',
      }),
    ).toThrow();
  });
});

describe('reservationPublicViewSchema', () => {
  it('accepts an ISO timestamp', () => {
    const parsed = reservationPublicViewSchema.parse({
      challenge: 'a'.repeat(32),
      expiresAt: '2026-08-19T12:34:56.000Z',
    });
    expect(parsed.expiresAt).toBe('2026-08-19T12:34:56.000Z');
  });

  it('rejects a non-ISO timestamp', () => {
    expect(() =>
      reservationPublicViewSchema.parse({ challenge: 'a'.repeat(32), expiresAt: 'soon' }),
    ).toThrow();
  });
});

describe('finalizeInvitationSchema', () => {
  it('only accepts the challenge', () => {
    expect(() =>
      finalizeInvitationSchema.parse({
        challenge: 'a'.repeat(32),
        userId: '11111111-1111-1111-1111-111111111111',
      }),
    ).toThrow();
  });
});

describe('finalizeInvitationResultSchema', () => {
  it('accepts the canonical DTO', () => {
    const parsed = finalizeInvitationResultSchema.parse({
      profileId: '11111111-1111-4111-8111-111111111111',
      initialCreditsGranted: 50,
      priceBookVersionId: '22222222-2222-4222-8222-222222222222',
    });
    expect(parsed.initialCreditsGranted).toBe(50);
  });
});

describe('authErrorCodeSchema', () => {
  it('exposes the documented stable codes', () => {
    expect(authErrorCodeSchema.options).toContain('invalid_input');
    expect(authErrorCodeSchema.options).toContain('rate_limited');
    expect(authErrorCodeSchema.options).toContain('invitation_not_approved');
  });
});