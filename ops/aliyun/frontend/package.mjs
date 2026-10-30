import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { lstat, open, realpath, readFile } from 'node:fs/promises';

const folder = dirname(fileURLToPath(import.meta.url));
const required = ['--dist', '--output', '--options', '--public-config', '--evidence'];

export function parsePackagingArgs(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (![...required, '--project', '--python'].includes(flag) || flags.has(flag)) throw new Error('Unknown or duplicate frontend packaging option');
    const value = args[++index];
    if (!value || value.startsWith('-') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid frontend packaging option value');
    flags.set(flag, value);
  }
  if (required.some(flag => !flags.has(flag))) throw new Error('Missing frontend packaging option');
  return flags;
}

export async function packageFrontend(args) {
  const flags = parsePackagingArgs(args);
  if (process.getuid?.() === 0) throw new Error('Local frontend packaging must run without root');
  if (process.versions.node !== '24.19.0') throw new Error('Frontend packaging requires locked Node 24.19.0');
  const project = await realpath(resolve(flags.get('--project') ?? resolve(folder, '../../..')));
  const optionsPath = resolve(flags.get('--options'));
  const info = await lstat(optionsPath);
  if (!info.isFile() || info.nlink !== 1 || info.size > 4 * 1024 * 1024) throw new Error('Expected bounded regular options file');
  const options = JSON.parse(await readFile(optionsPath, 'utf8'));
  const identity = { node: process.versions.node, packageManager: 'pnpm@11.19.0' };
  const fingerprint = createHash('sha256').update(JSON.stringify(identity, Object.keys(identity).sort()) + '\n').digest('hex');
  if (options.build?.toolchainFingerprint !== fingerprint) throw new Error('Options differ from actual locked frontend toolchain');
  const python = flags.get('--python') ?? process.env.ZIMAGE_PYTHON_BIN ?? 'python3';
  const pythonArgs = ['-I', '-B', resolve(folder, 'pack.py')];
  for (const flag of required) pythonArgs.push(flag, resolve(flags.get(flag)));
  pythonArgs.push('--project', project);
  const result = spawnSync(python, pythonArgs, { shell: false, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.stderr?.trim() || 'Frontend packaging failed');
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error('Frontend packer returned invalid JSON'); }
  // Verify the result archive through an opened regular descriptor, not its
  // filename alone; callers receive hashes of actual bytes.
  const handle = await open(report.archive, 'r');
  try {
    const before = await handle.stat();
    const pathInfo = await lstat(report.archive);
    if (!before.isFile() || before.nlink !== 1 || pathInfo.isSymbolicLink() || before.ino !== pathInfo.ino || before.dev !== pathInfo.dev || before.size !== report.archiveBytes) throw new Error('Frontend archive changed');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    if (hash.digest('hex') !== report.archiveSha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Frontend archive checksum mismatch');
  } finally { await handle.close(); }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await packageFrontend(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write('Frontend packaging failed: ' + error.message + '\n'); process.exitCode = 1; }
}
