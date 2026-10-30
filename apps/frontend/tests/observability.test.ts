import { describe, expect, it } from 'vitest';
import { sanitizeBrowserEvent, routeLabel } from '../src/platform/observability';

describe('browser observability privacy', () => {
  it('drops identity, prompts, request details and query-bearing breadcrumbs', () => {
    const event = { user: { email: 'private@example.test' }, request: { url: '/auth?token=secret' }, breadcrumbs: ['secret'], extra: { prompt: 'private' }, contexts: { app: { private: true } }, tags: { operation: 'chat', email: 'private' }, message: 'private prompt', exception: { values: [{ value: 'private stack message' }] } };
    const result = sanitizeBrowserEvent(event);
    expect(result).toMatchObject({ user: { ip_address: '0.0.0.0' }, tags: { operation: 'chat' }, message: 'redacted_application_error', exception: { values: [{ value: 'redacted_application_error' }] } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('uses route classes rather than session IDs or token queries', () => {
    expect(routeLabel('/sessions/private-id?task=private')).toBe('/sessions/:sessionId');
    expect(routeLabel('/auth/verify?token=secret')).toBe('/auth/verify');
    expect(routeLabel('/create/product-main')).toBe('/create/:scene');
  });
});
