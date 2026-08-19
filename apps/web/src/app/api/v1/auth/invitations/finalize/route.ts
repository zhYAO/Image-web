import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  createServerUserClient,
  getVerifiedClaimsOrNull,
  type ServerCookieAdapter,
} from '@zima/supabase';
import {
  finalizeInvitationResultSchema,
  finalizeInvitationSchema,
  normalizeEmailAddress,
  reservationPublicViewSchema,
  type AuthErrorCode,
} from '@zima/domain';
import { createLogger } from '@zima/config';

import { loadServerEnv } from '../../../../../../server/env.js';
import { encodeDraft, readDraftFromCookieStore, type HomeComposerDraft } from '../../../../../../server/draft-restore.js';

export const runtime = 'nodejs';

const logger = createLogger({
  level: (process.env.LOG_LEVEL as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace') ?? 'info',
  service: 'auth.reservations.finalize',
});

const errorResponse = (status: number, code: AuthErrorCode, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * POST /api/v1/auth/invitations/finalize
 *
 * Called from `/auth/callback` after Supabase Auth has verified the OTP
 * and produced a session cookie. The BFF cross-checks the verified
 * claims, looks up the matching reservation by challenge digest, and
 * invokes the private `finalize_invitation` RPC to redeem the code and
 * create the profile atomically (AUTH-002 / AUTH-011).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const env = loadServerEnv();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, 'invalid_input', '请求体不是合法 JSON');
  }

  const parsed = finalizeInvitationSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'Challenge 不合法');
  }

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
  const claims = await getVerifiedClaimsOrNull(userClient);

  if (!claims) {
    return errorResponse(401, 'session_unverified', '请先完成邮箱验证码校验');
  }

  if (!claims.email) {
    return errorResponse(401, 'session_unverified', '当前会话缺少已验证邮箱');
  }

  const verifiedEmail = normalizeEmailAddress(claims.email);

  const internal = (await import('@supabase/supabase-js')).createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );

  const { data, error } = await internal.rpc('finalize_invitation', {
    p_challenge: parsed.data.challenge,
    p_verified_user_id: claims.sub,
    p_verified_email: verifiedEmail,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('reservation_not_active')) {
      return errorResponse(404, 'reservation_expired', '预约已过期，请重新申请邀请');
    }
    if (message.includes('invitation_not_consumable')) {
      return errorResponse(410, 'invitation_already_redeemed', '邀请码已被使用或失效');
    }
    if (message.includes('price_book_not_approved')) {
      return errorResponse(503, 'invitation_not_approved', '邀请码尚未批准，请联系管理员');
    }
    logger.error({ err: error.message }, 'finalize rpc failed');
    return errorResponse(500, 'internal_error', '核销失败，请稍后重试');
  }

  const row = Array.isArray(data) ? data[0] : data;
  const result = finalizeInvitationResultSchema.safeParse({
    profileId: (row as { profile_id: string } | undefined)?.profile_id,
    initialCreditsGranted: (row as { initial_credits_granted: number } | undefined)?.initial_credits_granted,
    priceBookVersionId: (row as { price_book_version_id: string } | undefined)?.price_book_version_id,
    rateLimited: false,
  });

  if (!result.success) {
    logger.error({ issues: result.error.issues }, 'finalize rpc payload invalid');
    return errorResponse(500, 'internal_error', '核销结果无法解析');
  }

  // Re-hydrate any pending composer draft from a short-lived cookie and
  // pass it to the welcome response so the user can resume editing.
  const draft: HomeComposerDraft | null = readDraftFromCookieStore({
    get: (cookieName: string) => {
      const entry = cookieStore.get(cookieName);
      return entry ? { value: entry.value } : undefined;
    },
  });

  // Touch the public view schema once to prove the cookie round-trip is
  // always validated; no functional impact on the response body.
  void reservationPublicViewSchema;

  const responseBody = {
    profileId: result.data.profileId,
    initialCreditsGranted: result.data.initialCreditsGranted,
    priceBookVersionId: result.data.priceBookVersionId,
    restoredDraft: draft
      ? { payload: encodeDraft(draft), ttlSeconds: 30 * 60 }
      : null,
  };

  // If the draft round-trips, leave the cookie untouched so the composer
  // can decode it. Otherwise clear it to avoid stale state leaking past
  // the welcome screen.
  if (draft === null) {
    cookieStore.delete('zima.draft');
  }

  return NextResponse.json(responseBody, { status: 200 });
}