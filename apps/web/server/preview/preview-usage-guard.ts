import { ApiRouteError } from '@/server/api-error';
import { reportServerError } from '@/server/observability';

export type PreviewOperation =
  | 'chat'
  | 'generation'
  | 'generation_recreate'
  | 'session_create'
  | 'session_delete'
  | 'session_update'
  | 'upload';

interface RpcError {
  code?: string;
  message?: string;
}

export interface PreviewUsageRpcClient {
  rpc(
    name: string,
    input?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export interface PreviewUsageInput {
  bytes?: number;
  businessKey: string;
  correlationId: string;
  createsSession: boolean;
  operation: PreviewOperation;
  userId: string;
}

function usageFailure(error: RpcError | null) {
  const diagnostic = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (diagnostic.includes('preview_quota_exceeded')) {
    return new ApiRouteError({
      code: 'quota_exceeded',
      message: '公开预览额度已用完，请在 UTC 窗口重置后重试。',
      retryable: false,
      status: 429,
    });
  }
  if (diagnostic.includes('feature_disabled:')) {
    return new ApiRouteError({
      code: 'provider_error',
      message: '该能力当前已由服务端关闭，请稍后重试。',
      retryable: true,
      status: 503,
    });
  }
  return new ApiRouteError({
    code: 'network',
    message: '暂时无法核验公开预览额度，请稍后重试。',
    retryable: true,
    status: 503,
  });
}

export function createPreviewUsageGuard(client: PreviewUsageRpcClient) {
  return {
    async commit(userId: string, businessKey: string) {
      const { data, error } = await client.rpc('commit_preview_usage', {
        p_business_key: businessKey,
        p_user_id: userId,
      });
      if (error || data !== true) throw usageFailure(error);
    },

    async release(userId: string, businessKey: string, correlationId: string) {
      const { data, error } = await client.rpc('release_preview_usage', {
        p_business_key: businessKey,
        p_correlation_id: correlationId,
        p_user_id: userId,
      });
      if (error || data !== true) throw usageFailure(error);
    },

    async reserve(input: PreviewUsageInput) {
      const { data, error } = await client.rpc('reserve_preview_usage', {
        p_business_key: input.businessKey,
        p_bytes: input.bytes ?? 0,
        p_correlation_id: input.correlationId,
        p_creates_session: input.createsSession,
        p_operation: input.operation,
        p_user_id: input.userId,
      });
      if (error || data !== true) throw usageFailure(error);
    },
  };
}

export type PreviewUsageGuard = ReturnType<typeof createPreviewUsageGuard>;

export class PreviewUsageRetentionError extends Error {
  constructor(readonly originalError: unknown) {
    super('preview_usage_must_remain_reserved');
    this.name = 'PreviewUsageRetentionError';
  }
}

export async function withPreviewUsageReservation<T>(
  guard: PreviewUsageGuard,
  input: PreviewUsageInput,
  mutation: () => Promise<T>,
) {
  await guard.reserve(input);
  let result: T;
  try {
    result = await mutation();
  } catch (error: unknown) {
    if (error instanceof PreviewUsageRetentionError) throw error.originalError;
    try {
      await guard.release(input.userId, input.businessKey, input.correlationId);
    } catch {
      // The original mutation error is the actionable failure. A stale reservation
      // remains fail-safe and is removed by the bounded-retention cleanup.
    }
    throw error;
  }
  try {
    await guard.commit(input.userId, input.businessKey);
  } catch (error: unknown) {
    reportServerError(error, {
      correlationId: input.correlationId,
      operation: `preview_usage_commit_${input.operation}`,
    });
  }
  return result;
}
