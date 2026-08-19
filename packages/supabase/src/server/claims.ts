import type { SupabaseClient, User } from '@supabase/supabase-js';

import type { Database } from '../database.types.js';

/**
 * The minimum fields the BFF must read from the verified Supabase session
 * before exposing user-scoped data to a route handler or RSC.
 *
 * `getVerifiedClaimsOrNull` is the canonical entry point: it returns the
 * fully-verified claims or `null` for anonymous browsers. Anonymous users
 * are still allowed to read public projections; route handlers that require
 * an authenticated user should call `requireVerifiedClaims` which throws
 * `UnauthorizedError` so the BFF can return a stable 401.
 *
 * Per AGENTS.md §3.3 we deliberately do NOT trust `getSession()` alone —
 * every call goes through `auth.getUser()` so the SDK revalidates the JWT
 * signature and expiry against the configured Supabase Auth server.
 */
export interface VerifiedClaims {
  /** Stable Supabase auth user id. */
  sub: string;
  /** Verified email (when the IdP issued one). */
  email: string | null;
  /** Token issued-at timestamp (seconds since epoch). */
  issuedAt: number;
  /** Token expiry timestamp (seconds since epoch). */
  expiresAt: number;
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unverified session') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

const toVerifiedClaims = (user: User): VerifiedClaims => ({
  sub: user.id,
  email: user.email ?? null,
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

/**
 * Read the verified claims from the current Supabase session. Returns
 * `null` for anonymous browsers instead of throwing so callers can
 * gracefully render a public RSC branch.
 */
export const getVerifiedClaimsOrNull = async (
  client: SupabaseClient<Database>,
): Promise<VerifiedClaims | null> => {
  const { data, error } = await client.auth.getUser();

  if (error) {
    return null;
  }

  if (!data.user) {
    return null;
  }

  return toVerifiedClaims(data.user);
};

/**
 * Same as {@link getVerifiedClaimsOrNull} but throws when the browser has
 * no verified session. Use this in Route Handlers that must reject
 * anonymous traffic before continuing.
 */
export const requireVerifiedClaims = async (
  client: SupabaseClient<Database>,
): Promise<VerifiedClaims> => {
  const claims = await getVerifiedClaimsOrNull(client);
  if (!claims) {
    throw new UnauthorizedError();
  }

  return claims;
};