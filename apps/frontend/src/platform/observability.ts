export type BrowserObservabilityOptions = { dsn: string; release: string; environment: string; tracesSampleRate: number };
let track: (pathname: string) => void = () => {};
let started = false;

export function routeLabel(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '/other';
  if (path.startsWith('/sessions/')) return '/sessions/:sessionId';
  if (path.startsWith('/create/')) return '/create/:scene';
  return ['/', '/home', '/workspace', '/create', '/assets', '/account', '/login', '/auth', '/auth/verify', '/auth/reset', '/terms', '/privacy'].includes(path) ? path : '/other';
}

/** Same privacy boundary as the existing app, extended to browser transactions. */
export function sanitizeBrowserEvent<T extends object>(event: T): T {
  const data = event as Record<string, unknown>;
  delete data.breadcrumbs; delete data.extra; delete data.request;
  data.user = { ip_address: '0.0.0.0' };
  const originalContexts = data.contexts as { trace?: Record<string, unknown> } | undefined;
  const trace = originalContexts?.trace;
  delete data.contexts;
  if (typeof data.transaction === 'string') {
    data.transaction = routeLabel(data.transaction);
    data.spans = [];
    if (trace) data.contexts = { trace: Object.fromEntries(['trace_id', 'span_id', 'parent_span_id', 'op', 'status'].filter(key => typeof trace[key] === 'string').map(key => [key, trace[key]])) };
  }
  const tags = data.tags as Record<string, unknown> | undefined;
  data.tags = Object.fromEntries(['correlation_id', 'job_id', 'operation', 'status'].filter(key => typeof tags?.[key] === 'string').map(key => [key, tags?.[key]]));
  const exception = data.exception as { values?: { value?: string }[] } | undefined;
  exception?.values?.forEach(value => { value.value = 'redacted_application_error'; });
  if (data.message) data.message = 'redacted_application_error';
  return event;
}

/** Deferred, opt-in browser SDK; no DSN means no SDK initialization or telemetry. */
export async function initializeObservability(options: BrowserObservabilityOptions | null) {
  if (!options || started) return;
  started = true;
  const sdk = await import('@sentry/browser');
  const client = sdk.init({
    dsn: options.dsn, release: options.release, environment: options.environment,
    sendDefaultPii: false, defaultIntegrations: false,
    integrations: [sdk.browserTracingIntegration({ instrumentPageLoad: false, instrumentNavigation: false, traceFetch: false, traceXHR: false })],
    tracesSampleRate: options.tracesSampleRate,
    beforeSend: sanitizeBrowserEvent, beforeSendTransaction: sanitizeBrowserEvent,
  });
  if (!client) return;
  sdk.startBrowserTracingPageLoadSpan(client, { name: routeLabel(window.location.pathname) });
  track = pathname => { sdk.startBrowserTracingNavigationSpan(client, { name: routeLabel(pathname) }); };
  window.addEventListener('error', event => { sdk.captureException(event.error ?? new Error('redacted_application_error')); });
  window.addEventListener('unhandledrejection', event => { sdk.captureException(event.reason); });
}
export function trackNavigation(pathname: string) { track(pathname); }
