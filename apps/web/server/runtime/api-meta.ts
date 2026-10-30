import { apiMetaSchema, type ApiMeta } from '@zimage/domain';

import { runtimeUnavailableResponse } from './public-config';

export function readRuntimeApiMeta(environment: Record<string, string | undefined>): ApiMeta | null {
  // Existing release packaging supplies the complete lowercase source SHA.
  // Never substitute ready's local "development" fallback or accept a guessed
  // release label as evidence of the running backend's identity.
  const backendRelease = environment.ZIMAGE_BUILD_SHA;
  if (!backendRelease || !/^[a-f0-9]{40}$/.test(backendRelease)) return null;
  const parsed = apiMetaSchema.safeParse({
    schemaVersion: 1,
    backendRelease,
    api: { major: 1, minor: 0 },
    // Implementation contracts only. No dependency health, charging permission,
    // static frontend migration or release/drain capability is implied here.
    capabilities: ['runtime.public-config.v1', 'runtime.meta.v1'],
  });
  return parsed.success ? parsed.data : null;
}

export function apiMetaResponse(): Response {
  // Same static reference as /api/health/ready: next.config.env binds it to the
  // backend build, so a different valid startup SHA cannot impersonate a release.
  const meta = readRuntimeApiMeta({ ZIMAGE_BUILD_SHA: process.env.ZIMAGE_BUILD_SHA });
  return meta
    ? Response.json(meta, { headers: { 'cache-control': 'no-store' } })
    : runtimeUnavailableResponse();
}
