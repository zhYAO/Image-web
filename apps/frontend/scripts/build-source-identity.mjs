import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateCandidateMetadata } from './candidate-metadata.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rootInputs = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitignore', 'tsconfig.base.json'];
const sourceFolders = ['packages/domain', 'apps/frontend', 'apps/web/features', 'apps/web/gateways', 'apps/web/store', 'apps/web/i18n', 'apps/web/public/commerce', 'apps/web/public/licenses'];
const inputPath = path => rootInputs.includes(path) || sourceFolders.some(folder => path.startsWith(folder + '/'))
  || path === 'apps/web/i18n.ts' || path === 'apps/web/app/globals.css' || path === 'apps/web/tsconfig.json';
const generatedPath = path => /(?:^|\/)(?:node_modules|dist|\.prerender|\.vite|coverage)(?:\/|$)/.test(path) || path.endsWith('.tsbuildinfo');

function actualInputs(root, git) {
  if (git) return git('ls-files', '-z', '--cached', '--others', '--exclude-standard').toString('utf8').split('\0')
    .filter(path => path && inputPath(path) && !generatedPath(path)).sort();
  const paths = [];
  const visit = path => {
    if (generatedPath(path)) return;
    let stat;
    try { stat = lstatSync(resolve(root, path)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isDirectory()) for (const name of readdirSync(resolve(root, path))) visit(path + '/' + name);
    else if (!stat.isFile()) throw new Error('Nonregular frontend source input');
    else paths.push(path);
  };
  [...rootInputs, ...sourceFolders, 'apps/web/i18n.ts', 'apps/web/app/globals.css', 'apps/web/tsconfig.json'].forEach(visit);
  return paths.sort();
}

/** Actual checked-out inputs, never caller supplied source/toolchain labels.
 * The explicit no-Git QA mode uses a zero SHA and is always dirty/nonpublishable.
 */
export function readBuildSource(project, { allowNoGitQa = process.env.ZIMAGE_NO_GIT_QA === '1' } = {}) {
  const root = realpathSync(resolve(project));
  const command = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  let git = command;
  let gitRoot;
  try { gitRoot = command('rev-parse', '--show-toplevel').toString('utf8').trim(); }
  catch (error) { if (!allowNoGitQa) throw error; git = undefined; }
  if (gitRoot && realpathSync(gitRoot) !== root) throw new Error('Expected exact frontend Git project root');
  const lockfileSha256 = digest(readFileSync(resolve(root, 'pnpm-lock.yaml')));
  const packageManager = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).packageManager;
  if (packageManager !== 'pnpm@11.19.0') throw new Error('Unapproved frontend package manager declaration');
  const toolchain = { node: process.versions.node, packageManager };
  const buildToolchainFingerprint = digest(JSON.stringify(toolchain, Object.keys(toolchain).sort()) + '\n');
  const inputs = createHash('sha256');
  for (const path of actualInputs(root, git)) {
    let stat;
    try { stat = lstatSync(resolve(root, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && !stat.isFile()) throw new Error('Nonregular frontend source input');
    inputs.update(path + '\0' + (stat ? `${stat.mode & 0o777}:${digest(readFileSync(resolve(root, path)))}` : 'deleted') + '\n');
  }
  const inputFingerprint = inputs.digest('hex');
  const sourceIdentity = git ? {
    sourceSHA: git('rev-parse', 'HEAD').toString('ascii').trim(),
    treeFingerprint: digest(git('ls-tree', '-r', '--full-tree', 'HEAD')),
    lockfileSha256, dirty: git('status', '--porcelain=v1', '--untracked-files=all').length !== 0,
  } : { sourceSHA: '0'.repeat(40), treeFingerprint: inputFingerprint, lockfileSha256, dirty: true };
  return { sourceIdentity, buildToolchainFingerprint, inputFingerprint };
}

export function assertBuildSourceUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Frontend source changed during build');
}

export function readSourceSnapshot(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024) throw new Error('Invalid frontend source snapshot');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || Object.keys(value).sort().join(',') !== 'buildToolchainFingerprint,inputFingerprint,sourceIdentity'
    || typeof value.inputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputFingerprint)) throw new Error('Invalid frontend source snapshot');
  validateCandidateMetadata({ schemaVersion: 1, namespace: 'snapshot', apiRequirements: { major: 1, minMinor: 0, capabilities: [] }, allowedBackendReleases: ['snapshot'],
    sourceIdentity: value.sourceIdentity, buildToolchainFingerprint: value.buildToolchainFingerprint }, 'snapshot');
  return value;
}

/** Every executable pipeline stage checks the same snapshot before and after
 * its work. Temporary snapshots never enter the final static payload.
 * @param {{project: string, snapshotPath: string, candidatePath?: string, namespace?: string}} options
 */
export function assertStageSource({ project, snapshotPath, candidatePath, namespace }) {
  const snapshot = readSourceSnapshot(snapshotPath);
  assertBuildSourceUnchanged(snapshot, readBuildSource(project));
  if (candidatePath) {
    const candidate = validateCandidateMetadata(JSON.parse(readFileSync(candidatePath, 'utf8')), namespace);
    if (JSON.stringify(candidate.sourceIdentity) !== JSON.stringify(snapshot.sourceIdentity)
      || candidate.buildToolchainFingerprint !== snapshot.buildToolchainFingerprint) throw new Error('Candidate source differs from build snapshot');
  }
  return snapshot;
}
