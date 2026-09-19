import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '@/server/openapi';

describe('OpenAPI document', () => {
  it('publishes every Phase 1 application route with unique operation ids', () => {
    const document = buildOpenApiDocument();
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining([
      '/api/chat',
      '/api/generations/{id}/asset-url',
      '/api/health/providers',
      '/api/image',
      '/api/image/recreate',
      '/api/image/{id}',
      '/api/quotas',
      '/api/sessions',
      '/api/sessions/{id}',
      '/api/sessions/{id}/timeline',
      '/api/skills',
      '/api/uploads',
    ]));
    const operationIds = Object.values(document.paths).flatMap((path) =>
      Object.values(path).map((operation) => operation.operationId));
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(document.security).toEqual([{ anonymousSession: [] }]);
  });
});
