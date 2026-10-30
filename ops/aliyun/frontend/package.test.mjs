import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePackagingArgs, packageFrontend } from './package.mjs';

const valid = ['--dist', 'dist', '--output', 'frontend.tgz', '--options', 'options.json', '--public-config', 'public.json', '--evidence', 'evidence.json'];

test('packaging requires explicit evidence and public configuration', () => {
  assert.equal(parsePackagingArgs(valid).get('--evidence'), 'evidence.json');
  assert.throws(() => parsePackagingArgs(valid.slice(0, -2)), /Missing/);
});

test('packaging rejects duplicate options, unknown commands and control characters', () => {
  for (const argv of [[...valid, '--dist', 'another'], [...valid, '--root', '/opt/zimage'], [...valid.slice(0, -1), 'bad\nfile']]) {
    assert.throws(() => parsePackagingArgs(argv));
  }
});

test('argument values stay literal instead of becoming shell commands', () => {
  const value = 'a path/$(touch /tmp/not-run).json';
  assert.equal(parsePackagingArgs([...valid.slice(0, -1), value]).get('--evidence'), value);
});

test('unlocked Node fails before reading or writing artifacts', { skip: process.versions.node === '24.19.0' }, async () => {
  await assert.rejects(packageFrontend(valid), /locked Node/);
});
