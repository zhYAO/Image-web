import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config } from '@/proxy';

describe('upload stream ownership at the Proxy matcher', () => {
  it.each(['/api/uploads', '/api/uploads?sessionId=fixture', '/api/uploads/', '/api/uploads/?fresh=1'])('leaves exact upload %s streaming directly to the authenticated route', url => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
  });
  it.each(['/api/uploads-private', '/api/uploads/private', '/api/uploads.json', '/api/upload', '/api/account', '/api/auth/session'])('retains Proxy authentication for neighboring path %s', url => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
  });
});
