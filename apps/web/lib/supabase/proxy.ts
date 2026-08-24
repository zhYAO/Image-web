import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import type { Database } from './database.generated';
import { readSupabasePublicEnv, type DataMode } from './env';

interface AnonymousBootstrapRequest {
  accept: string | null;
  method: string;
  pathname: string;
}

export function shouldBootstrapAnonymousUser(
  request: AnonymousBootstrapRequest,
  options: { captchaRequired?: boolean } = {},
) {
  return options.captchaRequired !== true
    && request.method === 'GET'
    && request.accept?.includes('text/html') === true
    && !request.pathname.startsWith('/api/');
}

function hasAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
}

export async function updateSupabaseSession(request: NextRequest) {
  const dataMode = (process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock') as DataMode;
  const environment = readSupabasePublicEnv(dataMode);
  if (!environment) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (data?.claims) return response;

  const bootstrapRequest = {
    accept: request.headers.get('accept'),
    method: request.method,
    pathname: request.nextUrl.pathname,
  };
  const captchaRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  if (hasAuthCookie(request) || !shouldBootstrapAnonymousUser(bootstrapRequest, { captchaRequired })) {
    return response;
  }

  const { error: anonymousError } = await supabase.auth.signInAnonymously();
  if (anonymousError) {
    return NextResponse.json(
      { code: 'unauthorized', message: '匿名身份暂时不可用，请稍后重试。', retryable: true },
      { status: 503 },
    );
  }

  return response;
}
