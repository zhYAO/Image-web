import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => {
  const scope = {
    setLevel: vi.fn(),
    setTag: vi.fn(),
  };
  return {
    captureException: vi.fn((error: unknown) => {
      void error;
      return '0123456789abcdef0123456789abcdef';
    }),
    scope,
    withScope: vi.fn((callback: (value: typeof scope) => unknown) => callback(scope)),
  };
});

vi.mock('@sentry/nextjs', () => ({
  captureException: sentry.captureException,
  withScope: sentry.withScope,
}));

import { reportServerError } from '@/server/observability';

describe('server observability boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the event id while replacing the original error and retaining only safe correlation tags', () => {
    const eventId = reportServerError(new Error('token=private prompt=secret'), {
      correlationId: 'safe-correlation-id',
      operation: 'sentry_acceptance',
    });

    expect(eventId).toBe('0123456789abcdef0123456789abcdef');
    expect(sentry.scope.setLevel).toHaveBeenCalledWith('error');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('correlation_id', 'safe-correlation-id');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('operation', 'sentry_acceptance');
    expect(sentry.captureException).toHaveBeenCalledOnce();
    expect(sentry.captureException.mock.calls[0]?.[0]).toEqual(new Error('server_operation_failed'));
  });
});
