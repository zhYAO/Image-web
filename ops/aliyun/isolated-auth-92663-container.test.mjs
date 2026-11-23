import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySupabaseStart } from './isolated-auth-92663-container.mjs';

test('startup emits fixed categories rather than captured private output', () => {
  const rows = [
    [{ error: { code: 'ETIMEDOUT' } }, 'startup deadline'],
    [{ signal: 'SIGTERM' }, 'child signal'],
    [{ stderr: 'failed to bind host port: private value' }, 'port conflict'],
    [{ stderr: 'pool overlaps with deployed network' }, 'network address overlap'],
    [{ stderr: 'failed to pull image arbitrary value' }, 'image retrieval'],
    [{ stderr: 'SQLSTATE 12345 private value' }, 'migration rejected'],
    [{ stderr: 'container supabase_kong_foo is not healthy' }, 'unhealthy kong'],
    [{ stdout: 'unclassified private output' }, 'unclassified child failure'],
  ];
  for (const [result, expected] of rows) assert.equal(classifySupabaseStart(result), expected);
});

test('readiness categorizes only fixed state or numeric HTTP status', async () => {
  const { readinessOutcome } = await import('./isolated-auth-92663-container.mjs');
  assert.equal(readinessOutcome(null, null, 'sha'), 'no HTTP response');
  assert.equal(readinessOutcome({status: 503}, {message: 'private input'}, 'sha'), 'HTTP 503');
  assert.equal(readinessOutcome({status: 200}, {version: 'wrong', status: 'ok'}, 'sha'), 'wrong exact response identity');
  assert.equal(readinessOutcome({status: 200}, {version: 'sha', status: 'ok'}, 'sha'), 'exact ready');
});

test('protected Docker teardown distinguishes absence, ownership and infrastructure failure', async () => {
  const { removeOwnedContainer } = await import('./isolated-auth-92663-container.mjs');
  const name = 'zimage_auth_123456789abc', full = 'a'.repeat(64);
  const ok = (stdout = '') => ({ status: 0, stdout });
  const calls = [];
  const run = (...responses) => args => {
    calls.push(args);
    assert.ok(responses.length);
    return responses.shift();
  };
  removeOwnedContainer(name, run(ok()));
  assert.deepEqual(calls.map(c => c[0]), ['ps']);
  calls.length = 0;
  removeOwnedContainer(name, run(ok(full), ok(name), ok(), ok()));
  assert.deepEqual(calls.map(c => c[0]), ['ps', 'inspect', 'rm', 'ps']);
  assert.equal(calls[2][2], full);
  assert.throws(() => removeOwnedContainer(name, run({status: 1, stdout: ''})), /inventory failed/);
  assert.throws(() => removeOwnedContainer(name, run(ok(full), ok('foreign'))), /ownership/);
  assert.throws(() => removeOwnedContainer(name, run(ok(full), ok(name), {status: 1})), /removal failed/);
  assert.throws(() => removeOwnedContainer(name, run(ok(full), ok(name), ok(), ok(full))), /still present/);
});
