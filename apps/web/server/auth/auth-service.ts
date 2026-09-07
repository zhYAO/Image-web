import type { Account } from '../../../../packages/domain/src/auth-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiRouteError } from '../api-error';

import { normalizeReturnTo } from './redirects';

type AuthClient = { auth: SupabaseClient['auth'] };

export class PublicAuthError extends ApiRouteError {
  constructor(readonly reason: 'invalid_credentials' | 'auth_failed') {
    super({ code: 'unauthorized', message: reason === 'invalid_credentials' ? '邮箱或密码不正确，请重试。' : '认证请求失败，请稍后重试。', retryable: false, status: 401 });
  }
}

export class AuthService {
  constructor(private readonly client: AuthClient) {}

  async register(input: { email: string; password: string; legalVersion: string; captchaToken?: string }) {
    const result = await this.client.auth.signUp?.({
      email: input.email,
      password: input.password,
      options: { data: { accepted_legal_version: input.legalVersion }, captchaToken: input.captchaToken },
    });
    if (result?.error && result.error.code !== 'user_already_exists') throwMailError(result.error);
    return { accepted: true as const };
  }

  async signIn(input: { email: string; password: string; captchaToken?: string }) {
    const result = await this.client.auth.signInWithPassword?.({ email: input.email, password: input.password, options: { captchaToken: input.captchaToken } });
    if (result?.error?.code === 'captcha_failed') throwCaptchaError();
    if (result?.error || !result?.data?.user) throw new PublicAuthError('invalid_credentials');
    return result.data.user;
  }

  async verifyEmailOtp(input: { email: string; token: string; returnTo?: string }) {
    const result = await this.client.auth.verifyOtp?.({ email: input.email, token: input.token, type: 'signup' });
    if (result?.error || !result?.data?.user) throw new PublicAuthError('auth_failed');
    return { returnTo: normalizeReturnTo(input.returnTo), userId: result.data.user.id };
  }

  async resendSignup(email: string, captchaToken?: string) {
    const result = await this.client.auth.resend({ email, type: 'signup', options: { captchaToken } });
    if (result.error) throwMailError(result.error);
    return { accepted: true as const };
  }
  async requestPasswordReset(email: string, redirectTo: string, captchaToken?: string) {
    const result = await this.client.auth.resetPasswordForEmail(email, { redirectTo, captchaToken });
    if (result.error) throwMailError(result.error);
    return { accepted: true as const };
  }
  async updatePassword(password: string) {
    const result = await this.client.auth.updateUser({ password });
    if (result.error) throw new PublicAuthError('auth_failed');
    return result;
  }
  async signOut(scope: 'global' | 'local' | 'others' = 'local') {
    const result = await this.client.auth.signOut({ scope });
    if (result.error) throw new PublicAuthError('auth_failed');
    return result;
  }
}

function throwMailError(error: { code?: string; status?: number }): never {
  if (error.code === 'captcha_failed') throwCaptchaError();
  const limited = error.status === 429 || error.code === 'over_email_send_rate_limit';
  throw new ApiRouteError({
    code: 'network',
    message: limited ? '邮件发送过于频繁，请稍后再试。' : '邮件暂时无法发送，请稍后重试或联系管理员。',
    retryable: true,
    status: limited ? 429 : 503,
  });
}

export function throwCaptchaError(): never {
  throw new ApiRouteError({ code: 'bad_request', message: '安全验证未完成或已过期，请重新验证后再试。', retryable: true, status: 400 });
}

export type AuthenticatedAccount = Account;
