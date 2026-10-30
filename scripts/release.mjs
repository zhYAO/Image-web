#!/usr/bin/env node
// Fixed-target transport only. Administrator helper installation, release
// approval/evidence and the Linux build channel remain separate prerequisites.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET = Object.freeze({
  host: 'aliyun-lian', origin: 'https://www.zimage.store',
  frontend: '/opt/zimage/frontend-tools/release.py',
  backend: '/usr/local/libexec/zimage-backend/release.py',
  'first-window': '/usr/local/libexec/zimage-backend/first-window.py',
});
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const SOURCE = /^[a-f0-9]{40}$/;
const SSH = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15'];
const SCP = ['-B', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15'];
const LIMIT = 8 * 1024 * 1024;
const INVENTORY_LIMIT = 4 * 1024 * 1024;
// Wallet and ledger GETs can initialize credit state. Only the explicitly
// marked, fail-closed catalog probe belongs in the v2 read-only receipt.
const READONLY_PATHS = ['/api/health/ready', '/api/meta', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing'];
const LEGACY_PATHS = ['/api/health/ready', '/api/account', '/api/sessions'];
const LEGACY_PROTOCOL = 'zimage-legacy-readonly-v1';
// Read-only counterpart of the existing transport's validation phase. Its
// unpack publication uses Linux renameat2; a Mac/Windows CLI must not weaken
// that server primitive or pretend the local host can run Linux native probes.
const BACKEND_VERIFY = `import hashlib,importlib.util,json,stat,sys,tarfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('release_transport',Path(sys.argv[1]))
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
archive=t.layers.ancestors_safe(Path(sys.argv[2]));release=sys.argv[3];expected=sys.argv[4]
t._sha(release,t.HEX40);t._sha(expected)
before=archive.lstat()
if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or not 0<before.st_size<=t.MAX_OUTER:raise ValueError('Invalid outer artifact')
with tarfile.open(archive,'r:gz') as source:
 members=[];names=set();total=0
 for item in source:
  total+=item.size
  if item.name in names or len(members)>=7 or item.size<0 or total>t.MAX_OUTER or item.type not in (tarfile.REGTYPE,tarfile.AREGTYPE):raise ValueError('Invalid bounded transport member')
  names.add(item.name);members.append(item)
 matches=[item for item in members if item.name=='releases/'+release+'.json']
 if len(matches)!=1 or matches[0].size>t.MAX_MANIFEST:raise ValueError('Invalid transport manifest')
 with source.extractfile(matches[0]) as stream:body=stream.read(t.MAX_MANIFEST+1)
 if t.layers.digest(body)!=expected:raise ValueError('Manifest checksum mismatch')
 manifest=t.layers.parse(body);required=t.required_files(manifest,release,body)
 if t.layers.finish_manifest(t.layers.parse(body))!=body or not names.issubset(required):raise ValueError('Invalid closure/accounting')
 for item in members:
  checksum,size=required[item.name]
  if item.size!=size:raise ValueError('Object size mismatch')
  digest=hashlib.sha256()
  with source.extractfile(item) as stream:
   for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
  if digest.hexdigest()!=checksum:raise ValueError('Object checksum mismatch')
if t.layers.stat_identity(before)!=t.layers.stat_identity(archive.lstat()):raise ValueError('Artifact changed during validation')
print(json.dumps({'manifest':manifest,'productionReady':False}))
`;
const HELP = `Usage:
  node scripts/release.mjs frontend pack --dist DIR --output FILE.tgz --options JSON --public-config JSON --evidence JSON [--project DIR] [--python PYTHON]
  node scripts/release.mjs frontend deploy <pack options> --operation ID --expected-current NS|none [--state-dir DIR]
  node scripts/release.mjs frontend rollback --target NS --expected-current NS --operation ID [--state-dir DIR]
  node scripts/release.mjs frontend status
  node scripts/release.mjs backend deploy --artifact FILE.layers.tgz --manifest JSON --sha SHA40 --archive-sha256 SHA64 --manifest-sha256 SHA64 --run-number N --expected-current SHA40 --operation ID [--python PYTHON] [--state-dir DIR]
  node scripts/release.mjs backend rollback --target SHA40 --expected-current SHA40 --operation ID [--state-dir DIR]
  node scripts/release.mjs backend status
  node scripts/release.mjs first-window run --artifact FILE.layers.tgz --manifest JSON --sha SHA40 --archive-sha256 SHA64 --manifest-sha256 SHA64 --run-number N --expected-current B0_SHA40 --operation ID --policy-sha256 SHA64 --completion-sha256 SHA64 [--python PYTHON] [--state-dir DIR]
  node scripts/release.mjs first-window recover --target B1_SHA40 --expected-current B0_SHA40 --operation ID --policy-sha256 SHA64 --completion-sha256 SHA64 [--python PYTHON] [--state-dir DIR]
  node scripts/release.mjs first-window status
  node scripts/release.mjs status [--env production]
All commands accept optional --env production. Other environments are rejected.
Backend deploy/rollback and first-window run/recover require existing ZIMAGE_AUTH_COOKIE in the local verifier environment.
The CLI transports independently verified receipts for fresh root challenges;
missing authorization rejects before upload/activation. Cookies never enter argv, journals or SSH.
First-window run requires matching root-installed reviewed policy and external completion evidence before upload.
Policy/completion hashes identify canonical sorted compact JSON plus newline, with integral floats normalized.
The fixed run/recover helper receives both expected hashes and rejects changed root approval before mutation.
First-window backend_ready/recovered keeps ingress sealed; it does not complete a production release.
Interrupted first-window operations are observed, never automatically replayed. Recovery is explicit.
Target: https://www.zimage.store via existing SSH alias aliyun-lian; fixed root helpers.
No build, pair, installation, migration or Worker operations are supported.
Keep the local state directory and exact artifacts when reconciling an interrupted operation.
`;

export class ReleaseError extends Error {
  constructor(message, outcome = 'not-started') { super(message); this.name = 'ReleaseError'; this.outcome = outcome; }
}
function requireValue(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ReleaseError(`Invalid ${label}.`);
  return value;
}
function identifier(value, label = 'identifier') {
  requireValue(value, ID, label);
  if (value === 'none') throw new ReleaseError(`${label} cannot be reserved value none.`);
  return value;
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
function parse(argv) {
  if (argv.length === 0 || argv[0] === '--help') return { help: true };
  const [kind, suppliedAction, ...suppliedRest] = argv;
  const aggregate = kind === 'status';
  const action = aggregate ? 'status' : suppliedAction;
  const rest = aggregate ? argv.slice(1) : suppliedRest;
  const firstWindow = kind === 'first-window';
  if ((!aggregate && !['frontend', 'backend', 'first-window'].includes(kind))
    || !(firstWindow ? ['run', 'recover', 'status'] : ['pack', 'deploy', 'rollback', 'status']).includes(action) || (kind === 'backend' && action === 'pack')) {
    throw new ReleaseError('Unsupported release command; pair/build require a separately implemented and verified workflow.');
  }
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!/^--[a-z][a-z0-9-]*$/.test(key) || value === undefined || value.startsWith('--') || key in flags || /[\u0000-\u001f\u007f]/.test(value)) throw new ReleaseError('Invalid, duplicate or missing option.');
    flags[key] = value;
  }
  const pack = ['dist', 'output', 'options', 'public-config', 'evidence', 'project', 'python'];
  const backendPack = ['artifact', 'manifest', 'sha', 'archive-sha256', 'manifest-sha256', 'run-number', 'expected-current', 'operation', 'python', 'state-dir'];
  const allowed = action === 'status' ? [] : firstWindow ? [...(action === 'run' ? backendPack : ['target', 'expected-current', 'operation', 'python', 'state-dir']), 'policy-sha256', 'completion-sha256']
    : action === 'pack' ? pack : action === 'rollback' ? ['target', 'expected-current', 'operation', 'state-dir']
    : kind === 'frontend' ? [...pack, 'operation', 'expected-current', 'state-dir']
      : backendPack;
  for (const key of Object.keys(flags)) if (key !== '--env' && !allowed.includes(key.slice(2))) throw new ReleaseError('Unsupported option.');
  if (flags['--env'] !== undefined && flags['--env'] !== 'production') throw new ReleaseError('Only the fixed production target is supported.');
  flags['--env'] = 'production';
  if (action === 'pack' || (kind === 'frontend' && action === 'deploy')) for (const key of pack.slice(0, 5)) if (!flags[`--${key}`]) throw new ReleaseError(`Missing --${key}.`);
  if (['deploy', 'rollback', 'run', 'recover'].includes(action)) {
    identifier(flags['--operation'], 'operation');
    if (kind === 'backend' || firstWindow) requireValue(flags['--operation'], /^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/, 'backend operation');
    const expected = flags['--expected-current'];
    if (kind === 'frontend' && expected === 'none' && action === 'deploy') { /* Explicit cold frontend publish only. */ }
    else if (kind === 'frontend') identifier(expected, 'expected current');
    else requireValue(expected, SOURCE, 'expected current SHA');
  }
  if (action === 'rollback' || action === 'recover') kind === 'frontend' ? identifier(flags['--target'], 'target') : requireValue(flags['--target'], SOURCE, 'target SHA');
  if ((kind === 'backend' && action === 'deploy') || (firstWindow && action === 'run')) {
    for (const key of ['artifact', 'manifest']) if (!flags[`--${key}`]) throw new ReleaseError(`Missing --${key}.`);
    requireValue(flags['--sha'], SOURCE, 'source SHA');
    requireValue(flags['--archive-sha256'], SHA, 'archive SHA');
    requireValue(flags['--manifest-sha256'], SHA, 'manifest SHA');
    requireValue(flags['--run-number'], /^(?:0|[1-9][0-9]{0,19})$/, 'run number');
  }
  if (firstWindow && action !== 'status') {
    requireValue(flags['--policy-sha256'], SHA, 'reviewed policy checksum');
    requireValue(flags['--completion-sha256'], SHA, 'external completion checksum');
    if (flags['--expected-current'] === (flags['--sha'] ?? flags['--target'])) throw new ReleaseError('First-window requires distinct exact B0 and B1 releases.');
  }
  // Resolve local filenames before passing them to scp: a colon in a relative
  // local filename must never be interpreted as a second remote host.
  for (const key of ['dist', 'output', 'options', 'public-config', 'evidence', 'project', 'artifact', 'manifest', 'state-dir']) if (flags[`--${key}`]) flags[`--${key}`] = resolve(flags[`--${key}`]);
  return { kind, action, flags };
}

export async function runProcess(command, args, { input, environment, signal } = {}) {
  if (input !== undefined && (typeof input !== 'string' || Buffer.byteLength(input) > INVENTORY_LIMIT)) throw new ReleaseError('Inventory input exceeds its bound.');
  const childEnvironment = childEnvironmentWithoutCookie();
  // The authorized cookie is exclusively owned by startVerifier's fixed
  // subprocess. Generic runners, including SSH, cannot receive any spelling.
  if (environment) for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === 'ZIMAGE_AUTH_COOKIE') throw new ReleaseError('Cookie environment is reserved for the fixed local verifier.');
    childEnvironment[key] = value;
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { shell: false, env: childEnvironment, signal, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', total = 0, exceeded = false;
    const collect = key => block => {
      total += block.length;
      if (total > LIMIT) { exceeded = true; child.kill(); return; }
      if (key === 'stdout') stdout += block.toString('utf8'); else stderr += block.toString('utf8');
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    child.on('error', () => reject(new ReleaseError('Process could not be started.')));
    child.on('close', code => exceeded ? reject(new ReleaseError('Process output exceeded its bound.')) : resolveResult({ code, stdout, stderr }));
  });
}
function childEnvironmentWithoutCookie() {
  return Object.fromEntries(Object.keys(process.env).filter(key => key.toUpperCase() !== 'ZIMAGE_AUTH_COOKIE')
    .map(key => [key, process.env[key]]));
}

