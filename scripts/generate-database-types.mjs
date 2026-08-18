import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supabaseCli = resolve(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const databaseTypes = resolve(repositoryRoot, 'packages', 'supabase', 'src', 'database.types.ts');

const result = spawnSync(process.execPath, [supabaseCli, 'gen', 'types', 'typescript', '--local'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

if (result.error !== undefined) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const generatedTypes = result.stdout.trimEnd();

if (generatedTypes.length === 0) {
  throw new Error('Supabase CLI returned empty database types');
}

writeFileSync(databaseTypes, `${generatedTypes}\n`, 'utf8');
