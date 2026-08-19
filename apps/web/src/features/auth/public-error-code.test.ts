import { describe, expect, it } from 'vitest';

import { PUBLIC_AUTH_ERROR_KEYS, parseAuthErrorCode, UNMAPped_AUTH_ERROR_KEY } from './public-error-code';

describe('parseAuthErrorCode', () => {
  it('returns the trimmed code for known values', () => {
    expect(parseAuthErrorCode('rate_limited')).toBe('rate_limited');
    expect(parseAuthErrorCode('  invitation_not_found  ')).toBe('invitation_not_found');
  });

  it('returns null for empty or whitespace input', () => {
    expect(parseAuthErrorCode(undefined)).toBeNull();
    expect(parseAuthErrorCode(null)).toBeNull();
    expect(parseAuthErrorCode('')).toBeNull();
    expect(parseAuthErrorCode('   ')).toBeNull();
  });

  it('returns null for unknown codes', () => {
    expect(parseAuthErrorCode('not_a_real_code')).toBeNull();
    expect(parseAuthErrorCode('rate_limited; DROP TABLE profiles')).toBeNull();
  });
});

describe('PUBLIC_AUTH_ERROR_KEYS', () => {
  it('exposes a key for every AuthErrorCode', () => {
    const known: ReadonlyArray<string> = [
      'invalid_input',
      'rate_limited',
      'invitation_not_found',
      'invitation_disabled',
      'invitation_expired',
      'invitation_not_approved',
      'invitation_already_redeemed',
      'reservation_active_for_other_email',
      'reservation_expired',
      'reservation_already_consumed',
      'session_unverified',
      'profile_already_exists',
      'insufficient_credits',
      'internal_error',
    ];
    for (const code of known) {
      expect(PUBLIC_AUTH_ERROR_KEYS[code as keyof typeof PUBLIC_AUTH_ERROR_KEYS]).toBe(code);
    }
  });

  it('exports a fallback key for unmapped codes', () => {
    expect(UNMAPped_AUTH_ERROR_KEY).toBe('unmapped_error_code');
  });
});