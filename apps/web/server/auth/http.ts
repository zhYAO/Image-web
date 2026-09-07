import { createHash } from 'node:crypto';
import { z } from 'zod';

import { createSupabaseAdminClient } from '../../lib/supabase/admin';
import { ApiRouteError } from '../api-error';
import { assertTrustedOrigin, executeRoute, readJson } from '../route-context';
import { throwCaptchaError } from './auth-service';

export function requireCaptcha(captchaToken?: string) {
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && !captchaToken?.trim()) throwCaptchaError();
}

export function authPost<T>(schema: z.ZodType<T>, handler: (input: T, request: Request) => Promise<unknown>) {
  return (request: Request) => executeRoute(async () => {
    assertTrustedOrigin(request);
    const input = schema.parse(await readJson(request));
    return Response.json(await handler(input, request));
  });
}

export async function rateLimit(request: Request, action: 'login' | 'signup' | 'resend' | 'recovery' | 'verify', email: string) {
  const trustedProxy = process.env.ZIMAGE_TRUST_PROXY === 'true';
  const localDevelopment = process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const ip = localDevelopment ? '127.0.0.1' : trustedProxy ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : request.headers.get('x-real-ip');
  if (!ip) throw new ApiRouteError({ code: 'unauthorized', message: '认证服务暂不可用，请联系管理员。', retryable: true, status: 503 });
  if (process.env.NODE_ENV === 'production' && !process.env.AUTH_RATE_LIMIT_PEPPER?.trim()) throw new ApiRouteError({ code: 'network', message: '认证服务暂不可用，请联系管理员。', retryable: true, status: 503 });
  const digest = (value: string) => createHash('sha256').update(`${process.env.AUTH_RATE_LIMIT_PEPPER ?? 'local-only'}:${value}`).digest('hex');
  const client = createSupabaseAdminClient();
  const limits = action === 'login' ? [5, 900] : action === 'resend' ? [1, 60] : [5, 3600];
  const { data, error } = await client.rpc('consume_auth_rate_limit' as never, {
    p_action: action, p_block_seconds: action === 'login' ? 900 : 0, p_email_hash: digest(email.toLocaleLowerCase('en-US')),
    p_ip_hash: digest(ip), p_limit: limits[0], p_window_seconds: limits[1],
  } as never);
  const result = data as unknown as { allowed?: boolean; retryAfterSeconds?: number } | null;
  if (error || typeof result?.allowed !== 'boolean') throw new ApiRouteError({ code: 'network', message: '认证服务暂不可用，请联系管理员。', retryable: true, status: 503 });
  if (!result.allowed) throw new ApiRouteError({
    code: 'unauthorized',
    message: '请求过于频繁，请稍后重试。', retryable: true, status: 429,
  });
}
