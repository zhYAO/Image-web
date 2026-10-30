import { describe, expect, it } from 'vitest';

import {
  apiMetaSchema,
  checkFrontendCompatibility,
  frontendFileIndexSchema,
  frontendManifestSchema,
  publicConfigSchema,
} from '../src';

const publicConfig = {
  schemaVersion: 1,
  formalAuth: true,
  dataMode: 'http',
  captchaSiteKey: '0x4AAAAAAAPublicSiteKey',
  approvedLegalVersion: '2026-10-29',
  registrationEnabled: true,
};
const apiMeta = {
  schemaVersion: 1,
  backendRelease: 'backend-20261029-a',
  api: { major: 1, minor: 2 },
  capabilities: ['runtime.public-config.v1', 'runtime.meta.v1'],
};
const manifest = {
  schemaVersion: 1,
  assetNamespace: 'build-20261029-a',
  artifactId: 'a'.repeat(64),
  sourceSHA: '1'.repeat(40),
  treeFingerprint: 'b'.repeat(64),
  build: {
    toolchainFingerprint: 'c'.repeat(64),
    lockfileSha256: 'd'.repeat(64),
    publicConfigFingerprint: 'e'.repeat(64),
  },
  fileIndex: {
    path: '.release/file-index.json',
    sha256: 'f'.repeat(64),
    fileCount: 2,
    totalBytes: 120,
  },
  apiRequirements: {
    major: 1,
    minMinor: 2,
    capabilities: ['runtime.public-config.v1'],
  },
  verifiedBackendReleases: ['backend-20261029-a'],
};

