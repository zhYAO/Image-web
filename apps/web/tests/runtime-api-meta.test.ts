import { autoImplementMethods } from 'next/dist/server/route-modules/app-route/helpers/auto-implement-methods';
import { NextRequest } from 'next/server';
import { apiErrorSchema, apiMetaSchema, checkFrontendCompatibility } from '@zimage/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as route from '../app/api/meta/route';
import { readRuntimeApiMeta } from '../server/runtime/api-meta';
import { GET as publicConfig } from '../app/api/public-config/route';

const release = '48e35686e0e4d6b302a1940cb12f5ea1be84860e';

// Hand-authored manifest, with no builder shared with the production resolver.
const manifest = {
  schemaVersion: 1,
  assetNamespace: 'frontend-contract-fixture',
  artifactId: 'a'.repeat(64),
  sourceSHA: 'b'.repeat(40),
  treeFingerprint: 'c'.repeat(64),
  build: { toolchainFingerprint: 'd'.repeat(64), lockfileSha256: 'e'.repeat(64), publicConfigFingerprint: 'f'.repeat(64) },
  fileIndex: { path: '.release/file-index.json', sha256: '0'.repeat(64), fileCount: 1, totalBytes: 1 },
  apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.public-config.v1', 'runtime.meta.v1'] },
  verifiedBackendReleases: [release],
};

beforeEach(() => vi.stubEnv('ZIMAGE_BUILD_SHA', release));
afterEach(() => vi.unstubAllEnvs());

describe('runtime API metadata', () => {
  it('publishes the configured release and only the two implemented runtime capabilities', async () => {
    vi.stubEnv('ZIMAGE_API_CAPABILITIES', 'billing.admin,frontend.atomic-release');
    vi.stubEnv('OPENAI_API_KEY', 'private-provider-token');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-service-role');
    const response = route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(apiMetaSchema.parse(await response.json())).toEqual({
      schemaVersion: 1,
      backendRelease: release,
      api: { major: 1, minor: 0 },
      capabilities: ['runtime.public-config.v1', 'runtime.meta.v1'],
    });
  });

  it.each([undefined, '', ' ', 'development', 'release-next', '48e3568', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), '../backend', 'a'.repeat(40) + '\n'])('does not invent a release for missing or untrusted build identity: %j', (value) => {
    expect(readRuntimeApiMeta({ ZIMAGE_BUILD_SHA: value })).toBeNull();
  });

  it('has no development or production fallback when release identity is absent', () => {
    for (const nodeEnvironment of ['development', 'production', 'test']) {
      expect(readRuntimeApiMeta({ NODE_ENV: nodeEnvironment })).toBeNull();
    }
  });

  it('does not report dependency health or depend on an HTTP/auth environment', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const body = await route.GET().json();
    expect(body.backendRelease).toBe(release);
    expect(Object.keys(body).sort()).toEqual(['api', 'backendRelease', 'capabilities', 'schemaVersion']);
  });

  it('returns the same safe no-store error contract as public-config', async () => {
    vi.stubEnv('ZIMAGE_BUILD_SHA', 'private-invalid-release/token');
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
    const response = route.GET();
    const configResponse = publicConfig();
    expect(response.status).toBe(503);
    expect(configResponse.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = apiErrorSchema.parse(await response.json());
    const configBody = apiErrorSchema.parse(await configResponse.json());
    expect(body).toEqual({ ...configBody, correlationId: body.correlationId });
    expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
    expect(JSON.stringify(body)).not.toMatch(/private-invalid|ZIMAGE|environment|Zod/);
  });

  it('validates supplied build identities without reusing mutated capabilities', () => {
    const first = readRuntimeApiMeta({ ZIMAGE_BUILD_SHA: release });
    first?.capabilities.push('fake.capability');
    expect(readRuntimeApiMeta({ ZIMAGE_BUILD_SHA: '1'.repeat(40) })).toMatchObject({
      backendRelease: '1'.repeat(40),
      capabilities: ['runtime.public-config.v1', 'runtime.meta.v1'],
    });
  });

  it('negotiates only verified pairs with satisfied API version and capabilities', async () => {
    const meta = await route.GET().json();
    expect(checkFrontendCompatibility(manifest, meta)).toEqual({ compatible: true, issues: [] });
    expect(checkFrontendCompatibility({ ...manifest, apiRequirements: { ...manifest.apiRequirements, minMinor: 1 } }, meta)).toEqual({
      compatible: false, issues: [{ code: 'api_minor_too_low', required: 1, actual: 0 }],
    });
    expect(checkFrontendCompatibility({ ...manifest, apiRequirements: { ...manifest.apiRequirements, major: 2 } }, meta)).toEqual({
      compatible: false, issues: [{ code: 'api_major_mismatch', required: 2, actual: 1 }],
    });
    expect(checkFrontendCompatibility({ ...manifest, apiRequirements: { ...manifest.apiRequirements, capabilities: ['frontend.atomic-release'] } }, meta)).toEqual({
      compatible: false, issues: [{ code: 'missing_capability', capability: 'frontend.atomic-release' }],
    });
    expect(checkFrontendCompatibility({ ...manifest, verifiedBackendReleases: ['2'.repeat(40)] }, meta)).toEqual({
      compatible: false, issues: [{ code: 'backend_not_verified', backendRelease: release }],
    });
  });

  it('registers GET only, with framework HEAD/OPTIONS and no mutation handler', async () => {
    expect(route.dynamic).toBe('force-dynamic');
    const methods = autoImplementMethods(route);
    const request = new NextRequest('http://localhost/api/meta');
    const context = { params: Promise.resolve({}) };
    async function invoke(method: keyof typeof methods): Promise<Response> {
      const response = await methods[method](request, context);
      if (!(response instanceof Response)) throw new Error('Expected an HTTP Response');
      return response;
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect((await invoke(method)).status).toBe(405);
    }
    const options = await invoke('OPTIONS');
    expect(options.status).toBe(204);
    expect(options.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect((await invoke('HEAD')).headers.get('cache-control')).toBe('no-store');
  });
});
