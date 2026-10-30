import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiErrorSchema, chatEventSchema, creditConfirmationSchema } from '@zimage/domain';

import { buildOpenApiDocument } from '@/server/openapi';
import { assertLocalApparelMock } from '@/server/apparel/local-mock';
import { executeRoute, requireVerifiedUserId } from '@/server/route-context';
import { POST as retiredWorker } from '@/app/api/internal/creative-batch-worker/route';

vi.mock('@/server/observability', () => ({ reportServerError: vi.fn() }));

const root = resolve(process.cwd(), '../..');
const baseline = JSON.parse(readFileSync(`${root}/doc/separation/api-baseline.json`, 'utf8')) as {
  sourceSha: string;
  counts: { routeFiles: number; explicitMethods: number };
  routes: { path: string; source: string; sourceSha256: string; methods: string[] }[];
};
// Keep the original baseline immutable. Stage 2 reviews only these two handler
// changes; an unrelated route edit or subsequent drift still fails this guard.
const amendments = JSON.parse(readFileSync(`${root}/doc/separation/api-source-amendments.json`, 'utf8')) as {
  schemaVersion: number;
  baselineSourceSha: string;
  routes: { path: string; source: string; beforeSha256: string; afterSha256: string; reason: string }[];
};
const additions = ['/api/public-config', '/api/meta'];
const normalize = (path: string) => path.replace(/\[([^\]]+)\]/g, '{$1}');
const document = buildOpenApiDocument();
// JSON round trip models the actual /api/openapi.json payload, without coupling
// the assertions to inferred literal types in the document builder.
const wire = JSON.parse(JSON.stringify(document));

function explicitMethods(source: string) {
  const parsed = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const methods: string[] = [];
  for (const statement of parsed.statements) {
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) methods.push(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) methods.push(declaration.name.text);
      }
    }
  }
  return methods.filter(method => ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)).sort();
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('explicit API inventory (source evidence, not HTTP acceptance)', () => {
  it('preserves the frozen routes and methods with only the two reviewed stage 2 source amendments', () => {
    expect(baseline.counts).toEqual({ routeFiles: 49, explicitMethods: 58 });
    expect(baseline.routes).toHaveLength(49);
    expect(baseline.routes.flatMap(route => route.methods)).toHaveLength(58);
    expect(amendments.schemaVersion).toBe(1);
    expect(amendments.baselineSourceSha).toBe(baseline.sourceSha);
    expect(amendments.routes.map(route => route.path).sort()).toEqual(['/api/chat', '/api/uploads']);
    for (const route of baseline.routes) {
      const source = readFileSync(`${root}/${route.source}`, 'utf8');
      const amendment = amendments.routes.find(entry => entry.path === route.path);
      if (amendment) {
        expect(amendment.source).toBe(route.source);
        expect(amendment.beforeSha256).toBe(route.sourceSha256);
        expect(amendment.afterSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(amendment.reason.trim().length).toBeGreaterThan(20);
      }
      expect(createHash('sha256').update(source).digest('hex'), route.source).toBe(amendment?.afterSha256 ?? route.sourceSha256);
      expect(explicitMethods(source), route.path).toEqual([...route.methods].sort());
    }
  });

  it('documents precisely the frozen methods plus two runtime GETs, excluding implicit HEAD/OPTIONS', () => {
    const expected = baseline.routes.flatMap(route => route.methods.map(method => `${method} ${normalize(route.path)}`))
      .concat(additions.map(path => `GET ${path}`)).sort();
    const actual = Object.entries(wire.paths).flatMap(([path, methods]) =>
      Object.keys(methods as object).map(method => `${method.toUpperCase()} ${path}`)).sort();
    expect(actual).toEqual(expected);
    expect(Object.keys(wire.paths)).toHaveLength(51);
    expect(actual).toHaveLength(60);
  });

  it('detects source additions and method drift independently of the OpenAPI inventory', () => {
    const files = routeFiles(`${root}/apps/web/app/api`);
    const actual = files.flatMap(file => explicitMethods(readFileSync(file, 'utf8')).map(method =>
      `${method} ${normalize(file.slice(`${root}/apps/web/app`.length).replace(/\/route\.ts$/, ''))}`));
    const expected = baseline.routes.flatMap(route => route.methods.map(method => `${method} ${normalize(route.path)}`))
      .concat(additions.map(path => `GET ${path}`));
    expect(files).toHaveLength(51);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('keeps all previously published operation IDs and the legacy security scheme name', () => {
    const legacy = {
      'GET /api/auth/session': 'getVerifiedSession', 'GET /api/health/ready': 'getReleaseHealth',
      'GET /api/credits': 'getCreditWallet', 'GET /api/credits/ledger': 'getCreditLedger',
      'GET /api/credits/pricing': 'getCreditPrices', 'POST /api/credits/quote': 'quoteCredits',
      'POST /api/creative-text/optimize': 'optimizeCreativeText', 'POST /api/chat': 'streamChat',
      'GET /api/generations/{id}/asset-url': 'signGenerationAsset', 'GET /api/health/providers': 'getProviderHealth',
      'POST /api/image': 'submitImage', 'POST /api/image/recreate': 'recreateImage',
      'GET /api/image/{id}': 'getImageBatch', 'GET /api/quotas': 'getQuota',
      'GET /api/sessions': 'listSessions', 'POST /api/sessions': 'createSession',
      'DELETE /api/sessions/{id}': 'deleteSession', 'PATCH /api/sessions/{id}': 'renameSession',
      'GET /api/sessions/{id}/timeline': 'getTimeline', 'GET /api/skills': 'listSkills', 'POST /api/uploads': 'uploadReference',
    };
    for (const [key, operationId] of Object.entries(legacy)) {
      const [method, path] = key.split(' ');
      if (!method || !path) throw new Error(`Malformed legacy API fixture: ${key}`);
      expect(wire.paths[path][method.toLowerCase()].operationId).toBe(operationId);
    }
    expect(wire.security).toEqual([{ anonymousSession: [] }]);
    expect(wire.components.securitySchemes.anonymousSession).toBeDefined();
  });

  it('resolves every component reference and retains the published UUID path constraints', () => {
    const references = [...JSON.stringify(wire).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)];
    expect(references.length).toBeGreaterThan(50);
    for (const reference of references) {
      const name = reference[1];
      if (!name) throw new Error('Malformed component reference');
      expect(wire.components.schemas[name], name).toBeDefined();
    }
    for (const path of ['/api/image/{id}', '/api/generations/{id}/asset-url']) {
      expect(wire.paths[path].get.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ in: 'path', name: 'id', schema: { type: 'string', format: 'uuid' } }),
      ]));
    }
  });
});