describe('public runtime configuration', () => {
  it('accepts the explicit HTTP public configuration without adding defaults', () => {
    expect(publicConfigSchema?.safeParse(publicConfig).success).toBe(true);
    expect(publicConfigSchema.parse(publicConfig)).toEqual(publicConfig);
  });

  it('allows a closed registration configuration without legal or captcha values', () => {
    expect(publicConfigSchema.parse({
      ...publicConfig,
      formalAuth: false,
      approvedLegalVersion: null,
      captchaSiteKey: null,
      registrationEnabled: false,
    })).toMatchObject({ registrationEnabled: false });
  });

  it.each(Object.keys(publicConfig))('rejects missing required field %s', (field) => {
    const incomplete: Record<string, unknown> = { ...publicConfig };
    delete incomplete[field];
    expect(publicConfigSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each([
    { schemaVersion: 2 },
    { dataMode: 'mock' },
    { formalAuth: 'true' },
    { approvedLegalVersion: ' ' },
    { captchaSiteKey: '' },
    { captchaSiteKey: 'key\nwith-control' },
    { registrationEnabled: true, formalAuth: false },
    { registrationEnabled: true, approvedLegalVersion: null },
    { registrationEnabled: true, captchaSiteKey: null },
  ])('rejects invalid or fail-open configuration %j', (change) => {
    expect(publicConfigSchema.safeParse({ ...publicConfig, ...change }).success).toBe(false);
  });

  it.each([
    'SUPABASE_SERVICE_ROLE_KEY', 'publishableKey', 'supabaseUrl',
    'providerKey', 'DATABASE_URL', 'AUTH_RATE_LIMIT_PEPPER', '__proto__',
  ])('rejects undeclared public field %s instead of silently stripping it', (field) => {
    expect(publicConfigSchema.safeParse({ ...publicConfig, [field]: 'secret' }).success).toBe(false);
  });
});

describe('API implementation metadata', () => {
  it('accepts explicit v1 version and implementation capabilities', () => {
    expect(apiMetaSchema.parse(apiMeta)).toEqual(apiMeta);
    expect(apiMetaSchema.parse({ ...apiMeta, api: { major: 1, minor: 0 }, capabilities: [] })).toBeTruthy();
  });

  it.each([
    { schemaVersion: 2 }, { backendRelease: '' }, { backendRelease: '../backend' },
    { api: { major: 2, minor: 0 } }, { api: { major: 1, minor: -1 } },
    { api: { major: 1, minor: 1.5 } }, { api: { major: 1, minor: 2, compatible: true } },
    { capabilities: ['runtime.meta.v1', 'runtime.meta.v1'] },
    { capabilities: ['*'] }, { capabilities: ['runtime meta'] },
    { healthy: true }, { providerKey: 'secret' },
  ])('rejects malformed metadata or undeclared health/compatibility claims %j', (change) => {
    expect(apiMetaSchema.safeParse({ ...apiMeta, ...change }).success).toBe(false);
  });

  it.each(Object.keys(apiMeta))('rejects missing metadata field %s', (field) => {
    const incomplete: Record<string, unknown> = { ...apiMeta };
    delete incomplete[field];
    expect(apiMetaSchema.safeParse(incomplete).success).toBe(false);
  });
});

describe('frontend artifact contracts', () => {
  it('keeps the pre-build namespace distinct from post-build content digests', () => {
    expect(frontendManifestSchema.parse(manifest)).toEqual(manifest);
    expect(frontendManifestSchema.parse({ ...manifest, artifactId: '0'.repeat(64) }))
      .toMatchObject({ assetNamespace: 'build-20261029-a', artifactId: '0'.repeat(64) });
  });

  it.each(Object.keys(manifest))('rejects missing manifest field %s', (field) => {
    const incomplete: Record<string, unknown> = { ...manifest };
    delete incomplete[field];
    expect(frontendManifestSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each([
    { schemaVersion: 2 }, { assetNamespace: '../escape' }, { assetNamespace: 'build/a' },
    { artifactId: 'build-20261029-a' }, { sourceSHA: '1'.repeat(7) },
    { treeFingerprint: 'G'.repeat(64) }, { verifiedBackendReleases: [] },
    { verifiedBackendReleases: ['backend-a', 'backend-a'] },
    { build: { ...manifest.build, secretKey: 'secret' } },
    { fileIndex: { ...manifest.fileIndex, path: '../file-index.json' } },
    { fileIndex: { ...manifest.fileIndex, sha256: 'invalid' } },
    { fileIndex: { ...manifest.fileIndex, fileCount: 0 } },
    { fileIndex: { ...manifest.fileIndex, totalBytes: -1 } },
    { apiRequirements: { ...manifest.apiRequirements, minMinor: -1 } },
    { apiRequirements: { ...manifest.apiRequirements, capabilities: ['x', 'x'] } },
    { compatible: true }, { manifestSha256: 'a'.repeat(64) },
  ])('rejects unsafe, circular, ambiguous or incomplete artifact metadata %j', (change) => {
    expect(frontendManifestSchema.safeParse({ ...manifest, ...change }).success).toBe(false);
  });

  const file = { path: 'assets/商品 image.js', bytes: 120, sha256: 'a'.repeat(64) };

  it('validates an independent payload index with portable Unicode paths', () => {
    expect(frontendFileIndexSchema.parse({ schemaVersion: 1, files: [file] }))
      .toEqual({ schemaVersion: 1, files: [file] });
  });

  it.each([
    '../outside.js', '/absolute.js', 'assets/../outside.js', 'assets//app.js',
    'assets\\app.js', 'C:/app.js', 'assets/%2e%2e/app.js', 'assets/app.js?x',
    '.env', '.release/manifest.json', '.release/file-index.json', 'assets/.hidden',
    'assets/app.js\n', 'assets/app.js.', 'assets/app.js ', 'assets/CON.js',
  ])('rejects payload index path %j', (path) => {
    expect(frontendFileIndexSchema.safeParse({ schemaVersion: 1, files: [{ ...file, path }] }).success)
      .toBe(false);
  });

  it('rejects case-colliding paths and extra filesystem attributes', () => {
    expect(frontendFileIndexSchema.safeParse({ schemaVersion: 1, files: [
      { ...file, path: 'assets/App.js' }, { ...file, path: 'assets/app.js' },
    ] }).success).toBe(false);
    expect(frontendFileIndexSchema.safeParse({ schemaVersion: 1, files: [{ ...file, symlink: true }] }).success)
      .toBe(false);
    expect(frontendFileIndexSchema.safeParse({ schemaVersion: 1, files: [{ ...file, bytes: Number.MAX_SAFE_INTEGER + 1 }] }).success)
      .toBe(false);
  });
});

describe('frontend and backend compatibility', () => {
  it('accepts a verified backend at the minimum minor version with a capability superset', () => {
    expect(checkFrontendCompatibility(manifest, apiMeta)).toEqual({ compatible: true, issues: [] });
    expect(checkFrontendCompatibility(manifest, { ...apiMeta, api: { major: 1, minor: 3 } }))
      .toEqual({ compatible: true, issues: [] });
  });

  it('reports precise version, capability and verified-pair failures', () => {
    expect(checkFrontendCompatibility(manifest, {
      ...apiMeta, backendRelease: 'backend-untested', api: { major: 1, minor: 1 }, capabilities: [],
    })).toEqual({ compatible: false, issues: [
      { code: 'api_minor_too_low', required: 2, actual: 1 },
      { code: 'missing_capability', capability: 'runtime.public-config.v1' },
      { code: 'backend_not_verified', backendRelease: 'backend-untested' },
    ] });
    expect(checkFrontendCompatibility({
      ...manifest, apiRequirements: { ...manifest.apiRequirements, major: 2 },
    }, apiMeta)).toEqual({ compatible: false, issues: [{ code: 'api_major_mismatch', required: 2, actual: 1 }] });
  });

  it('fails closed for missing, malicious or unknown-version inputs without exposing their values', () => {
    expect(checkFrontendCompatibility(undefined, { ...apiMeta, schemaVersion: 2 }))
      .toEqual({ compatible: false, issues: [{ code: 'invalid_manifest' }, { code: 'invalid_api_meta' }] });
    expect(checkFrontendCompatibility(manifest, { ...apiMeta, secret: 'do-not-echo' }))
      .toEqual({ compatible: false, issues: [{ code: 'invalid_api_meta' }] });
  });
});
