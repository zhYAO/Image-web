// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import createConfig from '../vite.config';

const sourceSnapshot = vi.hoisted(() => ({ sourceIdentity: { sourceSHA: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64), lockfileSha256: 'c'.repeat(64), dirty: true }, buildToolchainFingerprint: 'd'.repeat(64), inputFingerprint: 'e'.repeat(64) }));
vi.mock('../scripts/build-source-identity.mjs', () => ({ readBuildSource: () => sourceSnapshot, readSourceSnapshot: () => sourceSnapshot, assertBuildSourceUnchanged: vi.fn() }));
const descriptor = { apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.meta.v1'] }, allowedBackendReleases: ['candidate-backend'] };
afterEach(() => vi.unstubAllEnvs());
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
