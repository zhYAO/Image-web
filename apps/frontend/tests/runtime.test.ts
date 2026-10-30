import { describe, expect, it, vi } from 'vitest';
import { loadPublicRuntime, RuntimeReadError } from '../src/platform/public-config';
import { checkRuntimeCompatibility } from '../src/platform/compatibility';

const config = { schemaVersion: 1, formalAuth: true, dataMode: 'http', captchaSiteKey: null, approvedLegalVersion: null, registrationEnabled: false };
const meta = { schemaVersion: 1, backendRelease: 'a'.repeat(40), api: { major: 1, minor: 0 }, capabilities: ['runtime.meta.v1', 'runtime.public-config.v1'] };
const descriptor = { apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.public-config.v1'] }, allowedBackendReleases: [meta.backendRelease] };

describe('public runtime reader', () => {
  it('reads only the two runtime GETs with same-origin cookies and no cache', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(config)).mockResolvedValueOnce(Response.json(meta));
    expect(await loadPublicRuntime({ fetch: request })).toEqual({ config, meta });
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/public-config', '/api/meta']);
    for (const [, options] of request.mock.calls) {
      expect(options).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it.each([
    { ...config, dataMode: 'mock' },
    { ...config, serviceRoleKey: 'do-not-reflect' },
    { ...config, registrationEnabled: true },
  ])('rejects invalid or overbroad config without reflecting payloads', async (invalid) => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(invalid)).mockResolvedValueOnce(Response.json(meta));
    await expect(loadPublicRuntime({ fetch: request })).rejects.toMatchObject({ code: 'invalid_response', message: 'Public runtime is unavailable' });
  });
  it('does not treat 503 as guest or retry requests', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json(meta));
    await expect(loadPublicRuntime({ fetch: request })).rejects.toMatchObject({ code: 'http_error', status: 503 });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('never follows a redirect to login or accepts HTML', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('<html/>', { headers: { 'content-type': 'text/html' } })).mockResolvedValueOnce(Response.json(meta));
    await expect(loadPublicRuntime({ fetch: request })).rejects.toBeInstanceOf(RuntimeReadError);
  });
  it('propagates cancellation without recording an auth state', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => Promise.reject(options?.signal?.reason));
    await expect(loadPublicRuntime({ fetch: request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('runtime compatibility is separate from health and auth', () => {
  it('accepts an allowed compatible candidate identity', () => {
    expect(checkRuntimeCompatibility(descriptor, meta)).toEqual({ compatible: true, issues: [] });
  });
  it('rejects formal manifest acceptance fields in a candidate descriptor', () => {
    const { allowedBackendReleases, ...requirements } = descriptor;
    expect(checkRuntimeCompatibility({ ...requirements, verifiedBackendReleases: allowedBackendReleases }, meta).issues).toEqual(['invalid_descriptor']);
  });
  it('blocks absent build metadata', () => {
    expect(checkRuntimeCompatibility(undefined, meta)).toEqual({ compatible: false, issues: ['invalid_descriptor'] });
  });
  it('detects a backend outside the allowlist, missing capabilities and low minor', () => {
    expect(checkRuntimeCompatibility({ ...descriptor, apiRequirements: { major: 1, minMinor: 2, capabilities: ['auth.cookies.v1'] }, allowedBackendReleases: ['b'.repeat(40)] }, meta)).toEqual({
      compatible: false, issues: ['api_minor_too_low', 'missing_capability', 'backend_not_allowed'],
    });
  });
  it('rejects major mismatch and malformed meta', () => {
    expect(checkRuntimeCompatibility({ ...descriptor, apiRequirements: { major: 2, minMinor: 0, capabilities: [] } }, meta).issues).toContain('api_major_mismatch');
    expect(checkRuntimeCompatibility(descriptor, { ...meta, secret: 'private' }).issues).toEqual(['invalid_api_meta']);
  });
});