/** One CookieJar survives candidate and recovery requests; no token leaves it. */
export async function startVerifier({ python, cookie }) {
  const child = spawn(python, ['-I', '-B', resolve(project, 'ops/aliyun/backend/verify.py'), '--stdio'], {
    shell: false, windowsHide: true, env: { ...childEnvironmentWithoutCookie(), ZIMAGE_AUTH_COOKIE: cookie }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '', ready = false, ended = false, pending, failure;
  let readyResolve, readyReject;
  const readyResult = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
  const fail = message => {
    if (!failure) failure = new ReleaseError(message);
    readyReject(failure);
    if (pending) { clearTimeout(pending.timer); pending.reject(failure); pending = undefined; }
    if (!ended) child.kill();
  };
  const startupTimer = setTimeout(() => fail('Local GET verifier did not become ready before backend mutation.'), 15000);
  startupTimer.unref();
  child.on('error', () => fail('Local GET verifier could not be started before backend mutation.'));
  child.on('close', () => { ended = true; clearTimeout(startupTimer); if (!ready || pending) fail('Local GET verifier ended unexpectedly.'); });
  child.stdin.on('error', () => fail('Local GET verifier input became unavailable.'));
  let stderrBytes = 0;
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 16384) fail('Local GET verifier output exceeded its bound.'); });
  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    if (Buffer.byteLength(buffer) > 32768) { fail('Local GET verifier response exceeded its bound.'); return; }
    while (buffer.includes('\n') && !failure) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      let value;
      try { value = JSON.parse(line); } catch { fail('Local GET verifier returned invalid protocol JSON.'); return; }
      if (!ready) {
        if (!isDeepStrictEqual(value, { schemaVersion: 1, ready: true })) { fail('Local GET verifier was not ready; backend mutation was not requested.'); return; }
        ready = true; clearTimeout(startupTimer); readyResolve();
      } else if (pending) {
        clearTimeout(pending.timer); const current = pending; pending = undefined; current.resolve(line);
      } else { fail('Local GET verifier emitted an unsolicited response.'); return; }
    }
  });
  await readyResult;
  return {
    verify(rawRequest) {
      if (failure || ended || pending || typeof rawRequest !== 'string' || Buffer.byteLength(rawRequest) > 4096 || /[\r\n]/.test(rawRequest.trim())) return Promise.reject(new ReleaseError('Local GET verifier request is unavailable or invalid.'));
      return new Promise((resolveReceipt, rejectReceipt) => {
        const timer = setTimeout(() => fail('Local GET verification exceeded the root challenge window.'), 100000); timer.unref();
        pending = { resolve: resolveReceipt, reject: rejectReceipt, timer };
        child.stdin.write(rawRequest.trim() + '\n');
      });
    },
    async close() {
      clearTimeout(startupTimer);
      if (pending) { clearTimeout(pending.timer); pending.reject(new ReleaseError('Local GET verifier closed.')); pending = undefined; }
      if (ended) return;
      await new Promise(resolveClosed => {
        const timer = setTimeout(() => { child.kill(); resolveClosed(); }, 3000); timer.unref();
        child.once('close', () => { clearTimeout(timer); resolveClosed(); });
        child.stdin.end();
      });
    },
  };
}
function jsonOutput(result, label) {
  if (result.code !== 0) throw new ReleaseError(`${label} failed; inspect the retained operation state.`, 'uncertain');
  try {
    if (Buffer.byteLength(result.stdout) > LIMIT) throw Error();
    const value = JSON.parse(result.stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw new ReleaseError(`${label} returned an invalid response.`, 'uncertain'); }
}
function checkedStatus(kind, value) {
  const optionalId = item => item === null || (typeof item === 'string' && ID.test(item) && item !== 'none');
  if (kind === 'frontend') {
    if (value.schemaVersion !== 1 || !optionalId(value.current) || !optionalId(value.previous)
      || !(value.artifactId === null || SHA.test(value.artifactId ?? '')) || !(value.backendRelease === null || typeof value.backendRelease === 'string')
      || typeof value.httpVerified !== 'boolean' || !Array.isArray(value.operations) || value.operations.some(item => !optionalId(item) || item === null)) throw new ReleaseError('Frontend status schema is invalid.', 'uncertain');
  } else if (!SOURCE.test(value.current ?? '') || !SHA.test(value.frontend ?? '') || value.lifecycle?.schemaVersion !== 1
    || value.lifecycle.backendRelease !== value.current || !Number.isInteger(value.lifecycle.pid) || value.lifecycle.pid <= 0) throw new ReleaseError('Backend status schema is invalid.', 'uncertain');
  return value;
}
const FIRST_WINDOW_PHASES = new Set(['verified', 'stopping_legacy', 'legacy_stopped', 'selecting_candidate', 'starting_candidate', 'checking',
  'backend_ready', 'draining_candidate', 'stopping_candidate', 'selecting_legacy', 'starting_legacy', 'legacy_started', 'checking_legacy',
  'recovered', 'needs_attention', 'configuring_candidate', 'configuring_legacy']);
function firstWindowRecord(record, status) {
  const required = ['schemaVersion', 'kind', 'operationId', 'sequence', 'old', 'target', 'oldPid', 'frontend', 'writesOpened', 'policySha256', 'completionSha256', 'oldProcess', 'phase'];
  const optional = ['verificationTarget', 'candidatePid', 'candidateProcess', 'recoveryPid', 'recoveryProcess', 'writesMayHaveOpened'];
  return record && required.every(key => Object.hasOwn(record, key)) && Object.keys(record).every(key => required.includes(key) || optional.includes(key))
    && record.schemaVersion === 1 && record.kind === 'first-window' && typeof record.operationId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/.test(record.operationId) && SOURCE.test(record.old ?? '') && SOURCE.test(record.target ?? '')
    && record.old !== record.target && SHA.test(record.frontend ?? '') && record.writesOpened === false
    && (!Object.hasOwn(record, 'writesMayHaveOpened') || record.writesMayHaveOpened === false)
    && SHA.test(record.policySha256 ?? '') && SHA.test(record.completionSha256 ?? '') && processIdentity(record.oldProcess) && record.oldPid === record.oldProcess.pid
    && record.sequence === 1 && FIRST_WINDOW_PHASES.has(record.phase)
    && (!Object.hasOwn(record, 'candidateProcess') || processIdentity(record.candidateProcess))
    && (!Object.hasOwn(record, 'recoveryProcess') || processIdentity(record.recoveryProcess))
    && (!Object.hasOwn(record, 'verificationTarget') || [record.old, record.target].includes(record.verificationTarget))
    && (record.phase !== 'backend_ready' || processIdentity(record.candidateProcess) && record.candidatePid === record.candidateProcess.pid)
    && (record.phase !== 'recovered' || processIdentity(record.recoveryProcess) && record.recoveryPid === record.recoveryProcess.pid)
    && (!status || (record.operationId === status.operationId && record.target === status.target && record.policySha256 === status.policySha256
      && record.completionSha256 === status.completionSha256 && isDeepStrictEqual(record.oldProcess, status.legacyProcess) && [record.old, record.target].includes(status.current)));
}
function checkedFirstWindowStatus(value) {
  const keys = ['schemaVersion', 'kind', 'current', 'frontend', 'legacyProcess', 'currentProcess', 'operationId', 'target', 'policySha256', 'completionSha256', 'candidateManifestSha256', 'preflight', 'journal'];
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), keys.sort()) || value.schemaVersion !== 1 || value.kind !== 'first-window'
    || !SOURCE.test(value.current ?? '') || !SOURCE.test(value.target ?? '') || value.frontend !== null
    || !processIdentity(value.legacyProcess) || !(value.currentProcess === null || processIdentity(value.currentProcess))
    || typeof value.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/.test(value.operationId)
    || !SHA.test(value.policySha256 ?? '') || !SHA.test(value.completionSha256 ?? '') || !SHA.test(value.candidateManifestSha256 ?? '')
    || !(value.preflight === 'reviewed-sealed' && value.journal === null && value.current !== value.target && isDeepStrictEqual(value.currentProcess, value.legacyProcess)
      || value.preflight === 'journal-sealed' && firstWindowRecord(value.journal, value))) throw new ReleaseError('First-window status schema or sealed evidence is invalid.', 'uncertain');
  return value;
}
function exactFirstWindowStatus(status, flags, action) {
  const target = action === 'run' ? flags['--sha'] : flags['--target'];
  if (status.operationId !== flags['--operation'] || status.target !== target || status.policySha256 !== flags['--policy-sha256']
    || status.completionSha256 !== flags['--completion-sha256'] || action === 'run' && status.candidateManifestSha256 !== flags['--manifest-sha256']
    || (status.journal ? status.journal.old !== flags['--expected-current'] : status.current !== flags['--expected-current'])) {
    throw new ReleaseError('First-window root approval, completion evidence or exact release identity differs from the request.');
  }
}
function completedFirstWindow(status, action) {
  const record = status.journal, process = status.currentProcess;
  return process && record && (action === 'run'
    ? record.phase === 'backend_ready' && status.current === record.target && process.pid === record.candidatePid && isDeepStrictEqual(process, record.candidateProcess)
    : record.phase === 'recovered' && status.current === record.old && process.pid === record.recoveryPid && isDeepStrictEqual(process, record.recoveryProcess));
}
async function regular(path, max = 2_000_000_000) {
  const info = await lstat(path);
  if (!info.isFile() || info.nlink !== 1 || info.size <= 0 || info.size > max) throw new ReleaseError('Expected a bounded regular artifact file without links.');
}
async function digest(path) {
  await regular(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat(), pathInfo = await lstat(path);
    if (!before.isFile() || before.nlink !== 1 || before.size !== pathInfo.size || before.ino !== pathInfo.ino || before.dev !== pathInfo.dev || pathInfo.isSymbolicLink()) throw new ReleaseError('Artifact changed before checksum verification.');
    const hash = createHash('sha256');
    for await (const block of handle.createReadStream({ autoClose: false })) hash.update(block);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new ReleaseError('Artifact changed during checksum verification.');
    return hash.digest('hex');
  } finally { await handle.close(); }
}
async function readJson(path) {
  await regular(path, LIMIT);
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { throw new ReleaseError('Invalid local JSON input.'); }
}
async function atomicJson(path, value) {
  const temporary = `${path}.next-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
async function packFrontend(flags, runner) {
  const args = [resolve(project, 'ops/aliyun/frontend/package.mjs')];
  for (const key of ['dist', 'output', 'options', 'public-config', 'evidence', 'project', 'python']) if (flags[`--${key}`]) args.push(`--${key}`, flags[`--${key}`]);
  const result = jsonOutput(await runner(process.execPath, args), 'Frontend packaging');
  await verifyFrontend(result, flags);
  return result;
}
async function verifyFrontend(report, flags) {
  if (report.schemaVersion !== 1 || report.productionReady !== false || resolve(report.archive ?? '') !== flags['--output'] || report.manifestPath !== `${flags['--output']}.manifest.json`) throw new ReleaseError('Unexpected frontend packaging report.');
  identifier(report.assetNamespace, 'asset namespace');
  requireValue(report.artifactId, SHA, 'artifact identity');
  requireValue(report.archiveSha256, SHA, 'archive checksum');
  requireValue(report.manifestSha256, SHA, 'manifest checksum');
  if (await digest(report.archive) !== report.archiveSha256 || await digest(report.manifestPath) !== report.manifestSha256) throw new ReleaseError('Frontend archive or manifest changed after packaging.');
  const manifest = await readJson(report.manifestPath);
  if (manifest.assetNamespace !== report.assetNamespace || manifest.artifactId !== report.artifactId) throw new ReleaseError('Frontend manifest identity mismatch.');
}
async function frontendTransport(flags, full, stateDir, runner) {
  const tool = resolve(project, 'ops/aliyun/frontend/transport.mjs');
  const options = ['--archive', full.archive, '--manifest-sha256', full.manifestSha256];
  if (flags['--python']) options.push('--python', flags['--python']);
  const request = jsonOutput(await runner(process.execPath, [tool, 'request', ...options]), 'Frontend inventory request');
  if (request.schemaVersion !== 1 || request.assetNamespace !== full.assetNamespace || request.artifactId !== full.artifactId
    || request.manifestSha256 !== full.manifestSha256 || !Array.isArray(request.objects) || request.objects.length > 20_000) throw new ReleaseError('Invalid frontend inventory identity.');
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body) > INVENTORY_LIMIT) throw new ReleaseError('Frontend inventory exceeds its bound.');
  const inventory = jsonOutput(await runner('ssh', [...SSH, TARGET.host, ...helperArgs('frontend', 'inventory', flags)], { input: body }), 'Frontend inventory');
  if (inventory.schemaVersion !== 1 || inventory.assetNamespace !== request.assetNamespace || inventory.artifactId !== request.artifactId || inventory.manifestSha256 !== request.manifestSha256
    || !Array.isArray(inventory.found) || Buffer.byteLength(JSON.stringify(inventory)) > INVENTORY_LIMIT) throw new ReleaseError('Frontend inventory response differs from the requested artifact.');
  const temporary = await realpath(await mkdtemp(resolve(stateDir, `frontend-${flags['--operation']}-transport-`)));
  const inventoryPath = resolve(temporary, 'inventory.json');
  await writeFile(inventoryPath, JSON.stringify(inventory), { flag: 'wx', mode: 0o600 });
  const archive = resolve(temporary, 'delta.tgz');
  const delta = jsonOutput(await runner(process.execPath, [tool, 'bundle', ...options, '--inventory', inventoryPath, '--output', archive]), 'Frontend delta packaging');
  if (delta.schemaVersion !== 1 || delta.productionReady !== false || delta.archive !== archive || delta.assetNamespace !== full.assetNamespace
    || delta.artifactId !== full.artifactId || delta.manifestSha256 !== full.manifestSha256) throw new ReleaseError('Frontend delta identity mismatch.');
  requireValue(delta.archiveSha256, SHA, 'delta archive checksum');
  if (await digest(delta.archive) !== delta.archiveSha256) throw new ReleaseError('Frontend delta archive checksum mismatch.');
  return delta;
}
async function verifyBackend(flags, runner) {
  const artifact = flags['--artifact'], manifestPath = flags['--manifest'];
  if (await digest(artifact) !== flags['--archive-sha256'] || await digest(manifestPath) !== flags['--manifest-sha256']) throw new ReleaseError('Backend archive or manifest checksum mismatch.');
  const manifest = await readJson(manifestPath);
  if (manifest.releaseId !== flags['--sha'] || manifest.runtime?.platform !== 'linux' || !/^glibc-[0-9]+(?:\.[0-9]+)+$/.test(manifest.runtime?.libc ?? '')) throw new ReleaseError('Backend requires the exact Linux glibc release artifact; host builds are never promoted implicitly.');
  // Reuse the authoritative schema/Linux/accounting functions, validate every
  // supplied member without extracting or invoking Linux-only renameat2.
  const verified = jsonOutput(await runner(flags['--python'] ?? 'python3', ['-I', '-B', '-c', BACKEND_VERIFY, resolve(project, 'ops/aliyun/release-transport.py'), await realpath(artifact), flags['--sha'], flags['--manifest-sha256']]), 'Backend transport verification');
  if (verified.productionReady !== false || !isDeepStrictEqual(verified.manifest, manifest)) throw new ReleaseError('Backend transport manifest differs from the external manifest.');
  return { archive: artifact, archiveSha256: flags['--archive-sha256'], manifestSha256: flags['--manifest-sha256'] };
}
function helperArgs(kind, action, flags, artifact) {
  const base = ['/usr/bin/python3', '-I', '-B', TARGET[kind], action];
  if (action === 'status' || (['backend', 'first-window'].includes(kind) && action === 'verification-request')) return base;
  if (kind === 'first-window') {
    const approval = [flags['--policy-sha256'], flags['--completion-sha256']];
    return action === 'recover' ? [...base, flags['--operation'], ...approval]
      : [...base, flags['--sha'], artifact.archiveSha256, artifact.manifestSha256, flags['--run-number'], flags['--expected-current'], flags['--operation'], ...approval];
  }
  if (kind === 'frontend' && action === 'inventory') return [...base, flags['--operation']];
  if (kind === 'frontend') return action === 'deploy'
    ? [...base, flags['--operation'], artifact.assetNamespace, artifact.archiveSha256, artifact.manifestSha256, flags['--expected-current']]
    : [...base, flags['--operation'], flags['--expected-current'], flags['--target']];
  return action === 'deploy'
    ? [...base, flags['--sha'], artifact.archiveSha256, artifact.manifestSha256, flags['--run-number'], flags['--expected-current'], flags['--operation']]
    : [...base, flags['--target'], flags['--expected-current'], flags['--operation']];
}
function remote(runner, kind, action, flags = {}, artifact, options) {
  return runner('ssh', [...SSH, TARGET.host, ...helperArgs(kind, action, flags, artifact)], options);
}

function verificationRequest(value, flags, action, now) {
  const keys = ['schemaVersion', 'operationId', 'backendRelease', 'pid', 'nonce', 'createdAt', 'expiresAt'];
  const target = action === 'deploy' ? flags['--sha'] : flags['--target'];
  return value && isDeepStrictEqual(Object.keys(value).sort(), keys.sort()) && value.schemaVersion === 1
    && value.operationId === flags['--operation'] && [target, flags['--expected-current']].includes(value.backendRelease)
    && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647 && SHA.test(value.nonce ?? '')
    && Number.isFinite(value.createdAt) && Number.isFinite(value.expiresAt) && value.createdAt <= now && now <= value.expiresAt
    && value.expiresAt > value.createdAt && value.expiresAt - value.createdAt <= 120;
}
function verifiedReceipt(value, request, now) {
  const keys = ['schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'nonce', 'requestSha256', 'checkedAt',
    'checks', 'authenticatedReadOnly', 'independentPublic', 'catalogReady'];
  return value && isDeepStrictEqual(Object.keys(value).sort(), keys.sort()) && value.schemaVersion === 1
    && value.verifierProtocol === 'zimage-backend-readonly-v2' && value.operationId === request.operationId
    && value.backendRelease === request.backendRelease && value.pid === request.pid && value.nonce === request.nonce
    && SHA.test(value.requestSha256 ?? '') && Number.isFinite(value.checkedAt) && request.createdAt <= value.checkedAt
    && value.checkedAt <= now && now <= request.expiresAt
    && value.authenticatedReadOnly === true && value.independentPublic === true && value.catalogReady === true
    && isDeepStrictEqual(value.checks, READONLY_PATHS.map((path, index) => ({ path, status: 200, noStore: true, authenticated: index >= 2 })));
}
function processIdentity(value) {
  return value && isDeepStrictEqual(Object.keys(value).sort(), ['pid', 'startTicks', 'bootId'].sort())
    && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647
    && Number.isSafeInteger(value.startTicks) && value.startTicks > 0
    && typeof value.bootId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.bootId);
}
function requestDigest(request) {
  return createHash('sha256').update(JSON.stringify(sorted(request)) + '\n').digest('hex');
}
function firstWindowRequest(value, flags, action, now) {
  const target = action === 'run' ? flags['--sha'] : flags['--target'];
  if (value?.backendRelease === target && value.verifierProtocol === undefined) return verificationRequest(value, { ...flags, '--target': target }, 'rollback', now);
  const keys = ['schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'processStart', 'nonce', 'createdAt', 'expiresAt'];
  return value && isDeepStrictEqual(Object.keys(value).sort(), keys.sort()) && value.schemaVersion === 1
    && value.verifierProtocol === LEGACY_PROTOCOL && value.operationId === flags['--operation'] && value.backendRelease === flags['--expected-current']
    && processIdentity(value.processStart) && value.pid === value.processStart.pid && SHA.test(value.nonce ?? '')
    && Number.isFinite(value.createdAt) && Number.isFinite(value.expiresAt) && value.createdAt <= now && now <= value.expiresAt
    && value.expiresAt > value.createdAt && value.expiresAt - value.createdAt <= 120;
}
function firstWindowReceipt(value, request, now) {
  if (request.verifierProtocol !== LEGACY_PROTOCOL) return verifiedReceipt(value, request, now) && value.requestSha256 === requestDigest(request);
  const keys = ['schemaVersion', 'verifierProtocol', 'operationId', 'backendRelease', 'pid', 'processStart', 'nonce', 'requestSha256', 'checkedAt',
    'checks', 'authenticatedReadOnly', 'independentPublic'];
  return value && isDeepStrictEqual(Object.keys(value).sort(), keys.sort()) && value.schemaVersion === 1
    && value.verifierProtocol === LEGACY_PROTOCOL && value.operationId === request.operationId && value.backendRelease === request.backendRelease
    && value.pid === request.pid && isDeepStrictEqual(value.processStart, request.processStart) && value.nonce === request.nonce
    && value.requestSha256 === requestDigest(request) && Number.isFinite(value.checkedAt) && request.createdAt <= value.checkedAt
    && value.checkedAt <= now && now <= request.expiresAt && value.authenticatedReadOnly === true && value.independentPublic === true
    && isDeepStrictEqual(value.checks, LEGACY_PATHS.map((path, index) => ({ path, status: 200, noStore: true, authenticated: index > 0 })));
}
async function monitoredBackend(runner, action, flags, artifact, { verifier, stateDir, journal, save, pause, now, kind = 'backend' }) {
  const controller = new AbortController();
  let settled = false;
  const command = remote(runner, kind, action, flags, artifact, { signal: controller.signal }).then(
    value => { settled = true; return { value }; }, error => { settled = true; return { error }; },
  );
  const deadline = now() + 900;
  const handled = new Set();
  const attempts = new Map();
  const event = async value => {
    journal.receiptEvents = [...(journal.receiptEvents ?? []), value].slice(-32);
    await save('invoking');
  };
  try {
    while (!settled) {
      await Promise.race([command, pause(1000, undefined, { ref: false })]);
      if (settled) break;
      if (now() >= deadline) throw new ReleaseError('Backend receipt window exceeded; inspect root status, maintenance and operation journal.', 'uncertain');
      let incoming;
      try { incoming = await remote(runner, kind, 'verification-request'); } catch { continue; }
      if (settled) break;
      if (incoming.code !== 0 || Buffer.byteLength(incoming.stdout) > 4096) continue;
      let request;
      try { request = JSON.parse(incoming.stdout); } catch { continue; }
      if (!(kind === 'first-window' ? firstWindowRequest(request, flags, action, now()) : verificationRequest(request, flags, action, now()))
        || handled.has(request.nonce) || (attempts.get(request.nonce) ?? 0) >= 2) continue;
      attempts.set(request.nonce, (attempts.get(request.nonce) ?? 0) + 1);
      const folder = await realpath(await mkdtemp(resolve(stateDir, `backend-${flags['--operation']}-readonly-`)));
      const requestPath = resolve(folder, 'request.json'), receiptPath = resolve(folder, 'receipt.json');
      // Retain the original JSON number representation (Python distinguishes
      // 1000 from 1000.0 in its canonical request digest).
      await writeFile(requestPath, incoming.stdout, { flag: 'wx', mode: 0o600 });
      try {
        const rawReceipt = await verifier.verify(incoming.stdout);
        if (Buffer.byteLength(rawReceipt) > 16384) throw new ReleaseError('Independent receipt exceeds its bound.');
        const receipt = JSON.parse(rawReceipt);
        if (!(kind === 'first-window' ? firstWindowReceipt(receipt, request, now()) : verifiedReceipt(receipt, request, now()))) throw new ReleaseError('Independent receipt did not match the fresh root challenge.');
        if (settled) break;
        await writeFile(receiptPath, rawReceipt + '\n', { flag: 'wx', mode: 0o600 });
        const receiptDigest = await digest(receiptPath);
        const uploaded = await runner('scp', [...SCP, '--', receiptPath, `${TARGET.host}:/opt/zimage/incoming/backend-readonly-receipt.json`]);
        if (uploaded.code !== 0) throw new ReleaseError('Read-only receipt upload failed.');
        if (await digest(receiptPath) !== receiptDigest) throw new ReleaseError('Read-only receipt changed during upload.');
        const accepted = jsonOutput(await runner('ssh', [...SSH, TARGET.host, '/usr/bin/python3', '-I', '-B', TARGET[kind], 'accept-receipt', request.operationId, request.backendRelease, String(request.pid), receiptDigest]), 'Root receipt acceptance');
        if (accepted.schemaVersion !== 1 || accepted.accepted !== true || accepted.operationId !== request.operationId || accepted.backendRelease !== request.backendRelease
          || accepted.pid !== request.pid || accepted.requestSha256 !== receipt.requestSha256) throw new ReleaseError('Root did not confirm exact receipt acceptance.');
        handled.add(request.nonce);
        await event({ backendRelease: request.backendRelease, pid: request.pid, nonce: request.nonce, requestSha256: receipt.requestSha256, receiptSha256: receiptDigest, phase: 'accepted' });
      } catch {
        // Candidate failure may cause a root-controlled recovery challenge for
        // the old version. Continue servicing that new nonce, never open writes
        // or replay activation from this independently running client.
        await event({ backendRelease: request.backendRelease, pid: request.pid, nonce: request.nonce, phase: 'failed' });
      }
    }
    const result = await command;
    if (result.error) throw result.error;
    return result.value;
  } finally { if (!settled) controller.abort(); }
}

async function runFirstWindow(action, flags, { runner, environment, verifierFactory, pause, now }) {
  const observe = async () => checkedFirstWindowStatus(jsonOutput(await remote(runner, 'first-window', 'status'), 'First-window status'));
  if (action === 'status') return observe();
  const cookie = environment.ZIMAGE_AUTH_COOKIE;
  if (typeof cookie !== 'string' || !cookie.trim() || /[\r\n]/.test(cookie) || cookie.length > 65536) throw new ReleaseError('An existing authorized ZIMAGE_AUTH_COOKIE is required before any backend mutation.');
  const stateDir = flags['--state-dir'] ?? resolve('.release-operations');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const statePath = resolve(stateDir, `first-window-${flags['--operation']}-${action}.json`);
  const lockPath = resolve(stateDir, `first-window-${flags['--operation']}.lock`);
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { throw new ReleaseError('Operation is already running or has an unreconciled local lock; inspect it before retrying.'); }
  let journal, verifier;
  const binding = sorted({ kind: 'first-window', action, flags: Object.fromEntries(Object.entries(flags).filter(([key]) => key !== '--state-dir')) });
  const save = async phase => { journal.phase = phase; journal.updatedAt = new Date().toISOString(); await atomicJson(statePath, journal); };
  const finish = async (status, reconciled) => {
    const result = { schemaVersion: 1, firstWindowJournal: status.journal, productionReady: false, sealed: true, ...(reconciled ? { reconciled: true } : {}) };
    journal.result = result; await save('succeeded');
    return { ...result, operationState: statePath, replayed: reconciled };
  };
  try {
    try { journal = await readJson(statePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (journal && (journal.schemaVersion !== 1 || !isDeepStrictEqual(journal.request, binding))) throw new ReleaseError('Operation ID is already bound to different inputs.');
    if (journal && !['validating', 'prepared', 'uploading', 'uploaded', 'invoking', 'uncertain', 'succeeded', 'rejected'].includes(journal.phase)) throw new ReleaseError('First-window local journal phase is invalid; reconcile status before any mutation.', 'uncertain');
    if (journal?.phase === 'rejected') throw new ReleaseError('This first-window operation already failed; inspect its retained result.', journal.result?.firstWindowJournal?.phase ?? 'rejected');
    const observed = await observe();
    exactFirstWindowStatus(observed, flags, action);
    if (!journal) {
      journal = { schemaVersion: 1, operation: flags['--operation'], request: binding, phase: 'validating', origin: TARGET.origin };
      await save('validating');
    }
    journal.observedStatus = observed;
    if (['invoking', 'uploading', 'uploaded', 'uncertain', 'succeeded'].includes(journal.phase)) {
      if (completedFirstWindow(observed, action)) return finish(observed, true);
      if (action === 'run' && completedFirstWindow(observed, 'recover')) {
        journal.result = { schemaVersion: 1, firstWindowJournal: observed.journal, productionReady: false, sealed: true };
        await save('rejected');
        throw new ReleaseError('First-window candidate failed and the exact legacy process was recovered with ingress sealed.', 'recovered');
      }
      await save('uncertain');
      throw new ReleaseError('First-window outcome requires status/journal reconciliation; no upload, run or recovery was replayed.', 'uncertain');
    }
    if (action === 'run' && (observed.preflight !== 'reviewed-sealed' || observed.journal !== null)) throw new ReleaseError('First-window journal already exists; inspect it and choose explicit recovery, never replay run.', 'uncertain');
    if (action === 'recover') {
      if (observed.preflight !== 'journal-sealed' || observed.journal === null) throw new ReleaseError('Explicit first-window recovery requires the exact sealed root journal.');
      if (completedFirstWindow(observed, 'recover')) return finish(observed, true);
    }
    // The root-installed approval and external completion evidence were checked
    // above. Neither incoming files nor CLI flags can create either prerequisite.
    verifier = await verifierFactory({ python: flags['--python'] ?? 'python3', cookie });
    if (action === 'run') {
      journal.artifact = await verifyBackend(flags, runner);
      await save('prepared');
      if (await digest(journal.artifact.archive) !== journal.artifact.archiveSha256) throw new ReleaseError('Prepared backend artifact changed.');
      await save('uploading');
      const uploaded = await runner('scp', [...SCP, '--', journal.artifact.archive, `${TARGET.host}:/opt/zimage/incoming/${flags['--sha']}.layers.tgz`]);
      if (uploaded.code !== 0) throw new ReleaseError('First-window artifact upload was not confirmed; inspect status before choosing another operation.', 'uncertain');
      if (await digest(journal.artifact.archive) !== journal.artifact.archiveSha256) throw new ReleaseError('First-window artifact changed during upload.', 'uncertain');
      await save('uploaded');
    }
    await save('invoking');
    const result = jsonOutput(await monitoredBackend(runner, action, flags, journal.artifact, { kind: 'first-window', verifier, stateDir, journal, save, pause, now }), 'First-window helper');
    if (!isDeepStrictEqual(Object.keys(result).sort(), ['schemaVersion', 'firstWindowJournal', 'productionReady'].sort()) || result.schemaVersion !== 1
      || result.productionReady !== false || !firstWindowRecord(result.firstWindowJournal)) throw new ReleaseError('First-window helper did not return an exact sealed transaction.', 'uncertain');
    const confirmed = await observe();
    exactFirstWindowStatus(confirmed, flags, action);
    if (!completedFirstWindow(confirmed, action) || !isDeepStrictEqual(result.firstWindowJournal, confirmed.journal)) throw new ReleaseError('First-window helper result differs from the exact live sealed journal.', 'uncertain');
    journal.observedStatus = confirmed;
    return finish(confirmed, false);
  } catch (error) {
    if (journal && ['invoking', 'uploading', 'uploaded', 'uncertain'].includes(journal.phase)) {
      await save('uncertain');
      if (error instanceof Error) error.outcome = 'uncertain';
    } else if (journal && !['succeeded', 'rejected'].includes(journal.phase) && error instanceof Error && error.outcome !== 'uncertain') error.outcome = 'not-executed';
    throw error;
  } finally { if (verifier) await verifier.close().catch(() => {}); await lock.close(); await rm(lockPath); }
}

export async function runRelease(argv, { runner = runProcess, environment = process.env, verifierFactory = startVerifier, pause = delay, now = () => Date.now() / 1000 } = {}) {
  const request = parse(argv);
  if (request.help) return { help: HELP };
  const { kind, action, flags } = request;
  if (kind === 'first-window') return runFirstWindow(action, flags, { runner, environment, verifierFactory, pause, now });
  if (kind === 'status') {
    const kinds = ['frontend', 'backend'];
    const checked = await Promise.allSettled(kinds.map(async target => checkedStatus(target, jsonOutput(await remote(runner, target, 'status'), `${target} status`))));
    const statuses = Object.fromEntries(checked.map((entry, index) => [kinds[index], entry.status === 'fulfilled' ? { success: true, status: entry.value } : { success: false, error: 'Remote status unavailable or invalid.' }]));
    const success = checked.every(entry => entry.status === 'fulfilled');
    return { schemaVersion: 1, origin: TARGET.origin, success, partial: !success && checked.some(entry => entry.status === 'fulfilled'), ...statuses };
  }
  if (action === 'pack') return packFrontend(flags, runner);
  if (action === 'status') return checkedStatus(kind, jsonOutput(await remote(runner, kind, action), 'Remote status'));
  const cookie = kind === 'backend' ? environment.ZIMAGE_AUTH_COOKIE : undefined;
  if (kind === 'backend' && (typeof cookie !== 'string' || !cookie.trim() || /[\r\n]/.test(cookie) || cookie.length > 65536)) throw new ReleaseError('An existing authorized ZIMAGE_AUTH_COOKIE is required before any backend mutation.');
  const stateDir = flags['--state-dir'] ?? resolve('.release-operations');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const statePath = resolve(stateDir, `${kind}-${flags['--operation']}.json`);
  let lock;
  try { lock = await open(`${statePath}.lock`, 'wx', 0o600); } catch { throw new ReleaseError('Operation is already running or has an unreconciled local lock; inspect it before retrying.'); }
  let journal, verifier;
  const binding = sorted({ kind, action, flags: Object.fromEntries(Object.entries(flags).filter(([key]) => key !== '--state-dir')) });
  const save = async phase => { journal.phase = phase; journal.updatedAt = new Date().toISOString(); await atomicJson(statePath, journal); };
  try {
    if (kind === 'backend') verifier = await verifierFactory({ python: flags['--python'] ?? 'python3', cookie });
    try { journal = await readJson(statePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (journal && (journal.schemaVersion !== 1 || !isDeepStrictEqual(journal.request, binding))) throw new ReleaseError('Operation ID is already bound to different inputs.');
    if (!journal) {
      journal = { schemaVersion: 1, operation: flags['--operation'], request: binding, phase: 'validating', origin: TARGET.origin };
      await save('validating');
    }
    if (action === 'deploy') {
      if (kind === 'frontend') {
        if (journal.artifact) await verifyFrontend(journal.artifact, flags);
        else { journal.artifact = await packFrontend(flags, runner); await save('packaged'); }
      } else journal.artifact = await verifyBackend(flags, runner);
    }
    if (journal.phase === 'succeeded') return { ...journal.result, operationState: statePath, replayed: true };
    if (journal.phase === 'rejected') throw new ReleaseError('This operation already failed; inspect its retained result before choosing a new operation.', 'rejected');
    if (['invoking', 'uncertain'].includes(journal.phase)) {
      // An explicit rerun first observes current remote state; never silently
      // retries within the failed invocation or chooses another operation ID.
      journal.observedStatus = checkedStatus(kind, jsonOutput(await remote(runner, kind, 'status'), 'Reconciliation status'));
      if (kind === 'backend') {
        // Unlike the frontend helper, backend transactions never replay an
        // operation. Only an exact committed journal plus the same live PID
        // can resolve a dropped SSH response as success.
        const observed = journal.observedStatus, record = observed.journal;
        const target = action === 'deploy' ? flags['--sha'] : flags['--target'];
        if (record?.operationId === flags['--operation'] && record.old === flags['--expected-current'] && record.target === target
          && record.phase === 'committed' && record.writesOpened === true && observed.current === target
          && observed.frontend === record.frontend && observed.lifecycle.pid === record.candidatePid) {
          journal.result = { schemaVersion: 1, backendJournal: record, productionReady: false, reconciled: true };
          await save('succeeded');
          return { ...journal.result, operationState: statePath, replayed: true };
        }
        throw new ReleaseError('Backend outcome requires manual status/journal reconciliation; activation was not replayed.', 'uncertain');
      }
      await save('reconciled');
    } else if (action === 'deploy') {
      if (kind === 'frontend' && !journal.transportArtifact) {
        await save('planning-transport');
        journal.transportArtifact = await frontendTransport(flags, journal.artifact, stateDir, runner);
        await save('prepared');
      }
      const transport = journal.transportArtifact ?? journal.artifact;
      if (await digest(transport.archive) !== transport.archiveSha256) throw new ReleaseError('Prepared transport artifact changed.');
      await save('uploading');
      const incoming = kind === 'frontend' ? `/opt/zimage/incoming/frontend-${flags['--operation']}.tgz` : `/opt/zimage/incoming/${flags['--sha']}.layers.tgz`;
      const uploaded = await runner('scp', [...SCP, '--', transport.archive, `${TARGET.host}:${incoming}`]);
      if (uploaded.code !== 0) { await save('upload-failed'); throw new ReleaseError('Artifact upload failed; activation was not requested.', 'not-executed'); }
      // A changed local file must not silently become the bytes passed to the
      // privileged helper. The helper independently rechecks the remote bytes.
      if (await digest(transport.archive) !== transport.archiveSha256) throw new ReleaseError('Artifact changed during upload; activation was not requested.', 'not-executed');
      await save('uploaded');
    }
    await save('invoking');
    const helperResult = kind === 'backend'
      ? await monitoredBackend(runner, action, flags, journal.artifact, { verifier, stateDir, journal, save, pause, now })
      : await remote(runner, kind, action, flags, journal.transportArtifact ?? journal.artifact);
    if (kind === 'frontend' && helperResult.code !== 0) {
      let rejected;
      try { rejected = JSON.parse(helperResult.stdout); } catch { /* An interrupted helper may not have emitted JSON. */ }
      if (rejected?.operationId === flags['--operation'] && rejected.success === false && ['recovered', 'needs_attention'].includes(rejected.state)) {
        journal.result = rejected; await save('rejected');
        throw new ReleaseError('Frontend release failed; its exact recovery result is retained in operation state.', rejected.state);
      }
    }
    const result = jsonOutput(helperResult, 'Remote helper');
    if (kind === 'frontend' && (result.success !== true || result.state !== 'committed' || result.operationId !== flags['--operation']
      || result.newFrontend !== (action === 'deploy' ? journal.artifact.assetNamespace : flags['--target']))) throw new ReleaseError('Frontend helper did not confirm the exact committed operation.', 'uncertain');
    const backendRecord = result.backendJournal ?? result;
    if (kind === 'backend' && (backendRecord.phase !== 'committed' || backendRecord.writesOpened !== true || backendRecord.operationId !== flags['--operation']
      || backendRecord.target !== (action === 'deploy' ? flags['--sha'] : flags['--target']))) throw new ReleaseError('Backend helper did not confirm the exact committed transaction.', 'uncertain');
    journal.result = { ...result, ...(journal.transportArtifact ? { transport: {
      archiveBytes: journal.transportArtifact.archiveBytes, uploadBlobBytes: journal.transportArtifact.uploadBlobBytes,
      reusedBlobBytes: journal.transportArtifact.reusedBlobBytes, uploadBlobCount: journal.transportArtifact.uploadBlobCount,
      reusedBlobCount: journal.transportArtifact.reusedBlobCount,
    } } : {}) };
    await save('succeeded');
    return { ...journal.result, operationState: statePath, replayed: false };
  } catch (error) {
    if (journal && ['invoking', 'uncertain', 'reconciled'].includes(journal.phase)) {
      await save('uncertain');
      if (error instanceof Error) error.outcome = 'uncertain';
    } else if (journal && !['succeeded', 'rejected'].includes(journal.phase) && error instanceof Error) error.outcome = 'not-executed';
    throw error;
  } finally { if (verifier) await verifier.close().catch(() => {}); await lock.close(); await rm(`${statePath}.lock`); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runRelease(process.argv.slice(2));
    process.stdout.write(result.help ?? JSON.stringify(result, null, 2) + '\n');
    if (result.success === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Release rejected${error.outcome ? ` [${error.outcome}]` : ''}: ${error instanceof ReleaseError ? error.message : 'local operation failed; inspect retained state.'}\n`);
    process.exitCode = 1;
  }
}
