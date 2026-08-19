import { randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';

import { computeInvitationDigest, createRateLimiter } from '@zima/supabase';
import {
  normalizeEmailAddress,
  reservationPublicViewSchema,
  reserveInvitationSchema,
  type AuthErrorCode,
} from '@zima/domain';
import { createLogger } from '@zima/config';

import { loadServerEnv } from '../../../../../../server/env';

export const runtime = 'nodejs';

const logger = createLogger({
  level: (process.env.LOG_LEVEL as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace') ?? 'info',
  service: 'auth.reservations.reserve',
});
const rateLimiter = createRateLimiter();
const CHALLENGE_BYTES = 32;

const errorResponse = (status: number, code: AuthErrorCode, message: string, retryAfterSeconds?: number) => {
  const body: { code: AuthErrorCode; message: string; retryAfterSeconds?: number } = { code, message };
  if (retryAfterSeconds !== undefined) {
    body.retryAfterSeconds = retryAfterSeconds;
  }
  return NextResponse.json({ error: body }, { status });
};

/**
 * POST /api/v1/auth/invitations/reserve
 *
 * Validates an invitation code + email and reserves it for the next 10
 * minutes (AUTH-009 / AUTH-010). On success the Supabase OTP is sent
 * via the internal admin client and a `challenge` is returned so the
 * browser can identify the matching reservation when the OTP lands.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const env = loadServerEnv();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, 'invalid_input', '请求体不是合法 JSON');
  }

  const parsed = reserveInvitationSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', '邀请码、邮箱或幂等键不合法');
  }

  const normalizedEmail = normalizeEmailAddress(parsed.data.email);
  const invitationDigest = computeInvitationDigest(parsed.data.code);
  const ipHeader = request.headers.get('x-forwarded-for') ?? 'unknown';
  const clientIp = ipHeader.split(',')[0]?.trim() ?? 'unknown';

  const decision = rateLimiter.consume({
    email: normalizedEmail,
    invitationDigest,
    ip: clientIp,
  });

  if (!decision.allowed) {
    return errorResponse(
      429,
      'rate_limited',
      `请求过于频繁（${decision.reason ?? 'unknown'}），请稍后重试`,
      decision.retryAfterSeconds,
    );
  }

  const challenge = randomBytes(CHALLENGE_BYTES).toString('base64url');

  const internal = (await import('@supabase/supabase-js')).createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );

  const { error: rpcError } = await internal.rpc('create_invitation_reservation', {
    p_invitation_digest: invitationDigest,
    p_normalized_email: normalizedEmail,
    p_challenge: challenge,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_ip_digest: clientIp,
  });

  if (rpcError) {
    const message = rpcError.message ?? '';
    if (message.includes('invitation_not_active')) {
      return errorResponse(404, 'invitation_not_found', '邀请码不可用或已过期');
    }
    logger.error({ err: rpcError.message }, 'reservation rpc failed');
    return errorResponse(500, 'internal_error', '预约失败，请稍后重试');
  }

  const { error: otpError } = await internal.auth.signInWithOtp({
    email: normalizedEmail,
    options: { shouldCreateUser: true },
  });

  if (otpError) {
    logger.error({ err: otpError.message }, 'signInWithOtp failed');
    return errorResponse(500, 'internal_error', '发送验证码失败，请稍后重试');
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const view = reservationPublicViewSchema.parse({
    challenge,
    expiresAt,
  });

  return NextResponse.json(view, { status: 200 });
}