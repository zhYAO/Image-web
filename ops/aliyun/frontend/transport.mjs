import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runTransport(argv) {
  if (process.getuid?.() === 0) throw new Error('Local frontend transport must run without root');
  if (process.versions.node !== '24.19.0') throw new Error('Frontend transport requires locked Node 24.19.0');
  const args = [...argv], command = args.shift();
  if (!['request', 'bundle'].includes(command)) throw new Error('Expected request or bundle');
  const required = command === 'bundle' ? ['--archive', '--manifest-sha256', '--inventory', '--output'] : ['--archive', '--manifest-sha256'];
  const flags = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], value = args[++index];
    if (![...required, '--python'].includes(flag) || flags.has(flag) || !value || value.startsWith('-') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid frontend transport options');
    flags.set(flag, value);
  }
  if (required.some(flag => !flags.has(flag)) || !/^[a-f0-9]{64}$/.test(flags.get('--manifest-sha256'))) throw new Error('Missing or invalid frontend transport input');
  const python = flags.get('--python') ?? process.env.ZIMAGE_PYTHON_BIN ?? 'python3';
  const commandArgs = ['-I', '-B', resolve(dirname(fileURLToPath(import.meta.url)), 'transport.py'), command];
  for (const flag of required) commandArgs.push(flag, flag === '--manifest-sha256' ? flags.get(flag) : resolve(flags.get(flag)));
  const result = spawnSync(python, commandArgs, { shell: false, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.stderr?.trim() || 'Frontend transport failed');
  return JSON.parse(result.stdout);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(runTransport(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write('Frontend transport failed: ' + error.message + '\n'); process.exitCode = 1; }
}
