import { AsyncLocalStorage } from 'node:async_hooks';
import { apiErrorSchema } from '@zimage/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiRouteError } from './api-error';
import { reportServerError } from './observability';
import { assertMutationAdmission, MaintenanceError, runTrackedRoute } from './lifecycle/request-lifecycle';

interface AuthResponseContext {
  cookies: string[];
  values: Map<string, string>;
  headers: Headers;
}

// Never share clients or token state between requests. Route handlers collect
// response effects here before SSE/ZIP bodies can start streaming.
const authResponseContext = new AsyncLocalStorage<AuthResponseContext>();

export function readAuthCookieUpdates() {
  return authResponseContext.getStore()?.values;
}

export function recordAuthResponseHeaders(
  cookies: { name: string; value: string; header: string }[],
  headers: Record<string, string>,
) {
  const context = authResponseContext.getStore();
  if (!context) return false;
  for (const cookie of cookies) {
    context.cookies.push(cookie.header);
    context.values.set(cookie.name, cookie.value);
  }
  for (const [key, value] of Object.entries(headers)) context.headers.set(key, value);
  return true;
}

function finalizeResponse(response: Response, context: AuthResponseContext, correlationId: string) {
  // Preserve streaming directives such as no-transform alongside SDK headers.
  const cacheControl = [response.headers.get('cache-control'), context.headers.get('cache-control')]
    .filter(Boolean).flatMap(value => value!.split(',').map(directive => directive.trim()))
    .filter(directive => directive && !/^(?:public|private|no-store)$/i.test(directive)
      && (!/^(?:s-maxage|max-age)\s*=/i.test(directive) || /^(?:s-maxage|max-age)\s*=\s*0$/i.test(directive)));
  for (const [key, value] of context.headers) response.headers.set(key, value);
  // Raw append keeps host-only and domain-scoped deletions of the same name.
  for (const cookie of context.cookies) response.headers.append('set-cookie', cookie);
  response.headers.set('cache-control', [...new Set(['private', 'no-store', ...cacheControl])].join(', '));
  response.headers.set('x-correlation-id', correlationId);
  return response;
}

export async function requireVerifiedUserId(client: SupabaseClient) {
  let result;
  try { result = await client.rpc('require_verified_user_id'); } catch {
    throw new ApiRouteError({ code: 'network', message: '身份验证服务暂时不可用，请稍后重试。', retryable: true, status: 503 });
  }
  const { data, error, status } = result;
  const parsed = z.uuid().safeParse(data);
  if (error || !parsed.success) {
    // The RPC explicitly raises P0001/unauthorized for revoked identities.
    // PostgREST uses 401 for missing/invalid JWTs and anonymous EXECUTE denial;
    // authenticated permission errors are 403. Transport, schema and database
    // failures must remain unavailable, never evidence that a user signed out.
    const unauthenticated = (error?.code === 'P0001' && error.message === 'unauthorized')
      || (status === 401 && ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code ?? ''));
    throw new ApiRouteError({
      code: unauthenticated ? 'unauthorized' : 'network',
      message: unauthenticated ? '登录状态无效或已过期，请重新登录。' : '身份验证服务暂时不可用，请稍后重试。',
      retryable: true,
      status: unauthenticated ? 401 : 503,
    });
  }
  return parsed.data;
}

export function assertTrustedOrigin(request: Request) {
  assertMutationAdmission();
  const origin = request.headers.get('origin');
  const expectedOrigin = new URL(request.url).origin;
  const configured = (process.env.ZIMAGE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || (origin !== expectedOrigin && !configured.includes(origin))) {
    throw new ApiRouteError({
      code: 'unauthorized',
      message: '请求来源无效，请刷新页面后重试。',
      retryable: false,
      status: 403,
    });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiRouteError({
      code: 'bad_request',
      message: '请求体必须是有效 JSON。',
      retryable: false,
      status: 400,
    });
  }
}

export async function executeRoute(handler: (correlationId: string) => Promise<Response>) {
  return runTrackedRoute(() => authResponseContext.run({ cookies: [], values: new Map(), headers: new Headers() }, async () => {
    const context = authResponseContext.getStore()!;
    const correlationId = crypto.randomUUID();
    try {
      const response = await handler(correlationId);
      return finalizeResponse(response, context, correlationId);
    } catch (error: unknown) {
      const routeError = error instanceof ApiRouteError
        ? error
        : error instanceof z.ZodError
          ? new ApiRouteError({
            code: 'bad_request',
            message: '请求参数不符合接口契约。',
            retryable: false,
            status: 400,
          })
          : new ApiRouteError({
            code: 'network',
            message: '服务暂时不可用，请稍后重试。',
            retryable: true,
            status: 500,
          });
      if (routeError.status >= 500) {
        reportServerError(error, { correlationId, operation: 'route_handler' });
      }
      const body = apiErrorSchema.parse({
        code: routeError.code,
        correlationId,
        details: routeError.details,
        message: routeError.message,
        retryable: routeError.retryable,
      });
      return finalizeResponse(NextResponse.json(body, {
        headers: error instanceof MaintenanceError ? { 'retry-after': '30' } : undefined,
        status: routeError.status,
      }), context, correlationId);
    }
  }));
}
