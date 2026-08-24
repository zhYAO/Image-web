import * as Sentry from '@sentry/nextjs';

export function reportServerError(error: unknown, input: {
  correlationId: string;
  operation: string;
}) {
  Sentry.withScope((scope) => {
    scope.setTag('correlation_id', input.correlationId);
    scope.setTag('operation', input.operation);
    scope.setLevel('error');
    Sentry.captureException(error instanceof Error ? error : new Error('unknown_server_error'));
  });
}
