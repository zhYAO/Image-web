import { describe, expect, it } from 'vitest';

import { sanitizeSentryEvent } from '@/lib/sentry/sanitize-event';

describe('Sentry event sanitization', () => {
  it('removes request content, identity and original exception messages while retaining safe tags', () => {
    const event = sanitizeSentryEvent({
      breadcrumbs: [{ message: 'prompt: private prompt' }],
      exception: { values: [{ type: 'Error', value: 'provider echoed private prompt' }] },
      extra: { token: 'secret' },
      message: 'private prompt',
      request: {
        cookies: { session: 'secret' },
        data: 'private prompt',
        headers: { authorization: 'Bearer secret' },
        query_string: 'prompt=private',
        url: 'https://preview.example.test/api/chat',
      },
      tags: { correlation_id: 'safe-correlation-id', operation: 'chat', prompt: 'private prompt' },
      user: { id: 'anonymous-user-id' },
    });

    expect(event).not.toHaveProperty('breadcrumbs');
    expect(event).not.toHaveProperty('extra');
    expect(event.user).toEqual({ ip_address: '0.0.0.0' });
    expect(event).not.toHaveProperty('request');
    expect(event.exception?.values?.[0]?.value).toBe('redacted_application_error');
    expect(event.message).toBe('redacted_application_error');
    expect(event.tags).toEqual({ correlation_id: 'safe-correlation-id', operation: 'chat' });
  });
});
