import { createServerClient, serializeCookieHeader } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { commerceHref, workspaceRoute } from '@/features/workspace/workspace-route';
import { assertMutationAdmission, beginWork } from '@/server/lifecycle/request-lifecycle';
import type { Database } from './database.generated';
import { readSupabasePublicEnv, type DataMode, type SupabasePublicEnvironment } from './env';

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

function sessionUnavailable(message = '身份验证服务暂时不可用，请稍后重试。', code = 'network') {
  const correlationId = crypto.randomUUID();
  return NextResponse.json({ code, correlationId, message, retryable: true }, {
    status: 503, headers: { 'cache-control': 'private, no-store', 'x-correlation-id': correlationId },
  });
}

function maintenanceUnavailable() {
  const response = sessionUnavailable('服务正在维护，请保留原请求编号，稍后重试。');
  response.headers.set('retry-after', '30');
  return response;
}

export async function updateSupabaseSession(request: NextRequest) {
  // These public protocol reads must survive identity outages without refreshing
  // cookies. Keep the exception exact and leave every other route/method intact.
  if ((request.nextUrl.pathname === '/api/meta' || request.nextUrl.pathname === '/api/public-config')
    && (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS')) {
    const response = NextResponse.next({ request });
    response.headers.set('cache-control', 'no-store');
    return response;
  }
  // Old bookmarks encode commerce intent on the former workspace root.
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('scene')
    && (request.method === 'GET' || request.method === 'HEAD')) {
    const route = workspaceRoute('/', request.nextUrl.search);
    if (route.kind !== 'commerce') return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(new URL(commerceHref(route.scene, route.platform, route.template), request.url));
  }
  // The public brand document has no private data or anonymous bootstrap.
  // Keep it available when identity refresh/configuration is unavailable;
  // every application route and protected API keeps the normal auth path.
  if (process.env.NEXT_PUBLIC_PHASE2_AUTH === 'true'
    && (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/home')
    && (request.method === 'GET' || request.method === 'HEAD')) {
    return NextResponse.next({ request });
  }
  // Stop new writes before refresh, rate limits or identity dependencies run.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    try { assertMutationAdmission(); } catch { return maintenanceUnavailable(); }
  }
  const dataMode = (process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock') as DataMode;
  let environment;
  try { environment = readSupabasePublicEnv(dataMode); } catch {
    return sessionUnavailable();
  }
  if (!environment) return NextResponse.next({ request });

  // Proxy executes before executeRoute. Its refresh can hang independently of
  // the route and must remain visible to the process-wide drain collector.
  const endAuth = beginWork('activeMutations');
  try { return await refreshSupabaseSession(request, environment); } finally { endAuth(); }
}

async function refreshSupabaseSession(request: NextRequest, environment: SupabasePublicEnvironment) {
  let response = NextResponse.next({ request });
  response.headers.set('cache-control', 'private, no-store');
  const cookieHeaders: string[] = [];
  const sessionHeaders = new Headers();
  function applySessionHeaders(target: NextResponse) {
    for (const cookie of cookieHeaders) target.headers.append('set-cookie', cookie);
    for (const [key, value] of sessionHeaders) target.headers.set(key, value);
    if (!target.headers.has('cache-control')) target.headers.set('cache-control', 'private, no-store');
    return target;
  }
  let supabase;
  try {
    supabase = createServerClient<Database>(environment.url, environment.publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookieHeaders.push(...cookiesToSet.map(({ name, options, value }) => serializeCookieHeader(name, value, options)));
          Object.entries(headers).forEach(([key, value]) => sessionHeaders.set(key, value));
          response = applySessionHeaders(NextResponse.next({ request }));
        },
      },
    });
  } catch { return applySessionHeaders(sessionUnavailable()); }

  let data;
  try {
    const result = await supabase.auth.getClaims();
    data = result.data;
    // Missing/invalid sessions still go through each route's live-session RPC.
    // A refresh transport/dependency failure is not evidence of signing out.
    if (result.error && (result.error.name === 'AuthRetryableFetchError' || result.error.status === 0 || (result.error.status ?? 0) >= 500)) throw result.error;
  } catch {
    return applySessionHeaders(sessionUnavailable());
  }
  if (data?.claims) return response;
  if (process.env.NEXT_PUBLIC_PHASE2_AUTH === 'true') return response;

  const bootstrapRequest = {
    accept: request.headers.get('accept'),
    method: request.method,
    pathname: request.nextUrl.pathname,
  };
  const captchaRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  if (hasAuthCookie(request) || !shouldBootstrapAnonymousUser(bootstrapRequest, { captchaRequired })) {
    return response;
  }

  try { assertMutationAdmission(); } catch { return applySessionHeaders(maintenanceUnavailable()); }
  try {
    const { error: anonymousError } = await supabase.auth.signInAnonymously();
    if (anonymousError) return applySessionHeaders(sessionUnavailable('匿名身份暂时不可用，请稍后重试。', 'unauthorized'));
  } catch {
    return applySessionHeaders(sessionUnavailable('匿名身份暂时不可用，请稍后重试。', 'unauthorized'));
  }

  return response;
}
