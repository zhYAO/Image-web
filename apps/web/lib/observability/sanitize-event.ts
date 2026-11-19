interface SanitizableEvent {
  breadcrumbs?: unknown; contexts?: unknown; extra?: unknown; request?: unknown;
  user?: Record<string, unknown>; tags?: Record<string, unknown>;
  exception?: { values?: { value?: string; [key: string]: unknown }[] };
  message?: string;
}

export function sanitizeEvent<T extends SanitizableEvent>(event: T): T {
  delete event.breadcrumbs;
  delete event.contexts;
  delete event.extra;
  delete event.request;
  // Use a fixed address to omit user identity and location.
  event.user = { ip_address: '0.0.0.0' };

  const tags = event.tags ?? {};
  event.tags = Object.fromEntries(
    ['correlation_id', 'job_id', 'operation', 'status']
      .filter((key) => typeof tags[key] === 'string')
      .map((key) => [key, tags[key]]),
  );

  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      exception.value = 'redacted_application_error';
    }
  }
  if (event.message) event.message = 'redacted_application_error';

  return event;
}
