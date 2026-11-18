'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
// An explicit existing compiler path is useful for offline fixture verification;
// normal installed checkouts use the project's already-declared TypeScript.
const ts = require(process.env.ZIMAGE_TEST_TYPESCRIPT || 'typescript');
function loadSource(file, pinnedNext = '16.4.5') {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = name => name === '../api-error'
    ? loadSource(path.resolve(path.dirname(file), '../api-error.ts'))
    : name === '../../package.json' ? {dependencies:{next:pinnedNext}}
    : name.endsWith('.json') ? JSON.parse(fs.readFileSync(path.resolve(path.dirname(file),name),'utf8')) : require(name);
  loaded._compile(result.outputText, file);
  return loaded.exports;
}
test('compiled artifact pin and reviewed v2 profile negotiate within stable 16.4.x', t => {
  const original = process.env.ZIMAGE_LIFECYCLE_ENABLED;
  process.env.ZIMAGE_LIFECYCLE_ENABLED = '0';
  const { readHttpAdmission, MaintenanceError, COMPILED_NEXT_CONTRACT } = loadSource(path.resolve(__dirname, '../../../apps/web/server/lifecycle/request-lifecycle.ts'));
  assert.equal(readHttpAdmission().frameworkWork.nextVersion, '16.4.5');
  const state = { protocolVersion: 1, barrierId: 'node-http-create-server-v1', installed: true,
    wrappedServerCount: 1, activeHttpRequests: 0, activeFrameworkWork: 0, controlValid: true,
    schemaVersion: 2, admissionMode: 'draining', admissionEpoch: 'version-test-1',
    frameworkWork: { ...COMPILED_NEXT_CONTRACT, installed: true, hook: 'response-cache-revalidate-v1', controlValid: true } };
  const bridge = Object.freeze({ protocolVersion: 1, barrierId: 'node-http-create-server-v1', qaOnly: false, snapshot: () => state });
  const descriptor = Object.getOwnPropertyDescriptor;
  t.mock.method(Object, 'getOwnPropertyDescriptor', (target, key) => target === globalThis && key === Symbol.for('zimage.http-admission.v1')
    ? { value: bridge, writable: false, configurable: false } : descriptor(target, key));
  process.env.ZIMAGE_LIFECYCLE_ENABLED = '1';
  try {
    assert.equal(readHttpAdmission().frameworkWork.nextVersion, '16.4.5');
    for (const version of ['16.4.1','16.4.2','16.4.6','16.4.05','16.5.0','16.4.5-canary.1','',null,undefined,{},true]) {
      state.frameworkWork.nextVersion = version;
      assert.throws(() => readHttpAdmission(), MaintenanceError);
    }
    state.frameworkWork.nextVersion = '16.4.5';
    state.frameworkWork.sourceProfile = 'sha256:'+'0'.repeat(64);
    assert.throws(() => readHttpAdmission(), MaintenanceError);
    state.frameworkWork = { ...COMPILED_NEXT_CONTRACT, installed:true,hook:'response-cache-revalidate-v1',controlValid:true,protocolVersion:1 };
    assert.throws(() => readHttpAdmission(), MaintenanceError);
    const compatible=loadSource(path.resolve(__dirname, '../../../apps/web/server/lifecycle/request-lifecycle.ts'),'16.4.6');
    state.frameworkWork={ ...compatible.COMPILED_NEXT_CONTRACT, installed:true,hook:'response-cache-revalidate-v1',controlValid:true };
    assert.equal(compatible.readHttpAdmission().frameworkWork.nextVersion,'16.4.6');
    state.controlValid=false;
    state.admissionMode='open';
    const gate=()=>({schemaVersion:2,operationId:'version-test-1',mode:'open'});
    assert.throws(()=>new compatible.RequestLifecycle(gate,compatible.readHttpAdmission).admission(),compatible.MaintenanceError);
  } finally {
    if (original === undefined) delete process.env.ZIMAGE_LIFECYCLE_ENABLED;
    else process.env.ZIMAGE_LIFECYCLE_ENABLED = original;
  }
});
