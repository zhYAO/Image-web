import { apiErrorSchema, publicConfigSchema, type PublicConfig } from '@zimage/domain';

import { resolveSupabasePublicEnv } from '../../lib/supabase/env';

export function runtimeUnavailableResponse(): Response {
  const correlationId = crypto.randomUUID();
  return Response.json(apiErrorSchema.parse({
    code: 'service_not_ready',
    correlationId,
    message: '服务暂时不可用，请稍后重试。',
    retryable: true,
  }), {
    status: 503,
    headers: { 'cache-control': 'no-store', 'x-correlation-id': correlationId },
  });
}

/** Read the supplied runtime environment; never copy it into a wire response. */
export function readRuntimePublicConfig(environment: Record<string, string | undefined>): PublicConfig | null {
  // The static HTTP client must not silently connect to a mock or an invalid
  // HTTP environment. This checks configuration only, without creating a client.
  if (environment.NEXT_PUBLIC_DATA_MODE !== 'http') return null;
  const authFlag = environment.NEXT_PUBLIC_PHASE2_AUTH;
  if (authFlag !== undefined && authFlag !== 'true' && authFlag !== 'false') return null;
  try {
    resolveSupabasePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    }, 'http');
  } catch {
    return null;
  }

  const formalAuth = authFlag === 'true';
  // The existing CAPTCHA UI and server requirement both trim the site key.
  // A configured test key remains a test key; this endpoint proves no challenge.
  const captchaSiteKey = environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
  // Registration compares the accepted version against the raw server value.
  // Do not trim a nonblank version into one that the register route rejects.
  const legalVersion = environment.APPROVED_LEGAL_VERSION;
  const approvedLegalVersion = legalVersion?.trim() ? legalVersion : null;
  const parsed = publicConfigSchema.safeParse({
    schemaVersion: 1,
    formalAuth,
    dataMode: 'http',
    captchaSiteKey,
    approvedLegalVersion,
    registrationEnabled: formalAuth && captchaSiteKey !== null && approvedLegalVersion !== null,
  });
  return parsed.success ? parsed.data : null;
}

export function publicConfigResponse(): Response {
  // Keep these static references aligned with Proxy/Auth/Supabase: Next freezes
  // NEXT_PUBLIC_* in the backend build. Reading the whole runtime environment
  // could instead report stale startup flags after a release or rollback.
  // APPROVED_LEGAL_VERSION is server-only and deliberately stays request-time.
  const config = readRuntimePublicConfig({
    NEXT_PUBLIC_DATA_MODE: process.env.NEXT_PUBLIC_DATA_MODE,
    NEXT_PUBLIC_PHASE2_AUTH: process.env.NEXT_PUBLIC_PHASE2_AUTH,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    APPROVED_LEGAL_VERSION: process.env.APPROVED_LEGAL_VERSION,
  });
  return config
    ? Response.json(config, { headers: { 'cache-control': 'no-store' } })
    : runtimeUnavailableResponse();
}
