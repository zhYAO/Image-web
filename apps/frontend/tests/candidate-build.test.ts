// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import createConfig from '../vite.config';
import { publicAssetUrl } from '../src/platform/public-assets';

const sourceSnapshot = vi.hoisted(() => ({ sourceIdentity: { sourceSHA: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64), lockfileSha256: 'c'.repeat(64), dirty: true }, buildToolchainFingerprint: 'd'.repeat(64), inputFingerprint: 'e'.repeat(64) }));
vi.mock('../scripts/build-source-identity.mjs', () => ({ readBuildSource: () => sourceSnapshot, readSourceSnapshot: () => sourceSnapshot, assertBuildSourceUnchanged: vi.fn() }));
const descriptor = { apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.meta.v1'] }, allowedBackendReleases: ['candidate-backend'] };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function candidateConfig(isSsrBuild = false) {
  vi.stubEnv('ZIMAGE_ASSET_NAMESPACE', 'candidate-frontend');
  vi.stubEnv('ZIMAGE_FRONTEND_COMPATIBILITY', JSON.stringify(descriptor));
  if (typeof createConfig !== 'function') throw new Error('Expected Vite config factory');
  return await createConfig({ command: 'build', mode: 'production', isSsrBuild, isPreview: false });
}
describe('candidate build metadata emission without a bundle/build', () => {
  it('emits only candidate inputs and never a formal acceptance manifest', async () => {
    const config = await candidateConfig();
    const plugin = config.plugins?.[0] as Plugin;
    const emitFile = vi.fn();
    if (typeof plugin.generateBundle !== 'function') throw new Error('Missing candidate emitter');
    if (typeof plugin.buildStart !== 'function') throw new Error('Missing source sampler');
    Reflect.apply(plugin.buildStart, {}, []);
    Reflect.apply(plugin.generateBundle, { emitFile, getModuleIds: () => [] }, []);
    expect(emitFile).toHaveBeenCalledTimes(2);
    const emitted = emitFile.mock.calls.find(([asset]) => asset.fileName === '.release/candidate.json')?.[0];
    expect(emitted).toMatchObject({ type: 'asset', fileName: '.release/candidate.json' });
    expect(JSON.parse(emitted.source)).toEqual({ schemaVersion: 1, namespace: 'candidate-frontend', ...descriptor, sourceIdentity: sourceSnapshot.sourceIdentity, buildToolchainFingerprint: sourceSnapshot.buildToolchainFingerprint });
    expect(emitted.source).not.toMatch(/verified|manifest/);
    expect(config.define?.__ZIMAGE_COMPATIBILITY__).toBe(JSON.stringify(descriptor));
  });
  it.each([{ ...descriptor, schemaVersion: 1 }, { ...descriptor, namespace: 'candidate-frontend' }, { apiRequirements: descriptor.apiRequirements, verifiedBackendReleases: ['candidate-backend'] }])('rejects extra or acceptance descriptor fields before emitting metadata', async invalid => {
    await candidateConfig();
    vi.stubEnv('ZIMAGE_FRONTEND_COMPATIBILITY', JSON.stringify(invalid));
    if (typeof createConfig !== 'function') throw new Error('Expected Vite config factory');
    expect(() => createConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false })).toThrow('Invalid frontend candidate descriptor');
  });
  it('does not emit browser release metadata into the temporary SSR output', async () => {
    const config = await candidateConfig(true);
    const plugin = config.plugins?.[0] as Plugin;
    const emitFile = vi.fn();
    if (typeof plugin.generateBundle !== 'function') throw new Error('Missing candidate emitter');
    if (typeof plugin.buildStart !== 'function') throw new Error('Missing source sampler');
    Reflect.apply(plugin.buildStart, {}, []);
    Reflect.apply(plugin.generateBundle, { emitFile, getModuleIds: () => [] }, []);
    expect(emitFile).toHaveBeenCalledOnce();
    expect(emitFile.mock.calls[0]?.[0]).toMatchObject({ type: 'asset', fileName: 'source-snapshot.json' });
  });
});

describe('catalogue resource URLs in candidate browser and SSR code', () => {
  async function transform(source: string, module = 'features/brand/landing/HeroGallery.tsx', ssr = false) {
    const config = await candidateConfig(ssr);
    const plugin = config.plugins?.[0] as Plugin;
    if (typeof plugin.transform !== 'function') throw new Error('Missing frontend source transform');
    return Reflect.apply(plugin.transform, {}, [source, `/project/apps/web/${module}`]) as string;
  }
  it.each([false, true])('emits immutable catalogue URLs before bundling (SSR=%s)', async ssr => {
    const source = 'export const urls = ["/commerce/apparel-v2/main-1.webp", "/commerce/meitu-v1/shoot-product.webp"];';
    const code = await transform(source, undefined, ssr);
    const built = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    vi.stubGlobal('__ZIMAGE_ASSET_NAMESPACE__', 'candidate-frontend');
    expect(built.urls.map(publicAssetUrl)).toEqual([
      '/frontend-assets/candidate-frontend/commerce/apparel-v2/main-1.webp',
      '/frontend-assets/candidate-frontend/commerce/meitu-v1/shoot-product.webp',
    ]);
    expect(built.urls).toEqual(built.urls.map(publicAssetUrl));
  });
  it.each(['features/brand/landing/HeroGallery.tsx', 'features/brand/landing/WorkflowReel.tsx', 'features/commerce/CommerceEditor.tsx', 'features/commerce/commerce-examples.ts'])('versions reviewed catalogue constants in %s', async module => {
    const code = await transform('export const url = `/commerce/meitu-v1/shoot-product.webp`;', module);
    const built = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    expect(built.url).toBe('/frontend-assets/candidate-frontend/commerce/meitu-v1/shoot-product.webp');
    expect(await transform(code, module)).toBe(code);
  });
  it('preserves remote, private, dynamic and unapproved inputs', async () => {
    const source = 'export const values = ["https://example.test/commerce/photo.webp", "/api/assets/private.webp", "/commerce/unapproved.webp", "/commerce/meitu-v1/shoot-product.webp?download=1"]; export const dynamic = `/commerce/${name}.webp`;';
    expect(await transform(source)).toBe(source);
  });
  it('does not rewrite catalogue-shaped user data outside the reviewed source modules', async () => {
    const source = 'export const message = "/commerce/meitu-v1/shoot-product.webp";';
    const config = await candidateConfig();
    const plugin = config.plugins?.[0] as Plugin;
    if (typeof plugin.transform !== 'function') throw new Error('Missing frontend source transform');
    expect(Reflect.apply(plugin.transform, {}, [source, '/project/apps/frontend/src/platform/public-assets.ts'])).toBe(source);
  });
});
