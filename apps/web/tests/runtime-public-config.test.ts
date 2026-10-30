import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoImplementMethods } from 'next/dist/server/route-modules/app-route/helpers/auto-implement-methods';
import { getNextPublicEnvironmentVariables } from 'next/dist/lib/static-env';
import { NextRequest } from 'next/server';
import { apiErrorSchema, publicConfigSchema } from '@zimage/domain';
import * as domain from '@zimage/domain';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as route from '../app/api/public-config/route';
import * as supabaseEnvironment from '../lib/supabase/env';
import * as runtimePublicConfig from '../server/runtime/public-config';
import { readRuntimePublicConfig } from '../server/runtime/public-config';

const httpEnvironment = {
  NEXT_PUBLIC_DATA_MODE: 'http',
  NEXT_PUBLIC_PHASE2_AUTH: 'true',
  NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.test',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_only',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'configured-public-site-key',
  APPROVED_LEGAL_VERSION: 'approved-2026-10-29',
};

// Compile only these tiny modules with Next's bundled Webpack DefinePlugin.
// This exercises the real static-vs-dynamic lookup boundary without building or
// starting the application. External imports are the actual tested modules.
const bundledWebpack = createRequire(import.meta.url)('next/dist/compiled/webpack/webpack') as {
  webpack: ((config: Record<string, unknown>, callback: (error: Error | null, stats?: {
    hasErrors(): boolean;
    toString(): string;
  }) => void) => void) & {
    DefinePlugin: new (definitions: Record<string, string>) => unknown;
  };
};

