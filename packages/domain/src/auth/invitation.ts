import { z } from 'zod';

/**
 * AUTH-001..011 (M1) invariants for invitation codes, reservations and OTP.
 *
 * The browser never sends plaintext codes beyond this layer and never receives
 * supplier or account identifiers back from these schemas. Server-side rate
 * limiting, HMAC digesting, and 10-minute reservation expiry are enforced by
 * the migration; these Zod schemas provide the parse boundary so unknown or
 * out-of-range fields cannot reach the BFF.
 */

// ----- Invitation code input ------------------------------------------------

/**
 * Plaintext invitation code submitted by the user. The BFF must HMAC this
 * value before any persistence lookup; the database never stores plaintext
 * (AUTH-007). Length limits are conservative to avoid buffer abuse.
 */
export const invitationCodeInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(8, 'Invitation code must be at least 8 characters')
      .max(128, 'Invitation code must be at most 128 characters')
      .regex(/^[A-Za-z0-9_-]+$/, 'Invitation code may only contain letters, digits, underscore or dash'),
  })
  .strict();

export type InvitationCodeInput = z.infer<typeof invitationCodeInputSchema>;

/**
 * Normalized email used for reservation and rate-limit hashing. The BFF is
 * responsible for calling `normalizeEmailAddress` before persisting.
 */
export const normalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email must be at least 3 characters')
  .max(254, 'Email must be at most 254 characters')
  .email('Email must be a valid address');

export type NormalizedEmail = z.infer<typeof normalizedEmailSchema>;

/**
 * A challenge is the random value embedded in a successful reservation and
 * round-tripped to the browser so the OTP callback can identify the right
 * reservation without exposing it via URL. The BFF only ever stores the
 * digest; the plaintext is held in a short-lived HttpOnly cookie or query
 * parameter.
 */
export const invitationChallengeSchema = z
  .string()
  .trim()
  .min(32, 'Challenge must be at least 32 characters')
  .max(128, 'Challenge must be at most 128 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Challenge may only contain safe URL characters');

export type InvitationChallenge = z.infer<typeof invitationChallengeSchema>;

// ----- Reserve request / response ------------------------------------------

/**
 * Payload for `POST /api/v1/auth/invitations/reserve`. The `idempotencyKey`
 * is required so retries do not exhaust a code or re-send OTP (AUTH-003).
 */
export const reserveInvitationSchema = z
  .object({
    code: invitationCodeInputSchema.shape.code,
    email: normalizedEmailSchema,
    idempotencyKey: z
      .string()
      .trim()
      .min(16, 'Idempotency key must be at least 16 characters')
      .max(128, 'Idempotency key must be at most 128 characters'),
  })
  .strict();

export type ReserveInvitationCommand = z.infer<typeof reserveInvitationSchema>;

export const reservationPublicViewSchema = z
  .object({
    challenge: invitationChallengeSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    rateLimited: z.boolean().default(false),
  })
  .strict();

export type ReservationPublicView = z.infer<typeof reservationPublicViewSchema>;

// ----- Finalize request ----------------------------------------------------

/**
 * Payload for `POST /api/v1/auth/invitations/finalize`. The BFF cross-checks
 * the `challenge` against the verified session and the pending reservation;
 * the user identifier never originates from the browser.
 */
export const finalizeInvitationSchema = z
  .object({
    challenge: invitationChallengeSchema,
  })
  .strict();

export type FinalizeInvitationCommand = z.infer<typeof finalizeInvitationSchema>;

/**
 * Result returned after a successful finalize transaction. The DTO is the
 * only sanctioned surface for the application profile boundary; it never
 * exposes the invitation digest, reservation idempotency key or supplier
 * identifiers.
 */
export const finalizeInvitationResultSchema = z
  .object({
    profileId: z.uuid(),
    initialCreditsGranted: z.number().int().nonnegative(),
    priceBookVersionId: z.uuid(),
    rateLimited: z.boolean().default(false),
  })
  .strict();

export type FinalizeInvitationResult = z.infer<typeof finalizeInvitationResultSchema>;

// ----- Stable error codes ---------------------------------------------------

/**
 * Stable business error codes for the auth BFF. These are surfaced to the
 * i18n layer in M4 and must NOT leak supplier, internal stack traces or
 * secrets (AGENTS.md §2).
 */
export const authErrorCodeSchema = z.enum([
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
  'insufficient_credits', // Reserved for future use; not raised in M1
  'internal_error',
]);

export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;

/**
 * Normalize a user-supplied email into the canonical form persisted in the
 * database. Pure function; safe to call from both server and browser code
 * paths, although only the server should rely on it as the source of truth.
 */
export const normalizeEmailAddress = (raw: string): NormalizedEmail => normalizedEmailSchema.parse(raw);