import { mkdtemp, mkdir, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkStaticResources } from '../scripts/check-dist.mjs';
import { copyPublicAssets } from '../scripts/copy-public-assets.mjs';

const roots: string[] = [];
const candidate = { schemaVersion: 1, namespace: 'test', apiRequirements: { major: 1, minMinor: 0, capabilities: ['runtime.meta.v1'] }, allowedBackendReleases: ['backend-test'], sourceIdentity: { sourceSHA: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64), lockfileSha256: 'c'.repeat(64), dirty: true }, buildToolchainFingerprint: 'd'.repeat(64) };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zimage-frontend-assets-')); roots.push(root);
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, '.release'));
  await writeFile(join(root, '.release/candidate.json'), JSON.stringify(candidate));
  await writeFile(join(root, 'index.html'), '<main>首页</main><script type="module" src="/frontend-assets/test/assets/main.js"></script>');
  await writeFile(join(root, 'assets/main.js'), 'import("./lazy.js");');
  await writeFile(join(root, 'assets/lazy.js'), 'export const x = 1;');
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('static payload resource closure', () => {
  it('checks actual lazy chunks and namespaced HTML resources', async () => {
    expect(await checkStaticResources({ dist: await fixture(), namespace: 'test' })).toMatchObject({ files: 3 });
  });
  it('rejects a missing lazy resource', async () => {
    const root = await fixture(); await rm(join(root, 'assets/lazy.js'));
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Missing static resource');
  });
  it('rejects a stale HTML reference to a different namespace', async () => {
    const root = await fixture(); await writeFile(join(root, 'index.html'), '<script src="/frontend-assets/other/assets/main.js"></script>');
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Unexpected frontend namespace');
  });
  it('rejects an unversioned catalogue constant even when the image exists', async () => {
    const root = await fixture();
    await mkdir(join(root, 'commerce'));
    await writeFile(join(root, 'commerce/example.webp'), 'image');
    await writeFile(join(root, 'assets/lazy.js'), 'export const image = publicAssetUrl("/commerce/example.webp");');
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Unversioned static resource URL');
  });
  it.each(['font.otf', 'chunk.js.map', 'server.node', '.env'])('rejects forbidden payload %s', async file => {
    const root = await fixture(); await writeFile(join(root, file), 'secret');
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow();
  });
  it('rejects symlinks and does not follow them', async () => {
    const root = await fixture(); await symlink('/etc/passwd', join(root, 'assets/link.js'));
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Nonregular static payload');
  });
  it('rejects server secrets and Next/server markers', async () => {
    const root = await fixture(); await writeFile(join(root, 'assets/lazy.js'), 'const x="SUPABASE_SERVICE_ROLE_KEY";');
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Forbidden browser payload marker');
  });
});
describe('candidate metadata is separate from payload and acceptance', () => {
  it('requires candidate metadata before artifact validation', async () => {
    const root = await fixture(); await rm(join(root, '.release/candidate.json'));
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Missing frontend candidate');
  });
  it.each([
    { ...candidate, namespace: 'other' },
    { ...candidate, sourceIdentity: undefined },
    { ...candidate, sourceIdentity: { ...candidate.sourceIdentity, dirty: 'false' } },
    { ...candidate, sourceIdentity: { ...candidate.sourceIdentity, sourceSHA: 'pretend-clean' } },
    { ...candidate, sourceIdentity: { ...candidate.sourceIdentity, extra: true } },
    { ...candidate, buildToolchainFingerprint: 'pretend-toolchain' },
    { ...candidate, verifiedBackendReleases: ['backend-test'] },
    { ...candidate, allowedBackendReleases: [] },
    { ...candidate, allowedBackendReleases: ['duplicate', 'duplicate'] },
    { ...candidate, apiRequirements: { ...candidate.apiRequirements, capabilities: ['bad capability'] } },
    { ...candidate, apiRequirements: { ...candidate.apiRequirements, minMinor: -1 } },
    { ...candidate, apiRequirements: { ...candidate.apiRequirements, undeclared: true } },
  ])('rejects invalid or self-certifying candidate metadata', async invalid => {
    const root = await fixture(); await writeFile(join(root, '.release/candidate.json'), JSON.stringify(invalid));
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Invalid frontend candidate');
  });
  it.each(['manifest.json', 'file-index.json', 'extra.txt', 'nested/file.json'])('rejects an extra internal metadata file %s', async name => {
    const root = await fixture();
    if (name.includes('/')) await mkdir(join(root, '.release/nested'));
    await writeFile(join(root, '.release', name), '{}');
    await expect(checkStaticResources({ dist: root, namespace: 'test' })).rejects.toThrow('Unexpected frontend candidate');
  });
});
describe('allowlisted public media copy', () => {
  it.each(['server.json', 'secret.txt', 'unreviewed.png'])('rejects unexpected commerce source %s without copying any files', async name => {
    const source = await mkdtemp(join(tmpdir(), 'zimage-public-source-')); roots.push(source);
    const dist = await mkdtemp(join(tmpdir(), 'zimage-public-target-')); roots.push(dist);
    await mkdir(join(source, 'commerce'));
    await writeFile(join(source, 'commerce', name), 'unapproved');
    await expect(copyPublicAssets({ source, dist })).rejects.toThrow('Unapproved public asset path');
    expect(await readdir(dist)).toEqual([]);
  });
  it('copies only declared catalogue images and license notices', async () => {
    const source = await mkdtemp(join(tmpdir(), 'zimage-public-source-')); roots.push(source);
    const dist = await mkdtemp(join(tmpdir(), 'zimage-public-target-')); roots.push(dist);
    await mkdir(join(source, 'commerce')); await mkdir(join(source, 'licenses'));
    await mkdir(join(source, 'commerce/templates'));
    await writeFile(join(source, 'commerce/templates/white-main-womenswear-v1.webp'), 'example-image');
    await writeFile(join(source, 'licenses/react-bits-NOTICE.txt'), 'notice');
    await writeFile(join(source, 'server-secret.txt'), 'must not copy');
    await mkdir(join(source, 'commerce/apparel-v2'));
    await writeFile(join(source, 'commerce/apparel-v2/manifest.json'), '{"private":"service-source-only"}');
    for (const name of ['hero', 'detail', 'lifestyle', 'seated']) await writeFile(join(source, `commerce/apparel-v2/source-${name}.png`), 'private source image');
    expect(await copyPublicAssets({ source, dist })).toMatchObject({ files: 2 });
    expect(await readdir(join(dist, 'commerce'))).toEqual(['templates']);
  });
});
