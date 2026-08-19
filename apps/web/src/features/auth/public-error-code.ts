import type { AuthErrorCode } from '@zima/domain';

/**
 * Stable mapping from `AuthErrorCode` to a UI-presentable message key under
 * the `auth.errors` namespace. The BFF surfaces error codes verbatim; the
 * client never renders raw provider messages, stack traces or invitation
 * digests (AGENTS.md §2).
 *
 * The mapping is intentionally exhaustive: any new error code added to
 * `AuthErrorCode` will surface as `unmapped_error_code` until the i18n
 * catalogue catches up.
 */
export const PUBLIC_AUTH_ERROR_KEYS: Readonly<Record<AuthErrorCode, string>> = Object.freeze({
  invalid_input: 'invalid_input',
  rate_limited: 'rate_limited',
  invitation_not_found: 'invitation_not_found',
  invitation_disabled: 'invitation_disabled',
  invitation_expired: 'invitation_expired',
  invitation_not_approved: 'invitation_not_approved',
  invitation_already_redeemed: 'invitation_already_redeemed',
  reservation_active_for_other_email: 'reservation_active_for_other_email',
  reservation_expired: 'reservation_expired',
  reservation_already_consumed: 'reservation_already_consumed',
  session_unverified: 'session_unverified',
  profile_already_exists: 'profile_already_exists',
  insufficient_credits: 'insufficient_credits',
  internal_error: 'internal_error',
});

/**
 * Coerce arbitrary URL inputs to a known `AuthErrorCode`. Returns `null`
 * for unknown values so the caller can decide whether to render an error
 * banner or stay silent.
 */
export const parseAuthErrorCode = (raw: string | undefined | null): AuthErrorCode | null => {
  if (!raw) return null;
  const candidate = raw.trim();
  if (!candidate) return null;
  if (candidate in PUBLIC_AUTH_ERROR_KEYS) {
    return candidate as AuthErrorCode;
  }
  return null;
};

/**
 * Reserved bucket for codes the BFF may emit before the catalogue is
 * updated. Lets the client show a generic actionable message instead of
 * silently dropping the banner.
 */
export const UNMAPped_AUTH_ERROR_KEY = 'unmapped_error_code';