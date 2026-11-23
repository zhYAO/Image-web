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
