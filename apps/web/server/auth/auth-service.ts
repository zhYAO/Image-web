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

  async register(input: { email: string; password: string; legalVersion: string }) {
    const result = await this.client.auth.signUp?.({
      email: input.email,
      password: input.password,
      options: { data: { accepted_legal_version: input.legalVersion } },
    });
    if (result?.error && result.error.code !== 'user_already_exists') throwMailError(result.error);
    return { accepted: true as const };
  }

  async signIn(input: { email: string; password: string }) {
    const result = await this.client.auth.signInWithPassword?.(input);
    if (result?.error || !result?.data?.user) throw new PublicAuthError('invalid_credentials');
    return result.data.user;
  }

  async verifyEmailOtp(input: { email: string; token: string; returnTo?: string }) {
    const result = await this.client.auth.verifyOtp?.({ email: input.email, token: input.token, type: 'signup' });
    if (result?.error || !result?.data?.user) throw new PublicAuthError('auth_failed');
    return { returnTo: normalizeReturnTo(input.returnTo), userId: result.data.user.id };
  }

  async resendSignup(email: string) {
    const result = await this.client.auth.resend({ email, type: 'signup' });
    if (result.error) throwMailError(result.error);
    return { accepted: true as const };
  }
  async requestPasswordReset(email: string, redirectTo: string) {
    const result = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
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
  const limited = error.status === 429 || error.code === 'over_email_send_rate_limit';
  throw new ApiRouteError({
    code: 'network',
    message: limited ? '邮件发送过于频繁，请稍后再试。' : '邮件暂时无法发送，请稍后重试或联系管理员。',
    retryable: true,
    status: limited ? 429 : 503,
  });
}

export type AuthenticatedAccount = Account;
