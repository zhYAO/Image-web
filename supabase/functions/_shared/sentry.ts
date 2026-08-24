import * as Sentry from '@sentry/deno';

interface WorkerErrorContext {
  correlationId?: string;
  jobId?: string;
  operation: string;
  status?: string;
}

const dsn = Deno.env.get('SENTRY_DSN')?.trim();

Sentry.init({
  beforeSend(event) {
    delete event.breadcrumbs;
    delete event.contexts;
    delete event.extra;
    delete event.request;
    delete event.user;
    const tags = event.tags ?? {};
    event.tags = Object.fromEntries(
      ['correlation_id', 'job_id', 'operation', 'status']
        .filter((key) => typeof tags[key] === 'string')
        .map((key) => [key, tags[key]]),
    );
    if (event.exception?.values) {
      for (const exception of event.exception.values) {
        exception.value = 'redacted_worker_error';
      }
    }
    if (event.message) event.message = 'redacted_worker_error';
    return event;
  },
  dsn,
  enabled: Boolean(dsn),
  environment: Deno.env.get('SENTRY_ENVIRONMENT')?.trim() || 'supabase-edge',
  sendDefaultPii: false,
  tracesSampleRate: Number(Deno.env.get('SENTRY_TRACES_SAMPLE_RATE') ?? '0'),
});

export async function captureWorkerException(_error: unknown, context: WorkerErrorContext) {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setTag('operation', context.operation);
    if (context.correlationId) scope.setTag('correlation_id', context.correlationId);
    if (context.jobId) scope.setTag('job_id', context.jobId);
    if (context.status) scope.setTag('status', context.status);
    Sentry.captureException(new Error('worker_operation_failed'));
  });
  await Sentry.flush(2_000);
}