describe('method contracts and selected real local behavior', () => {
  it('documents bounded upload ingestion without changing file-validation or billing semantics', () => {
    const responses = wire.paths['/api/uploads'].post.responses;
    for (const status of ['400', '408', '413', '503']) {
      expect(responses[status]?.content?.['application/json']?.schema).toEqual({ $ref: '#/components/schemas/ApiError' });
    }
    expect(responses['402']).toBeUndefined();
  });

  it('declares method-specific auth/cache and every path parameter without inventing universal billing errors', () => {
    for (const [path, methods] of Object.entries(wire.paths)) {
      for (const operation of Object.values(methods as Record<string, typeof wire.paths[string][string]>)) {
        expect(operation['x-auth-policy'], path).toBeTruthy();
        expect(operation['x-cache-control'], path).toBeTruthy();
        for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1])) {
          expect(operation.parameters, path).toEqual(expect.arrayContaining([expect.objectContaining({ in: 'path', name, required: true })]));
        }
      }
    }
    expect(wire.paths['/api/skills'].get.security).toEqual([]);
    expect(wire.paths['/api/skills'].get.responses['402']).toBeUndefined();
    expect(wire.paths['/api/health/ready'].get.responses['401']).toBeUndefined();
    expect(wire.paths['/api/auth/session'].get['x-cache-control']).toBe('private, no-store');
    expect(wire.paths['/api/generations/{id}/asset-url'].get['x-cache-control']).toBe('not-set-by-handler');
  });

  it('keeps retired batch writes Gone and does not advertise a successful submission', async () => {
    for (const path of ['/api/creative-batches', '/api/creative-batches/{id}', '/api/internal/creative-batch-worker']) {
      const operation = wire.paths[path].post;
      expect(Object.keys(operation.responses)).toEqual(['410']);
      expect(operation['x-cache-control']).toBe('no-store');
      expect(operation.security).toEqual([]);
    }
    const response = await retiredWorker();
    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ code: 'gone' });
  });

  it.each([
    { status: 401, error: { code: 'PGRST301' }, expected: 401, code: 'unauthorized' },
    { status: 400, error: { code: 'P0001', message: 'unauthorized' }, expected: 401, code: 'unauthorized' },
    { status: 503, error: { code: 'PGRST000' }, expected: 503, code: 'network' },
    { status: 403, error: { code: '42501' }, expected: 503, code: 'network' },
  ])('preserves identity HTTP $expected for fixture $status/$error.code', async fixture => {
    const response = await executeRoute(async () => {
      await requireVerifiedUserId({ rpc: async () => ({ data: null, status: fixture.status, error: fixture.error }) } as never);
      return Response.json({ unreachable: true });
    });
    expect(response.status).toBe(fixture.expected);
    expect(apiErrorSchema.parse(await response.json()).code).toBe(fixture.code);
    expect(wire.paths['/api/auth/session'].get.responses[String(fixture.expected)].description)
      .toMatch(fixture.expected === 401 ? /identity|session/i : /unavailable/i);
  });

  it('retains local mock guards as local-only 404 boundaries', () => {
    vi.stubEnv('ZIMAGE_LOCAL_MOCK_RENDER_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
    vi.stubEnv('VERCEL', ''); vi.stubEnv('VERCEL_ENV', ''); vi.stubEnv('ZIMAGE_DEPLOYMENT_ENV', '');
    expect(() => assertLocalApparelMock(new Request('http://localhost/'))).not.toThrow();
    for (const [key, value] of [['NEXT_PUBLIC_DATA_MODE', 'http'], ['VERCEL_ENV', 'preview'], ['ZIMAGE_DEPLOYMENT_ENV', 'production']] as const) {
      const prior = process.env[key]; vi.stubEnv(key, value);
      try { assertLocalApparelMock(new Request('http://localhost/')); expect.unreachable('must reject'); }
      catch (error) { expect(error).toMatchObject({ status: 404 }); }
      vi.stubEnv(key, prior);
    }
    expect(() => assertLocalApparelMock(new Request('https://example.test/'))).toThrow();
    for (const path of ['/api/creative-tasks/mock-apparel-render', '/api/creative-tasks/mock-apparel-render/download']) {
      expect(wire.paths[path].post['x-auth-policy']).toBe('local-mock-only');
      expect(wire.paths[path].post.responses['404']).toBeDefined();
    }
  });

  it('documents SSE framing and the complete existing event vocabulary from the domain contract', () => {
    const operation = wire.paths['/api/chat'].post;
    expect(operation.responses['200'].content['text/event-stream']).toBeDefined();
    expect(operation['x-cache-control']).toBe('no-cache, no-transform');
    expect(operation['x-sse']).toMatchObject({ framing: 'data: <JSON>\n\n', schema: 'chatEventSchema', terminalEvents: ['message.completed', 'stream.failed'] });
    const frozenEvents = ['task.updated', 'session.created', 'message.delta', 'message.completed', 'tool.queued', 'stream.failed'];
    expect(chatEventSchema.options.map(option => option.shape.type.value)).toEqual(frozenEvents);
    expect(operation['x-sse'].events).toEqual(frozenEvents);
  });

  it('keeps integer Minor pricing, stable idempotency identities and unknown reconciliation semantics explicit', () => {
    expect(creditConfirmationSchema.safeParse({ version: '2026-10-12.1', totalMinor: 30 }).success).toBe(true);
    expect(creditConfirmationSchema.safeParse({ version: '2026-10-12.1', totalMinor: 0.3 }).success).toBe(false);
    for (const path of ['/api/image', '/api/image/recreate']) {
      expect(wire.paths[path].post.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ in: 'header', name: 'idempotency-key', required: true })]));
      expect(wire.paths[path].post.description).toMatch(/unknown.*reconcil/i);
    }
    expect(wire.paths['/api/chat'].post.description).toMatch(/requestId/);
    expect(wire.paths['/api/credits/quote'].post.description).toMatch(/version.*totalMinor/);
    expect(wire.paths['/api/credits'].get.description).toMatch(/100 minor/);
  });

  it('documents the strict six-field runtime config and version metadata as public no-store reads', () => {
    for (const path of additions) {
      expect(wire.paths[path].get.security).toEqual([]);
      expect(wire.paths[path].get['x-cache-control']).toBe('no-store');
      expect(Object.keys(wire.paths[path].get.responses)).toEqual(['200', '503']);
      expect(wire.paths[path].get.responses['503'].headers['Cache-Control'].schema.const).toBe('no-store');
    }
    expect(Object.keys(wire.components.schemas.PublicConfig.properties).sort()).toEqual([
      'schemaVersion', 'formalAuth', 'dataMode', 'captchaSiteKey', 'approvedLegalVersion', 'registrationEnabled',
    ].sort());
    expect(wire.components.schemas.PublicConfig.additionalProperties).toBe(false);
    expect(wire.components.schemas.ApiMeta.properties.api.properties.major.const).toBe(1);
    expect(wire.paths['/api/meta'].get.description).toMatch(/not.*health/i);
  });
});
