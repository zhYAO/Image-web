import { describe, expect, it } from 'vitest';

import { assertTrustedOrigin, executeRoute } from '@/server/route-context';

describe('Route Handler security boundary', () => {
  it('requires an exact trusted Origin for state-changing requests', () => {
    expect(() => assertTrustedOrigin(new Request('https://zimage.test/api/sessions', {
      headers: { origin: 'https://zimage.test' },
      method: 'POST',
    }))).not.toThrow();

    expect(() => assertTrustedOrigin(new Request('https://zimage.test/api/sessions', {
      method: 'POST',
    }))).toThrow(/请求来源无效/);
    expect(() => assertTrustedOrigin(new Request('https://zimage.test/api/sessions', {
      headers: { origin: 'https://attacker.test' },
      method: 'POST',
    }))).toThrow(/请求来源无效/);
  });

  it('redacts unexpected failures and returns one correlation id', async () => {
    const response = await executeRoute(async () => {
      throw new Error('provider-key=secret raw stack');
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toContain('secret');
    expect(body.correlationId).toBe(response.headers.get('x-correlation-id'));
    expect(body).toMatchObject({ code: 'network', retryable: true });
  });
});
