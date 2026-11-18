'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdmissionController, installFrameworkTracking, frameworkProfile, legacyReleaseFromCanonicalPath, trustedLegacyEntry } = require('./http-admission.cjs');
const legacy = ['7a811b326aa4b344cee08bc5a33c04e44a780fd4', 'fb4fb09f909c0ae5dce98ebd0d9540386685ddb7'];

test('new candidates reject old, unknown and malformed package versions before hooks', () => {
  for (const version of ['16.4.1', '16.4.2', '16.4.6', '16.4.5-canary.1', 'v16.4.5', '', null, undefined, 16.45, {}]) {
    assert.throws(() => installFrameworkTracking(createAdmissionController(), () => ({ version })), /audited Next 16.4.5/);
  }
});
test('current exact version still refuses unaudited source before hooks', () => {
  const fake = () => ({ version: '16.4.5' });
  fake.resolve = () => __filename;
  assert.throws(() => installFrameworkTracking(createAdmissionController(), fake), /Unaudited Next admission source/);
});
test('legacy package observation requires an exact canonical retained release entry', () => {
  for (const sha of legacy) {
    assert.equal(legacyReleaseFromCanonicalPath(`/opt/zimage/releases/${sha}/apps/web/server.js`), sha);
    assert.equal(frameworkProfile(sha).version, '16.4.1');
    for (const entry of [`/tmp/releases/${sha}/apps/web/server.js`, `/opt/zimage/current/apps/web/server.js`,
      `/opt/zimage/releases/${sha}/apps/web/other.js`, `/opt/zimage/releases/${sha}/../apps/web/server.js`])
      assert.equal(legacyReleaseFromCanonicalPath(entry), undefined);
  }
  const unknown = 'a'.repeat(40);
  assert.equal(legacyReleaseFromCanonicalPath(`/opt/zimage/releases/${unknown}/apps/web/server.js`), undefined);
  for (const value of [unknown, '', null, {}, true]) assert.throws(() => frameworkProfile(value), /Unapproved legacy/);
  assert.equal(frameworkProfile().version, '16.4.5');
});
test('legacy and current keep separate exact nine-file source profiles', () => {
  const current = frameworkProfile(), old = frameworkProfile(legacy[0]);
  assert.equal(Object.keys(current.hashes).length, 9);
  assert.deepEqual(Object.keys(current.hashes), Object.keys(old.hashes));
  assert.ok(Object.isFrozen(current.hashes) && Object.isFrozen(old.hashes));
  assert.notEqual(current.hashes['next/dist/server/lib/start-server.js'], old.hashes['next/dist/server/lib/start-server.js']);
  assert.notEqual(current.hashes['next/dist/server/next-server.js'], old.hashes['next/dist/server/next-server.js']);
  for (const name of Object.keys(current.hashes).filter(n => !n.endsWith('/start-server.js') && !n.endsWith('/next-server.js')))
    assert.equal(current.hashes[name], old.hashes[name]);
});
test('legacy profile still requires old exact source and root-managed entry ancestry', t => {
  const next = () => ({ version: '16.4.5' });
  for (const sha of legacy) assert.throws(() => installFrameworkTracking(createAdmissionController(), next, sha), /audited Next 16.4.1/);
  const old = () => ({ version: '16.4.1' });
  old.resolve = () => __filename;
  assert.throws(() => installFrameworkTracking(createAdmissionController(), old, legacy[0]), /Unaudited Next admission source/);
  const fs = require('node:fs');
  const entry = `/opt/zimage/releases/${legacy[0]}/apps/web/server.js`;
  let invalid;
  t.mock.method(fs, 'lstatSync', current => ({ uid: invalid === 'owner' ? 1001 : 0,
    mode: invalid === 'writable' ? 0o777 : 0o755,
    isSymbolicLink: () => invalid === 'link',
    isFile: () => current === entry && invalid !== 'special',
    isDirectory: () => current !== entry }));
  assert.doesNotThrow(() => trustedLegacyEntry(entry));
  for (const reason of ['owner','writable','link','special']) {
    invalid = reason;
    assert.throws(() => trustedLegacyEntry(entry), /Untrusted retained Next entry/);
  }
});
