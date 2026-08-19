import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  createServerUserClient,
  getVerifiedClaimsOrNull,
  type ServerCookieAdapter,
} from '@zima/supabase';
import { createLogger } from '@zima/config';

import { loadServerEnv } from '../../../server/env.js';

export const runtime = 'nodejs';

const logger = createLogger({
  level: (process.env.LOG_LEVEL as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace') ?? 'info',
  service: 'auth.reservations.callback',
});

/**
 * /auth/callback
 *
 * Receives the Supabase Auth verification token from the OTP email,
 * exchanges it for a session cookie, then invokes the private
 * `finalize_invitation` RPC to redeem the reservation in a single
 * Postgres transaction. The challenge is supplied by the reservation
 * step and round-trips in the `state` query parameter; the BFF trusts
 * only the verified claims, never the URL.
 */
export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; challenge?: string }>;
}) {
  const t = await getTranslations('auth.errors');
  const params = await searchParams;
  const tokenHash = params.token_hash?.trim();
  const type = params.type?.trim();
  const challenge = params.challenge?.trim();

  if (!tokenHash || !type || !challenge) {
    redirect('/auth?error=missing_callback');
  }

  const env = loadServerEnv();
  const cookieStore = await cookies();
  const adapter: ServerCookieAdapter = {
    getAll: () =>
      cookieStore
        .getAll()
        .map((cookie) => ({ name: cookie.name, value: cookie.value })),
    setAll: (entries) => {
      for (const entry of entries) {
        cookieStore.set({
          name: entry.name,
          value: entry.value,
          ...(entry.options ?? {}),
        });
      }
    },
  };

  const userClient = createServerUserClient(env, adapter);
  const { error: verifyError } = await userClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'email' | 'magiclink' | 'signup' | 'recovery',
  });

  if (verifyError) {
    logger.warn({ err: verifyError.message }, 'verifyOtp failed');
    redirect(`/auth?error=${encodeURIComponent(verifyError.message)}`);
  }

  const claims = await getVerifiedClaimsOrNull(userClient);
  if (!claims || !claims.email) {
    redirect(`/auth?error=${encodeURIComponent(t('session_unverified'))}`);
  }

  const internal = (await import('@supabase/supabase-js')).createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );

  const { error: rpcError } = await internal.rpc('finalize_invitation', {
    p_challenge: challenge,
    p_verified_user_id: claims!.sub,
    p_verified_email: claims!.email!,
  });

  if (rpcError) {
    logger.warn({ err: rpcError.message }, 'finalize_invitation failed');
    redirect(`/auth?error=${encodeURIComponent(rpcError.message)}`);
  }

  redirect('/?welcome=1');
}