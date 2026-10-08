import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseNode, supportsVersion } from './dev.mjs';

test('requires the configured minimum, accepts newer versions, rejects invalid output', () => {
  assert.equal(supportsVersion('v24.16.0', '24.19.0'), false);
  assert.equal(supportsVersion('v24.19.0', '24.19.0'), true);
  assert.equal(supportsVersion('v26.3.0', '24.19.0'), true);
  assert.equal(supportsVersion('not-node', '24.19.0'), false);
});
test('skips an outdated or unavailable node and selects an installed compatible runtime', () => {
  const versions = { old: 'v24.16.0', current: 'v26.3.0' };
  assert.deepEqual(chooseNode(['old', 'missing', 'current'], '24.19.0', path => versions[path]), { path: 'current', version: 'v26.3.0' });
});
test('keeps an already compatible runtime and fails clearly if none is available', () => {
  assert.equal(chooseNode(['current', 'fallback'], '24.19.0', () => 'v24.19.0').path, 'current');
  assert.throws(() => chooseNode(['old'], '24.19.0', () => 'v24.16.0'), /ZIMAGE_NODE_BIN/);
});
