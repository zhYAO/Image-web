import type { Event } from '@sentry/nextjs';

export function sanitizeSentryEvent<T extends Event>(event: T): T {
  delete event.breadcrumbs;
  delete event.contexts;
  delete event.extra;
  delete event.request;
  // Relay infers the transport IP when user is absent. An unspecified address
  // prevents that inference without carrying a real user identity or location.
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
