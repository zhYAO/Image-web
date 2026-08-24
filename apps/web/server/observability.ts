import * as Sentry from '@sentry/nextjs';

export function reportServerError(_error: unknown, input: {
  correlationId: string;
  operation: string;
}) {
  Sentry.withScope((scope) => {
    scope.setTag('correlation_id', input.correlationId);
    scope.setTag('operation', input.operation);
    scope.setLevel('error');
    Sentry.captureException(new Error('server_operation_failed'));
  });
}
