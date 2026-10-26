import { apiErrorSchema } from '@zimage/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiRouteError } from './api-error';
import { reportServerError } from './observability';

export async function requireVerifiedUserId(client: SupabaseClient) {
  const { data, error, status } = await client.rpc('require_verified_user_id');
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
  const correlationId = crypto.randomUUID();
  try {
    const response = await handler(correlationId);
    response.headers.set('x-correlation-id', correlationId);
    return response;
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
    return NextResponse.json(body, {
      headers: { 'x-correlation-id': correlationId },
      status: routeError.status,
    });
  }
}
