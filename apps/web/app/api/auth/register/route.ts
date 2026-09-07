import { registrationSchema } from '../../../../../../packages/domain/src/auth-contracts';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { ApiRouteError } from '../../../../server/api-error';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost, rateLimit } from '../../../../server/auth/http';
import { validatePassword } from '../../../../server/auth/password-policy';

export const POST = authPost(registrationSchema, async (input, request) => {
  if (!process.env.APPROVED_LEGAL_VERSION || input.legalVersion !== process.env.APPROVED_LEGAL_VERSION) {
    throw new ApiRouteError({ code: 'network', message: '注册暂未开放，请等待服务条款确认后再试。', retryable: false, status: 503 });
  }
  await rateLimit(request, 'signup', input.email);
  const password = await validatePassword(input.password, { fetcher: fetch, report: () => console.warn('[auth] hibp_unavailable') });
  if (!password.ok) throw new ApiRouteError({ code: 'bad_request', message: '密码不符合安全要求，请更换密码。', retryable: false, status: 400 });
  return new AuthService(await createSupabaseServerClient()).register(input);
});
