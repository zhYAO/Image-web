// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBuildSource, assertBuildSourceUnchanged, assertStageSource, readSourceSnapshot } from '../scripts/build-source-identity.mjs';
import { assertClientSource } from '../build/client-boundary';

const roots: string[] = [];
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zimage-source-provenance-')); roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--quiet');
  mkdirSync(join(root, 'apps/frontend/src'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'apps/frontend/dist/\napps/frontend/.prerender/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.19.0' }));
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'fixture lock bytes\n');
  writeFileSync(join(root, 'apps/frontend/src/main.ts'), 'export const fixture = 1;\n');
  git('add', '.');
  // Disposable local Git fixture only. Never modifies the user's repository.
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'source fixture');
  return { root, git };
}
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs(); });
describe('actual build source provenance', () => {
  it('reads exact Git tree bytes, actual lock bytes and the executing toolchain, ignoring forged env labels', () => {
    const { root, git } = fixture();
    vi.stubEnv('ZIMAGE_SOURCE_SHA', 'forged'); vi.stubEnv('ZIMAGE_TOOLCHAIN_FINGERPRINT', 'forged');
    const snapshot = readBuildSource(root);
    expect(snapshot.sourceIdentity).toEqual({ sourceSHA: git('rev-parse', 'HEAD').toString().trim(), treeFingerprint: sha(git('ls-tree', '-r', '--full-tree', 'HEAD')), lockfileSha256: sha('fixture lock bytes\n'), dirty: false });
    expect(snapshot.buildToolchainFingerprint).toBe(sha(JSON.stringify({ node: process.versions.node, packageManager: 'pnpm@11.19.0' }) + '\n'));
    expect(() => assertBuildSourceUnchanged(snapshot, readBuildSource(root))).not.toThrow();
  });
  it('rejects source changes during a dirty QA build even when HEAD and dirty flag stay identical', () => {
    const { root } = fixture();
    const file = join(root, 'apps/frontend/src/main.ts');
    writeFileSync(file, 'export const fixture = "dirty-start";\n');
    const before = readBuildSource(root);
    writeFileSync(file, 'export const fixture = "changed-during-build";\n');
    const after = readBuildSource(root);
    expect(before.sourceIdentity).toEqual(after.sourceIdentity);
    expect(before.sourceIdentity.dirty).toBe(true);
    expect(() => assertBuildSourceUnchanged(before, after)).toThrow('Frontend source changed during build');
  });
  it('rejects a changed lockfile or HEAD rather than labeling the output with a current source', () => {
    const { root, git } = fixture();
    const before = readBuildSource(root);
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'changed lock\n');
    expect(() => assertBuildSourceUnchanged(before, readBuildSource(root))).toThrow('Frontend source changed during build');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'other source fixture');
    expect(readBuildSource(root).sourceIdentity.sourceSHA).not.toBe(before.sourceIdentity.sourceSHA);
    expect(() => assertBuildSourceUnchanged(before, readBuildSource(root))).toThrow();
  });
  it('requires a real Git root and keeps next/script runtime imports forbidden', () => {
    const root = mkdtempSync(join(tmpdir(), 'zimage-source-no-git-')); roots.push(root);
    expect(() => readBuildSource(root)).toThrow();
    expect(() => assertClientSource("import Script from 'next/script';", '/repo/apps/frontend/src/page.tsx')).toThrow('Forbidden server');
  });
  it('ties SSR, copy and final checking to one browser snapshot and includes public media bytes', () => {
    const { root } = fixture();
    mkdirSync(join(root, 'apps/web/public/commerce'), { recursive: true });
    const image = join(root, 'apps/web/public/commerce/sample.webp');
    writeFileSync(image, 'image-A');
    const browser = readBuildSource(root);
    const folder = join(root, 'apps/frontend/dist/.vite'); mkdirSync(folder, { recursive: true });
    const snapshotPath = join(folder, 'source-snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(browser));
    expect(assertStageSource({ project: root, snapshotPath })).toEqual(browser);
    writeFileSync(image, 'image-D');
    const ssr = readBuildSource(root);
    expect(ssr.sourceIdentity).toEqual(browser.sourceIdentity);
    expect(() => assertStageSource({ project: root, snapshotPath })).toThrow('Frontend source changed during build');
    writeFileSync(image, 'image-A');
    expect(() => assertBuildSourceUnchanged(browser, ssr)).toThrow('Frontend source changed during build');
    expect(assertStageSource({ project: root, snapshotPath })).toEqual(browser);
    const candidatePath = join(root, 'apps/frontend/dist/candidate.json');
    writeFileSync(candidatePath, JSON.stringify({ schemaVersion: 1, namespace: 'qa-test', apiRequirements: { major: 1, minMinor: 0, capabilities: [] }, allowedBackendReleases: ['backend-A'],
      sourceIdentity: { ...browser.sourceIdentity, sourceSHA: 'f'.repeat(40) }, buildToolchainFingerprint: browser.buildToolchainFingerprint }));
    expect(() => assertStageSource({ project: root, snapshotPath, candidatePath, namespace: 'qa-test' })).toThrow('Candidate source differs');
    writeFileSync(snapshotPath, JSON.stringify({ ...browser, forged: true }));
    expect(() => readSourceSnapshot(snapshotPath)).toThrow('Invalid frontend source snapshot');
  });
  it('allows no-Git input only through an explicit nonpublishable QA mode, hashing actual files', () => {
    const root = mkdtempSync(join(tmpdir(), 'zimage-source-explicit-qa-')); roots.push(root);
    mkdirSync(join(root, 'apps/frontend/src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.19.0' }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'isolated QA lock');
    const file = join(root, 'apps/frontend/src/main.ts'); writeFileSync(file, 'QA A');
    expect(() => readBuildSource(root)).toThrow();
    vi.stubEnv('ZIMAGE_NO_GIT_QA', '1');
    const before = readBuildSource(root);
    expect(before.sourceIdentity).toMatchObject({ sourceSHA: '0'.repeat(40), dirty: true, treeFingerprint: before.inputFingerprint });
    writeFileSync(file, 'QA D');
    expect(() => assertBuildSourceUnchanged(before, readBuildSource(root))).toThrow('Frontend source changed during build');
  });

  it.each([
    ['git', 'tsconfig.base.json'], ['git', 'apps/web/tsconfig.json'],
    ['no-Git QA', 'tsconfig.base.json'], ['no-Git QA', 'apps/web/tsconfig.json'],
  ])('includes %s TypeScript configuration %s in the actual input fingerprint', (mode, config) => {
    const { root } = fixture();
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    const file = join(root, config!);
    writeFileSync(file, '{"compilerOptions":{"strict":true}}');
    if (mode === 'no-Git QA') { rmSync(join(root, '.git'), { recursive: true, force: true }); vi.stubEnv('ZIMAGE_NO_GIT_QA', '1'); }
    const before = readBuildSource(root);
    writeFileSync(file, '{"compilerOptions":{"strict":false}}');
    const after = readBuildSource(root);
    expect(() => assertBuildSourceUnchanged(before, after)).toThrow('Frontend source changed during build');
    expect(after.inputFingerprint).not.toBe(before.inputFingerprint);
  });

});