async function compileModule<Exports>(relativePath: string, definitions: Record<string, string>): Promise<Exports> {
  const directory = mkdtempSync(join(tmpdir(), 'zimage-runtime-contract-'));
  try {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const javascript = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText;
    writeFileSync(join(directory, 'entry.cjs'), javascript);
    await new Promise<void>((resolve, reject) => {
      bundledWebpack.webpack({
        mode: 'none',
        target: 'node',
        entry: join(directory, 'entry.cjs'),
        output: { path: directory, filename: 'fixture.cjs', library: { type: 'commonjs2' } },
        externals: ['@zimage/domain', '../../lib/supabase/env', './public-config'],
        plugins: [new bundledWebpack.webpack.DefinePlugin(definitions)],
        optimization: { minimize: false },
        devtool: false,
      }, (error, stats) => {
        if (error) reject(error);
        else if (stats?.hasErrors()) reject(new Error(stats.toString()));
        else resolve();
      });
    });
    const dependencies: Record<string, unknown> = {
      '@zimage/domain': domain,
      '../../lib/supabase/env': supabaseEnvironment,
      './public-config': runtimePublicConfig,
    };
    const compiledModule = { exports: {} };
    const loadDependency = (name: string) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected fixture dependency: ${name}`);
      return dependencies[name];
    };
    new Function('require', 'module', 'exports', readFileSync(join(directory, 'fixture.cjs'), 'utf8'))(
      loadDependency, compiledModule, compiledModule.exports,
    );
    return compiledModule.exports as Exports;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

beforeEach(() => {
  Object.entries(httpEnvironment).forEach(([name, value]) => vi.stubEnv(name, value));
});
afterEach(() => vi.unstubAllEnvs());

describe('runtime public configuration', () => {
  it('publishes the six HTTP contract fields with no credentials', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-service-role');
    vi.stubEnv('DATABASE_URL', 'postgres://private-database');
    vi.stubEnv('OPENAI_API_KEY', 'private-model-token');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'private-captcha-secret');
    const response = route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const body: unknown = await response.json();
    expect(publicConfigSchema.parse(body)).toEqual({
      schemaVersion: 1,
      formalAuth: true,
      dataMode: 'http',
      captchaSiteKey: 'configured-public-site-key',
      approvedLegalVersion: 'approved-2026-10-29',
      registrationEnabled: true,
    });
    const serialized = JSON.stringify(body);
    for (const value of ['private-service-role', 'postgres://private-database', 'private-model-token', 'private-captcha-secret', 'sb_publishable_fixture_only', 'https://auth.example.test']) {
      expect(serialized).not.toContain(value);
    }
  });

  it.each([
    { NEXT_PUBLIC_PHASE2_AUTH: 'false' },
    { NEXT_PUBLIC_PHASE2_AUTH: undefined },
    { APPROVED_LEGAL_VERSION: undefined },
    { APPROVED_LEGAL_VERSION: '' },
    { APPROVED_LEGAL_VERSION: '   ' },
    { NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined },
    { NEXT_PUBLIC_TURNSTILE_SITE_KEY: '   ' },
  ])('does not enable registration when a prerequisite is absent: %j', (change) => {
    const config = readRuntimePublicConfig({ ...httpEnvironment, ...change });
    expect(config?.registrationEnabled).toBe(false);
    expect(publicConfigSchema.safeParse(config).success).toBe(true);
  });

  it('preserves the current CAPTCHA key semantics, including a configured test key', () => {
    expect(readRuntimePublicConfig({
      ...httpEnvironment,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '  1x00000000000000000000AA  ',
      APPROVED_LEGAL_VERSION: undefined,
    })).toMatchObject({
      captchaSiteKey: '1x00000000000000000000AA',
      approvedLegalVersion: null,
      registrationEnabled: false,
    });
  });

  it.each([
    { NEXT_PUBLIC_DATA_MODE: undefined }, { NEXT_PUBLIC_DATA_MODE: 'mock' },
    { NEXT_PUBLIC_DATA_MODE: 'HTTP' }, { NEXT_PUBLIC_DATA_MODE: '' },
    { NEXT_PUBLIC_PHASE2_AUTH: 'TRUE' }, { NEXT_PUBLIC_PHASE2_AUTH: 'yes' },
    { NEXT_PUBLIC_SUPABASE_URL: undefined }, { NEXT_PUBLIC_SUPABASE_URL: 'http://remote.example.test' },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'short' },
    { APPROVED_LEGAL_VERSION: ' approved-2026-10-29 ' },
    { APPROVED_LEGAL_VERSION: 'draft\nunsafe' }, { APPROVED_LEGAL_VERSION: 'v'.repeat(81) },
    { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'unsafe\u0000key' },
    { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k'.repeat(2049) },
  ])('fails closed for invalid or non-HTTP configuration: %j', (change) => {
    expect(readRuntimePublicConfig({ ...httpEnvironment, ...change })).toBeNull();
  });

  it('rejects service-role JWTs instead of treating them as public configuration', () => {
    const jwt = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
    expect(readRuntimePublicConfig({ ...httpEnvironment, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt })).toBeNull();
  });

  it('returns a uniform safe 503 with no-store and no raw configuration error', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'secret-that-must-not-appear');
    const response = route.GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = apiErrorSchema.parse(await response.json());
    expect(body).toMatchObject({ code: 'service_not_ready', retryable: true });
    expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
    expect(JSON.stringify(body)).not.toMatch(/secret-that-must-not-appear|SUPABASE|Zod|environment/);
  });

  it('reads the legal approval again on each request after the module was loaded', async () => {
    expect((await route.GET().json()).registrationEnabled).toBe(true);
    vi.stubEnv('APPROVED_LEGAL_VERSION', '');
    expect(await route.GET().json()).toMatchObject({ approvedLegalVersion: null, registrationEnabled: false });
  });

  it.each(['true', 'false'])('matches the compiled backend with formal auth=%s despite missing or stale startup values', async (formalAuthFlag) => {
    vi.stubEnv('NEXT_PUBLIC_PHASE2_AUTH', formalAuthFlag);
    const buildRelease = '48e35686e0e4d6b302a1940cb12f5ea1be84860e';
    const buildValues = { ...getNextPublicEnvironmentVariables(), 'process.env.ZIMAGE_BUILD_SHA': buildRelease };
    const definitions = Object.fromEntries(Object.entries(buildValues).flatMap(([name, value]) => (
      value === undefined ? [] : [[name, JSON.stringify(value)]]
    )));
    const configModule = await compileModule<typeof import('../server/runtime/public-config')>('../server/runtime/public-config.ts', definitions);
    const metaModule = await compileModule<typeof import('../server/runtime/api-meta')>('../server/runtime/api-meta.ts', definitions);
    const readyModule = await compileModule<typeof import('../app/api/health/ready/route')>('../app/api/health/ready/route.ts', definitions);

    for (const startup of ['missing', 'stale'] as const) {
      for (const name of Object.keys(httpEnvironment).filter((name) => name.startsWith('NEXT_PUBLIC_'))) {
        vi.stubEnv(name, startup === 'missing' ? undefined : ({
          NEXT_PUBLIC_DATA_MODE: 'mock',
          NEXT_PUBLIC_PHASE2_AUTH: formalAuthFlag === 'true' ? 'false' : 'true',
          NEXT_PUBLIC_SUPABASE_URL: 'https://different-auth.example.test',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_different_fixture',
          NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'different-public-site-key',
        } as Record<string, string>)[name]);
      }
      vi.stubEnv('ZIMAGE_BUILD_SHA', startup === 'missing' ? undefined : '1'.repeat(40));
      vi.stubEnv('APPROVED_LEGAL_VERSION', 'runtime-approved-version');
      const configResponse = configModule.publicConfigResponse();
      const metaResponse = metaModule.apiMetaResponse();
      expect(configResponse.status).toBe(200);
      expect(metaResponse.status).toBe(200);
      expect(configResponse.headers.get('cache-control')).toBe('no-store');
      expect(metaResponse.headers.get('cache-control')).toBe('no-store');
      expect(await configResponse.json()).toEqual({
        schemaVersion: 1,
        dataMode: 'http',
        formalAuth: formalAuthFlag === 'true',
        captchaSiteKey: 'configured-public-site-key',
        approvedLegalVersion: 'runtime-approved-version',
        registrationEnabled: formalAuthFlag === 'true',
      });
      const ready = await readyModule.GET().json();
      expect(ready.version).toBe(buildRelease);
      expect(await metaResponse.json()).toMatchObject({ backendRelease: ready.version });

      // A changed/missing legal approval still closes registration in this same
      // compiled instance; it must never be frozen with the public build values.
      vi.stubEnv('APPROVED_LEGAL_VERSION', '');
      expect(await configModule.publicConfigResponse().json()).toMatchObject({
        approvedLegalVersion: null, registrationEnabled: false,
      });
    }
  });

  it('registers GET only and leaves mutation methods unavailable', async () => {
    expect(route.dynamic).toBe('force-dynamic');
    const methods = autoImplementMethods(route);
    const request = new NextRequest('http://localhost/api/public-config');
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
