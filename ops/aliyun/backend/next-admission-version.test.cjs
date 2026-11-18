'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./http-admission.cjs');
const catalog = h.SOURCE_PROFILES;
const current = catalog.profiles[catalog.candidateProfile].hashes;
const old = catalog.profiles[catalog.legacy.profile].hashes;

test('stable 16.4.x labels reuse only one complete reviewed profile', () => {
  for (const version of ['16.4.0','16.4.5','16.4.6','16.4.123']) {
    assert.equal(h.frameworkProfile(version, current).profileId, catalog.candidateProfile);
  }
  for (const version of ['16.3.9','16.5.0','17.4.5','16.4.05','v16.4.5','16.4.5-canary.1','16.4.5+build','16.4.5 ','16.4.9007199254740992','',null,undefined,true,{},16.45]) {
    assert.equal(h.stableNext(version), false);
    assert.throws(() => h.frameworkProfile(version,current), /stable 16.4.x/);
  }
});
test('hash mismatch, mixed profiles, missing or extra files never become an audit', () => {
  const name = 'next/dist/server/lib/start-server.js';
  for (const hashes of [old,{...current,[name]:old[name]},{...current,[name]:'0'.repeat(64)}, {...current,extra:'0'.repeat(64)},{}]) {
    assert.throws(() => h.frameworkProfile('16.4.5',hashes), /source profile/);
  }
});
test('retained v1 recovery remains exact SHA/version/source and rejects new legacy candidates', () => {
  for (const sha of catalog.legacy.releases) {
    const profile=h.frameworkProfile('16.4.1',old,sha);
    assert.equal(profile.legacy,true);assert.equal(profile.profileId,catalog.legacy.profile);
    assert.equal(h.legacyReleaseFromCanonicalPath('/opt/zimage/releases/'+sha+'/apps/web/server.js'),sha);
    assert.throws(()=>h.frameworkProfile('16.4.5',current,sha),/legacy/);
    assert.throws(()=>h.frameworkProfile('16.4.1',current,sha),/source profile/);
  }
  assert.throws(()=>h.frameworkProfile('16.4.1',old,'a'.repeat(40)),/legacy/);
  assert.throws(()=>h.frameworkProfile('16.4.1',old),/source profile/);
  assert.equal(h.legacyReleaseFromCanonicalPath('/opt/zimage/current/apps/web/server.js'),undefined);
});
test('module resolution outside the same Next package fails before any hook', t => {
  const next=()=>({version:'16.4.5'});
  next.resolve=name=>name==='next/package.json'?'/release/node_modules/next/package.json':'/other-next/file.js';
  t.mock.method(fs,'realpathSync',value=>value);
  assert.throws(()=>h.inspectRuntime(next,undefined,false),/source module identity/);
});
test('immutable ancestry rejects links, wrong ownership and writable entries', t => {
  let invalid;
  const entry='/opt/zimage/releases/'+catalog.legacy.releases[0]+'/apps/web/server.js';
  t.mock.method(fs,'lstatSync',current=>({uid:invalid==='owner'?1001:0,mode:invalid==='writable'?0o777:0o755,
    isSymbolicLink:()=>invalid==='link',isFile:()=>current===entry&&invalid!=='special',isDirectory:()=>current!==entry}));
  assert.doesNotThrow(()=>h.trustedLegacyEntry(entry));
  for(const reason of ['owner','writable','link','special']) {invalid=reason;assert.throws(()=>h.trustedLegacyEntry(entry),/Untrusted/);}
});
