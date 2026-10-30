import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runProcess, runRelease as executeRelease, startVerifier, TARGET } from './release.mjs';

// Every backend test uses an explicit fixture environment. Never inspect a
// developer's real authorization cookie while running this suite.
const fixtureEnvironment = { ZIMAGE_AUTH_COOKIE: 'sb-fixture-auth-token=fixture-only' };
const runRelease = (args, options = {}) => executeRelease(args, {
  environment: fixtureEnvironment,
  verifierFactory: async () => ({ verify: async () => { throw Error('Unexpected verification request in fixture'); }, close: async () => {} }),
  ...options,
});

const sha = value => createHash('sha256').update(value).digest('hex');
const response = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const source = '1'.repeat(40), previous = '2'.repeat(40);
async function fixture(t) {
  const folder = await realpath(await mkdtemp(resolve(tmpdir(), 'zimage-cli-fixture-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const output = resolve(folder, 'frontend with `literal` $(literal).tgz');
  const artifactId = 'a'.repeat(64), assetNamespace = 'fixture-ns';
  const manifestPath = output + '.manifest.json';
  const manifest = JSON.stringify({ assetNamespace, artifactId });
  await writeFile(output, 'safe local fixture bytes');
  await writeFile(manifestPath, manifest);
  const report = { schemaVersion: 1, productionReady: false, archive: output, manifestPath,
    archiveSha256: sha('safe local fixture bytes'), manifestSha256: sha(manifest), artifactId, assetNamespace };
  const args = ['frontend', 'deploy', '--dist', resolve(folder, 'dist'), '--output', output, '--options', resolve(folder, 'options.json'),
    '--public-config', resolve(folder, 'public.json'), '--evidence', resolve(folder, 'evidence.json'), '--operation', 'op1', '--expected-current', 'none', '--state-dir', resolve(folder, 'state')];
  const calls = [];
  const runner = async (command, argv, options) => {
    calls.push({ command, args: argv, input: options?.input });
    if (argv[0]?.endsWith('/frontend/package.mjs')) return response(report);
    if (argv[0]?.endsWith('/frontend/transport.mjs')) {
      if (argv[1] === 'request') return response({ schemaVersion: 1, assetNamespace, artifactId, manifestSha256: report.manifestSha256, objects: [{ sha256: 'b'.repeat(64), bytes: 42 }] });
      const delta = argv[argv.indexOf('--output') + 1];
      await writeFile(delta, 'missing blob fixture');
      return response({ schemaVersion: 1, productionReady: false, archive: delta, archiveSha256: sha('missing blob fixture'), archiveBytes: 20,
        assetNamespace, artifactId, manifestSha256: report.manifestSha256, uploadBlobBytes: 42, reusedBlobBytes: 0, uploadBlobCount: 1, reusedBlobCount: 0 });
    }
    if (command === 'scp') return response({});
    if (command === 'ssh' && argv.at(-1) === 'status') return response(argv.includes(TARGET.backend)
      ? { current: previous, frontend: artifactId, lifecycle: { schemaVersion: 1, backendRelease: previous, pid: 42 } }
      : { schemaVersion: 1, current: null, previous: null, artifactId: null, backendRelease: null, httpVerified: true, operations: [] });
    if (command === 'ssh' && argv.includes('inventory')) return response({ ...JSON.parse(options.input), found: [] });
    if (command === 'ssh') return response({ schemaVersion: 1, success: true, state: 'committed', operationId: argv.at(-3) === 'roll1' ? 'roll1' : 'op1', newFrontend: argv.includes('rollback') ? argv.at(-1) : assetNamespace });
    throw Error('Unexpected fixture command');
  };
  return { folder, output, report, args, calls, runner, state: resolve(folder, 'state/frontend-op1.json') };
}

test('frontend deploy packs, rehashes, uploads fixed incoming, then invokes the exact fixed helper', async t => {
  const f = await fixture(t);
  const result = await runRelease([...f.args, '--env', 'production'], { runner: f.runner });
  assert.equal(result.success, true);
  assert.deepEqual(f.calls.map(call => call.command), [process.execPath, process.execPath, 'ssh', process.execPath, 'scp', 'ssh']);
  const upload = f.calls[4];
  assert.equal(upload.args.at(-3), '--');
  assert.equal(upload.args.at(-2).endsWith('/delta.tgz'), true);
  assert.equal(upload.args.at(-1), 'aliyun-lian:/opt/zimage/incoming/frontend-op1.tgz');
  const inventory = f.calls[2];
  assert.equal(JSON.parse(inventory.input).artifactId, f.report.artifactId);
  assert.deepEqual(inventory.args.slice(inventory.args.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET.frontend, 'inventory', 'op1']);
  const remote = f.calls[5].args;
  assert.deepEqual(remote.slice(remote.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET.frontend, 'deploy', 'op1', 'fixture-ns', sha('missing blob fixture'), f.report.manifestSha256, 'none']);
  assert.equal(f.calls.some(call => /systemctl|sudo/.test(call.args.join(' '))), false);
  assert.equal((await readFile(f.state, 'utf8')).includes('succeeded'), true);
  const count = f.calls.length;
  assert.equal((await runRelease(f.args, { runner: f.runner })).replayed, true);
  assert.equal(f.calls.length, count, 'confirmed operation replay must not send another transport');
});

test('strict production/operation/scope parsing rejects before any command runs', async t => {
  const f = await fixture(t);
  for (const args of [['pair', 'deploy'], ['backend', 'build'], ['frontend', 'status', '--env', 'staging'],
    ['status', '--host', 'evil'], ['frontend', 'rollback', '--operation', 'x;id', '--expected-current', 'ns', '--target', 'old'],
    ['frontend', 'status', '--env', 'production', '--env', 'production'], ['frontend', 'deploy', '--operation', 'op']]) {
    await assert.rejects(runRelease(args, { runner: f.runner }));
  }
  assert.equal(f.calls.length, 0);
});

test('checksum mismatches and upload failures never invoke an activation helper', async t => {
  const f = await fixture(t);
  await writeFile(f.output, 'changed after packaging');
  await assert.rejects(runRelease(f.args, { runner: f.runner }), /changed after packaging/);
  assert.deepEqual(f.calls.map(call => call.command), [process.execPath]);
  await writeFile(f.output, 'safe local fixture bytes');
  f.calls.length = 0;
  const runner = async (command, args, options) => command === 'scp' ? (f.calls.push({ command, args }), { code: 1, stdout: '', stderr: 'fixture upload failure' }) : f.runner(command, args, options);
  await assert.rejects(runRelease(f.args, { runner }), error => error.outcome === 'not-executed');
  assert.deepEqual(f.calls.map(call => call.command), [process.execPath, process.execPath, 'ssh', process.execPath, 'scp']);
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).phase, 'upload-failed');
});

test('operation input drift is rejected and a remote uncertain result is checked before explicit reconciliation', async t => {
  const f = await fixture(t);
  let fail = true;
  const runner = async (command, args, options) => {
    if (command === 'ssh' && args.includes('deploy') && fail) { f.calls.push({ command, args }); throw Error('Disconnected; remote outcome unknown'); }
    return f.runner(command, args, options);
  };
  await assert.rejects(runRelease(f.args, { runner }));
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).phase, 'uncertain');
  const changed = [...f.args]; changed[changed.indexOf('--expected-current') + 1] = 'different';
  await assert.rejects(runRelease(changed, { runner }), /bound to different inputs/);
  const before = f.calls.length;
  fail = false;
  assert.equal((await runRelease(f.args, { runner })).success, true);
  assert.deepEqual(f.calls.slice(before).map(call => [call.command, call.args.at(-1)]), [['ssh', 'status'], ['ssh', 'none']]);
});

test('frontend rollback and both status commands use fixed helpers without pack/upload', async t => {
  const f = await fixture(t);
  await runRelease(['frontend', 'rollback', '--operation', 'roll1', '--expected-current', 'ns-new', '--target', 'ns-old', '--state-dir', resolve(f.folder, 'rollback-state')], { runner: f.runner });
  const call = f.calls[0];
  assert.equal(call.command, 'ssh');
  assert.deepEqual(call.args.slice(call.args.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET.frontend, 'rollback', 'roll1', 'ns-new', 'ns-old']);
  const all = await runRelease(['status', '--env', 'production'], { runner: f.runner });
  assert.equal(all.success, true);
  assert.equal(all.partial, false);
  assert.equal(f.calls.filter(item => item.command !== 'ssh').length, 0);
  const partial = await runRelease(['status'], { runner: async (command, args) => args.includes(TARGET.backend) ? { code: 1, stdout: '', stderr: 'secret fixture must not appear' } : f.runner(command, args) });
  assert.equal(partial.success, false);
  assert.equal(partial.partial, true);
  assert.equal(JSON.stringify(partial).includes('secret fixture'), false);
  const invalid = await runRelease(['status'], { runner: async () => response({}) });
  assert.equal(invalid.success, false);
  assert.equal(invalid.partial, false);
});

test('forged inventory and unconfirmed helper results fail closed without automatic retries', async t => {
  const f = await fixture(t);
  const forged = async (command, args, options) => command === 'ssh' && args.includes('inventory')
    ? response({ ...JSON.parse(options.input), artifactId: 'c'.repeat(64), found: [] }) : f.runner(command, args, options);
  await assert.rejects(runRelease(f.args, { runner: forged }), /inventory response differs/);
  assert.equal(f.calls.some(call => call.command === 'scp'), false);
  assert.equal(f.calls.some(call => call.args.includes('deploy')), false);
  let attempts = 0;
  const wrongOperation = async (command, args, options) => {
    if (command === 'ssh' && args.includes('deploy')) { attempts++; return response({ success: true, state: 'committed', operationId: 'different', newFrontend: 'fixture-ns' }); }
    return f.runner(command, args, options);
  };
  await assert.rejects(runRelease(f.args, { runner: wrongOperation }), /exact committed operation/);
  assert.equal(attempts, 1);
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).phase, 'uncertain');
});

test('a confirmed failed-and-recovered operation remains a failure and preserves the exact result', async t => {
  const f = await fixture(t);
  let attempts = 0;
  const runner = async (command, args, options) => {
    if (command === 'ssh' && args.includes('deploy')) { attempts++; return { code: 1, stderr: '', stdout: JSON.stringify({ operationId: 'op1', success: false, state: 'recovered', oldFrontend: null, newFrontend: 'fixture-ns' }) }; }
    return f.runner(command, args, options);
  };
  await assert.rejects(runRelease(f.args, { runner }), error => error.outcome === 'recovered');
  const state = JSON.parse(await readFile(f.state, 'utf8'));
  assert.equal(state.phase, 'rejected');
  assert.equal(state.result.state, 'recovered');
  await assert.rejects(runRelease(f.args, { runner }), /already failed/);
  assert.equal(attempts, 1);
});

test('a concurrent local operation cannot overwrite state or issue a second transport', async t => {
  const f = await fixture(t);
  let started, release;
  const starting = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const first = runRelease(f.args, { runner: async (command, args, options) => {
    if (args[0]?.endsWith('/frontend/package.mjs')) { started(); await blocked; }
    return f.runner(command, args, options);
  } });
  await starting;
  await assert.rejects(runRelease(f.args, { runner: f.runner }), /already running/);
  release();
  assert.equal((await first).success, true);
  assert.equal(f.calls.filter(call => call.command === 'scp').length, 1);
});

test('backend validates Linux manifest and existing transport parser before uploading the artifact', async t => {
  const f = await fixture(t);
  const artifact = resolve(f.folder, 'backend.layers.tgz'), manifestPath = resolve(f.folder, 'backend-manifest.json');
  const manifest = { releaseId: source, runtime: { platform: 'linux', libc: 'glibc-2.35' } };
  await writeFile(artifact, 'backend artifact fixture');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const args = ['backend', 'deploy', '--artifact', artifact, '--manifest', manifestPath, '--sha', source, '--archive-sha256', sha('backend artifact fixture'), '--manifest-sha256', sha(JSON.stringify(manifest)), '--run-number', '123', '--expected-current', previous, '--operation', 'backend-op', '--state-dir', resolve(f.folder, 'backend-state')];
  const runner = async (command, argv) => {
    f.calls.push({ command, args: argv });
    if (command === 'python3') return response({ manifest, productionReady: false });
    if (command === 'scp') return response({});
    return response({ backendJournal: { phase: 'committed', operationId: 'backend-op', target: source, writesOpened: true }, productionReady: false, activatedLocally: true });
  };
  assert.equal((await runRelease(args, { runner })).activatedLocally, true);
  assert.equal(f.calls[0].command, 'python3');
  assert.deepEqual(f.calls[0].args.slice(0, 3), ['-I', '-B', '-c']);
  assert.deepEqual(f.calls[0].args.slice(-4), [resolve('ops/aliyun/release-transport.py'), artifact, source, sha(JSON.stringify(manifest))]);
  assert.equal(f.calls[1].args.at(-1), `aliyun-lian:/opt/zimage/incoming/${source}.layers.tgz`);
  const call = f.calls[2];
  assert.deepEqual(call.args.slice(call.args.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET.backend, 'deploy', source, sha('backend artifact fixture'), sha(JSON.stringify(manifest)), '123', previous, 'backend-op']);
  manifest.runtime.platform = 'darwin';
  await writeFile(manifestPath, JSON.stringify(manifest));
  const macArgs = [...args]; macArgs[macArgs.indexOf('--manifest-sha256') + 1] = sha(JSON.stringify(manifest)); macArgs[macArgs.indexOf('--operation') + 1] = 'mac-refused';
  const count = f.calls.length;
  await assert.rejects(runRelease(macArgs, { runner }), /Linux glibc/);
  assert.equal(f.calls.length, count, 'Mac manifest cannot reach Python or SSH');
});

test('backend rollback never calls the old activation helper or bypasses the transaction result', async t => {
  const f = await fixture(t);
  const args = ['backend', 'rollback', '--target', previous, '--expected-current', source, '--operation', 'backend-roll', '--state-dir', resolve(f.folder, 'backend-roll-state')];
  const result = await runRelease(args, { runner: async (command, argv) => { f.calls.push({ command, args: argv }); return response({ phase: 'committed', writesOpened: true, operationId: 'backend-roll', target: previous }); } });
  assert.equal(result.writesOpened, true);
  const remote = f.calls[0].args;
  assert.deepEqual(remote.slice(remote.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET.backend, 'rollback', previous, source, 'backend-roll']);
  assert.equal(f.calls.length, 1);
});

test('an uncertain backend transaction is observed through its exact live journal and never replayed', async t => {
  const f = await fixture(t);
  const artifact = resolve(f.folder, 'backend-uncertain.layers.tgz'), manifestPath = resolve(f.folder, 'backend-uncertain-manifest.json');
  const manifest = { releaseId: source, runtime: { platform: 'linux', libc: 'glibc-2.35' } };
  await writeFile(artifact, 'backend fixture'); await writeFile(manifestPath, JSON.stringify(manifest));
  const args = ['backend', 'deploy', '--artifact', artifact, '--manifest', manifestPath, '--sha', source,
    '--archive-sha256', sha('backend fixture'), '--manifest-sha256', sha(JSON.stringify(manifest)), '--run-number', '124',
    '--expected-current', previous, '--operation', 'backend-uncertain', '--state-dir', resolve(f.folder, 'uncertain-backend-state')];
  const record = { operationId: 'backend-uncertain', old: previous, target: source, phase: 'committed', writesOpened: true,
    frontend: 'a'.repeat(64), candidatePid: 42 };
  let activations = 0, observations = 0;
  const runner = async (command, argv) => {
    if (command === 'python3') return response({ manifest, productionReady: false });
    if (command === 'scp') return response({});
    if (argv.at(-1) === 'status') { observations++; return response({ current: source, frontend: record.frontend, lifecycle: { schemaVersion: 1, backendRelease: source, pid: 42 }, journal: record }); }
    activations++; throw Error('SSH response lost after the transaction committed');
  };
  await assert.rejects(runRelease(args, { runner }));
  const reconciled = await runRelease(args, { runner });
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.backendJournal.phase, 'committed');
  assert.equal(activations, 1);
  assert.equal(observations, 1);
});

test('backend authorization is checked before any file preparation, upload or service mutation', async t => {
  const f = await fixture(t);
  const args = ['backend', 'rollback', '--target', previous, '--expected-current', source, '--operation', 'receipt-op', '--state-dir', resolve(f.folder, 'no-auth-state')];
  for (const cookie of [undefined, '', ' ', 'fixture=one\r\nInjected: invalid']) {
    await assert.rejects(runRelease(args, { runner: f.runner, environment: { ZIMAGE_AUTH_COOKIE: cookie } }), /existing authorized ZIMAGE_AUTH_COOKIE/);
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(readFile(resolve(f.folder, 'no-auth-state/backend-receipt-op.json')), error => error.code === 'ENOENT');
});

test('the fixed stdio verifier becomes ready once and rejects invalid local requests before any HTTP fetch', async t => {
  // verify.py rejects these missing fields before calling its fetch function.
  // The cookie is a fixture; no authorized user cookie or network is used.
  const verifier = await startVerifier({ python: 'python3', cookie: fixtureEnvironment.ZIMAGE_AUTH_COOKIE });
  t.after(() => verifier.close());
  assert.deepEqual(JSON.parse(await verifier.verify('{}')), { schemaVersion: 1, verificationFailed: true });
  assert.deepEqual(JSON.parse(await verifier.verify('{}\n')), { schemaVersion: 1, verificationFailed: true });
  await verifier.close();
});

test('a local verifier readiness failure prevents every backend transport command', async t => {
  const f = await fixture(t);
  const args = ['backend', 'rollback', '--target', previous, '--expected-current', source, '--operation', 'not-ready', '--state-dir', resolve(f.folder, 'not-ready-state')];
  await assert.rejects(runRelease(args, { runner: f.runner, verifierFactory: async () => { throw Error('Fixture verifier not ready'); } }));
  assert.equal(f.calls.length, 0);
});

const receiptPaths = ['/api/health/ready', '/api/meta', '/api/auth/session', '/api/account', '/api/sessions', '/api/credits/pricing'];
function fixtureReceipt(request, checkedAt) {
  return { schemaVersion: 1, verifierProtocol: 'zimage-backend-readonly-v2', operationId: request.operationId,
    backendRelease: request.backendRelease, pid: request.pid, nonce: request.nonce, requestSha256: 'd'.repeat(64), checkedAt,
    checks: receiptPaths.map((path, index) => ({ path, status: 200, noStore: true, authenticated: index >= 2 })),
    authenticatedReadOnly: true, independentPublic: true, catalogReady: true };
}

test('backend rejects old protocols, wallet or ledger evidence, and broader dependency claims before receipt upload', async t => {
  const f = await fixture(t);
  const invalid = [
    ['old-protocol', receipt => { receipt.verifierProtocol = 'zimage-backend-readonly-v1'; }],
    ['wallet-path', receipt => { receipt.checks.at(-1).path = '/api/credits'; }],
    ['ledger-path', receipt => { receipt.checks.at(-1).path = '/api/credits/ledger'; }],
    ['broad-claim', receipt => { receipt.dependenciesReady = true; delete receipt.catalogReady; }],
    ['extra-claim', receipt => { receipt.dependenciesReady = true; }],
    ['false-catalog', receipt => { receipt.catalogReady = false; }],
    ['coerced-catalog', receipt => { receipt.catalogReady = 1; }],
  ];
  for (const [label, mutate] of invalid) {
    let finish, polls = 0, verifications = 0, uploads = 0, accepts = 0;
    const operation = `reject-${label}`, stateDir = resolve(f.folder, operation);
    const request = { schemaVersion: 1, operationId: operation, backendRelease: previous, pid: 99,
      nonce: 'f'.repeat(64), createdAt: 1800000000, expiresAt: 1800000120 };
    const args = ['backend', 'rollback', '--target', previous, '--expected-current', source,
      '--operation', operation, '--state-dir', stateDir];
    await assert.rejects(runRelease(args, { now: () => 1800000001, pause: async () => {},
      verifierFactory: async () => ({ close: async () => {}, verify: async raw => {
        verifications++;
        const receipt = fixtureReceipt(JSON.parse(raw), 1800000001);
        mutate(receipt);
        return JSON.stringify(receipt);
      } }),
      runner: async (command, argv) => {
        if (command === 'ssh' && argv.includes('rollback')) return new Promise(resolve => { finish = resolve; });
        if (command === 'ssh' && argv.at(-1) === 'verification-request') {
          if (++polls === 2) {
            finish({ code: 1, stdout: '', stderr: 'fixture rejected receipt' });
            return response({});
          }
          return response(request);
        }
        if (command === 'scp') uploads++;
        if (command === 'ssh' && argv.includes('accept-receipt')) accepts++;
        throw Error('Rejected receipt reached transport');
      },
    }), error => error.outcome === 'uncertain', label);
    assert.equal(verifications, 1, label);
    assert.equal(uploads, 0, label);
    assert.equal(accepts, 0, label);
    const state = JSON.parse(await readFile(resolve(stateDir, `backend-${operation}.json`), 'utf8'));
    assert.deepEqual(state.receiptEvents.map(event => event.phase), ['failed'], label);
  }
});

test('backend waits for a fresh matching challenge, runs the local GET verifier, then uploads and accepts its exact receipt', async t => {
  const f = await fixture(t);
  let clock = 1800000001, finish, polls = 0;
  const request = { schemaVersion: 1, operationId: 'receipt-op', backendRelease: previous, pid: 99, nonce: 'f'.repeat(64), createdAt: 1800000000, expiresAt: 1800000120 };
  const rawRequest = JSON.stringify(request).replace('"createdAt":1800000000', '"createdAt":1800000000.0');
  const args = ['backend', 'rollback', '--target', previous, '--expected-current', source, '--operation', 'receipt-op', '--state-dir', resolve(f.folder, 'receipt-state')];
  const calls = [];
  let receipt, receiptBytes, verifierRequests = 0, verifierClosed = false;
  const result = await runRelease(args, { now: () => clock, pause: async () => { clock += 0.1; }, verifierFactory: async ({ cookie, python }) => {
    assert.equal(cookie, fixtureEnvironment.ZIMAGE_AUTH_COOKIE); assert.equal(python, 'python3');
    return { close: async () => { verifierClosed = true; }, verify: async raw => {
      verifierRequests++;
      assert.equal(raw, rawRequest);
      const requestPath = resolve(f.folder, 'pure-request.json'), output = resolve(f.folder, 'pure-receipt.json');
      await writeFile(requestPath, raw);
      // Invoke only the verifier's pure Python API with local GET fixtures;
      // never execute its network CLI or consume a real authorization cookie.
      const generated = await runProcess('python3', ['-I', '-B', '-c', `import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('receipt_fixture_verify',sys.argv[1]);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
r=json.loads(Path(sys.argv[2]).read_text());owner='10000000-0000-4000-8000-000000000001'
bodies={'/api/health/ready':{'status':'ok','version':r['backendRelease']},'/api/meta':{'schemaVersion':1,'backendRelease':r['backendRelease'],'api':{'major':1,'minor':0},'capabilities':[]},'/api/auth/session':{'id':owner},'/api/account':{'id':owner,'email':'fixture@example.test','displayName':None,'status':'active'},'/api/sessions':{'sessions':[]},'/api/credits/pricing':{'version':'fixture-catalog','enabled':False,'prices':[{'operation':'chat','provider':'doubao','model':'doubao','resolution':'','unitMinor':2,'label':'Fixture price'}]}}
receipt=v.verify(r,lambda path:(200,{'cache-control':'private, no-store',**({'x-zimage-readonly-probe':'catalog-v1'} if path=='/api/credits/pricing' else {})},bodies[path]),now=lambda:float(sys.argv[4]))
Path(sys.argv[3]).write_text(json.dumps(receipt));print('Fixture GET-only receipt written')
`, resolve('ops/aliyun/backend/verify.py'), requestPath, output, String(clock)]);
      assert.equal(generated.code, 0, generated.stderr);
      const rawReceipt = await readFile(output, 'utf8'); receiptBytes = rawReceipt; receipt = JSON.parse(rawReceipt); return rawReceipt;
    } };
  }, runner: async (command, argv) => {
    calls.push({ command, args: argv });
    assert.equal(argv.some(value => value.includes(fixtureEnvironment.ZIMAGE_AUTH_COOKIE)), false);
    if (command === 'ssh' && argv.includes('rollback')) return new Promise(resolve => { finish = resolve; });
    if (command === 'ssh' && argv.at(-1) === 'verification-request') {
      polls++;
      if (polls === 1) return response({ ...request, operationId: 'stale-other-operation' });
      if (polls === 2) return response({ ...request, backendRelease: '3'.repeat(40) });
      if (polls === 3) return response({ ...request, createdAt: clock - 200, expiresAt: clock - 100 });
      return { code: 0, stderr: '', stdout: rawRequest };
    }
    if (command === 'scp') { assert.equal(argv.at(-1), 'aliyun-lian:/opt/zimage/incoming/backend-readonly-receipt.json'); return response({}); }
    if (command === 'ssh' && argv.includes('accept-receipt')) {
      assert.deepEqual(argv.slice(-5, -1), ['accept-receipt', 'receipt-op', previous, '99']);
      assert.equal(argv.at(-1), sha(receiptBytes + '\n'));
      finish(response({ phase: 'committed', operationId: 'receipt-op', target: previous, writesOpened: true }));
      return response({ schemaVersion: 1, accepted: true, operationId: 'receipt-op', backendRelease: previous, pid: 99, requestSha256: receipt.requestSha256 });
    }
    throw Error('Unexpected receipt fixture command');
  } });
  assert.equal(result.phase, 'committed');
  assert.equal(verifierRequests, 1);
  assert.equal(verifierClosed, true);
  assert.equal(polls, 4);
  assert.equal(receipt.verifierProtocol, 'zimage-backend-readonly-v2');
  assert.equal(receipt.catalogReady, true);
  assert.equal('dependenciesReady' in receipt, false);
  assert.deepEqual(receipt.checks.map(check => check.path), receiptPaths);
  const state = JSON.parse(await readFile(resolve(f.folder, 'receipt-state/backend-receipt-op.json'), 'utf8'));
  assert.equal(state.receiptEvents.at(-1).phase, 'accepted');
  assert.equal(JSON.stringify(state).includes(fixtureEnvironment.ZIMAGE_AUTH_COOKIE), false);
  assert.equal(JSON.stringify(state).includes('fixture@example.test'), false);
});

test('a failed candidate verifier can service a fresh recovery challenge without claiming the release succeeded', async t => {
  const f = await fixture(t);
  let clock = 1800000001, finish, candidate = true, receipt;
  const base = { schemaVersion: 1, operationId: 'recovery-op', pid: 99, createdAt: 1800000000, expiresAt: 1800000120 };
  const args = ['backend', 'rollback', '--target', previous, '--expected-current', source, '--operation', 'recovery-op', '--state-dir', resolve(f.folder, 'recovery-state')];
  let activationCalls = 0, receiptUploads = 0;
  let factories = 0;
  await assert.rejects(runRelease(args, { now: () => clock, pause: async () => { clock += 0.1; }, verifierFactory: async () => {
    factories++;
    return { close: async () => {}, verify: async raw => {
      if (candidate) { candidate = false; return JSON.stringify({ schemaVersion: 1, verificationFailed: true }); }
      receipt = fixtureReceipt(JSON.parse(raw), clock); return JSON.stringify(receipt);
    } };
  }, runner: async (command, argv) => {
    if (command === 'ssh' && argv.includes('rollback')) { activationCalls++; return new Promise(resolve => { finish = resolve; }); }
    if (command === 'ssh' && argv.at(-1) === 'verification-request') return response({ ...base, backendRelease: candidate ? previous : source, nonce: (candidate ? 'a' : 'b').repeat(64) });
    if (command === 'scp') { receiptUploads++; return response({}); }
    if (command === 'ssh' && argv.includes('accept-receipt')) {
      assert.equal(argv.at(-3), source, 'only the captured old release may be accepted for recovery');
      assert.equal(argv.at(-1), sha(JSON.stringify(receipt) + '\n'));
      finish({ code: 1, stdout: '', stderr: 'fixture release failed after exact recovery' });
      return response({ schemaVersion: 1, accepted: true, operationId: 'recovery-op', backendRelease: source, pid: 99, requestSha256: receipt.requestSha256 });
    }
    throw Error('Unexpected recovery fixture command');
  } }), error => error.outcome === 'uncertain');
  assert.equal(activationCalls, 1);
  assert.equal(factories, 1, 'candidate and recovery retain one in-memory verifier session');
  assert.equal(receiptUploads, 1);
  const state = JSON.parse(await readFile(resolve(f.folder, 'recovery-state/backend-recovery-op.json'), 'utf8'));
  assert.equal(state.phase, 'uncertain');
  assert.deepEqual(state.receiptEvents.map(event => [event.phase, event.backendRelease]), [['failed', previous], ['accepted', source]]);
});

test('actual local process runner passes shell punctuation and bounded stdin literally', async () => {
  const literal = '$(echo unsafe) `echo unsafe`; literal';
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv[1]))', literal]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout), literal);
  const stdin = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: literal });
  assert.equal(stdin.stdout, literal);
  await assert.rejects(runProcess(process.execPath, ['-e', ''], { input: 'x'.repeat(4 * 1024 * 1024 + 1) }), /exceeds its bound/);
  await assert.rejects(runProcess(process.execPath, ['-e', ''], { environment: fixtureEnvironment }), /reserved for the fixed local verifier/);
  const isolated = spawnSync(process.execPath, ['--input-type=module', '-e', `import {runProcess} from ${JSON.stringify(new URL('./release.mjs', import.meta.url).href)};const result=await runProcess(process.execPath,['-e','process.stdout.write(Object.keys(process.env).some(key=>key.toUpperCase()==="ZIMAGE_AUTH_COOKIE")?"unexpected":"stripped")']);process.stdout.write(result.stdout);`], { encoding: 'utf8', env: { ZIMAGE_AUTH_COOKIE: 'fixture-only', Zimage_Auth_Cookie: 'mixed-case-fixture-only' } });
  assert.equal(isolated.stdout, 'stripped');
});

test('a real backend transport roundtrip validates synthetic Linux metadata without reaching any remote service', async t => {
  const f = await fixture(t);
  const setup = await runProcess('python3', ['-I', '-B', '-c', `import importlib.util,json,shutil,sys,tempfile
from pathlib import Path
tempfile.tempdir=sys.argv[2]
spec=importlib.util.spec_from_file_location('cli_transport_fixture',Path(sys.argv[1])/'ops/aliyun/test_release_transport.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture=m.Transport();fixture.setUp()
try:
 bundle=fixture.bundle();out=Path(sys.argv[2]);archive=out/'actual-backend.layers.tgz';manifest=out/'actual-manifest.json'
 shutil.copyfile(bundle['bundle'],archive);shutil.copyfile(fixture.manifest_path,manifest)
 print(json.dumps({'archive':str(archive),'manifest':str(manifest),'archiveSha256':bundle['outerSha256'],'manifestSha256':fixture.sha}))
finally:fixture.doCleanups()
`, resolve('.'), f.folder]);
  assert.equal(setup.code, 0, setup.stderr);
  const data = JSON.parse(setup.stdout);
  const args = ['backend', 'deploy', '--artifact', data.archive, '--manifest', data.manifest, '--sha', source,
    '--archive-sha256', data.archiveSha256, '--manifest-sha256', data.manifestSha256, '--run-number', '9',
    '--expected-current', previous, '--operation', 'real-transport', '--state-dir', resolve(f.folder, 'real-transport-state')];
  const calls = [];
  const result = await runRelease(args, { runner: async (command, argv) => {
    calls.push(command);
    if (command === 'python3') { const checked = await runProcess(command, argv); assert.equal(checked.code, 0, checked.stderr); return checked; }
    if (command === 'scp') return response({});
    return response({ backendJournal: { phase: 'committed', writesOpened: true, target: source, operationId: 'real-transport' } });
  } });
  assert.equal(result.backendJournal.phase, 'committed');
  assert.deepEqual(calls, ['python3', 'scp', 'ssh']);
  // A second local archive with the same external manifest must pass the real
  // bounded tar parser before any mocked transport may be reached.
  await writeFile(data.archive, 'invalid gzip');
  const changed = [...args]; changed[changed.indexOf('--operation') + 1] = 'bad-transport';
  changed[changed.indexOf('--archive-sha256') + 1] = sha('invalid gzip');
  calls.length = 0;
  await assert.rejects(runRelease(changed, { runner: async (command, argv) => {
    calls.push(command); assert.equal(command, 'python3'); return runProcess(command, argv);
  } }), /transport verification/);
  assert.deepEqual(calls, ['python3']);
});

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const requestSha = value => sha(JSON.stringify(canonical(value)) + '\n');
async function firstWindowFixture(t) {
  const f = await fixture(t);
  const artifact = resolve(f.folder, 'first-window.layers.tgz'), manifestPath = resolve(f.folder, 'first-window-manifest.json');
  const manifest = { releaseId: source, runtime: { platform: 'linux', libc: 'glibc-2.35' } };
  await writeFile(artifact, 'first-window artifact fixture'); await writeFile(manifestPath, JSON.stringify(manifest));
  const oldProcess = { pid: 99, startTicks: 123456, bootId: '10000000-0000-4000-8000-000000000001' };
  const candidateProcess = { ...oldProcess, pid: 100, startTicks: 123500 };
  const recoveryProcess = { ...oldProcess, pid: 101, startTicks: 123600 };
  const operation = 'first-window-op', policySha256 = 'b'.repeat(64), completionSha256 = 'c'.repeat(64);
  const status = { schemaVersion: 1, kind: 'first-window', current: previous, frontend: null,
    legacyProcess: oldProcess, currentProcess: oldProcess, operationId: operation, target: source,
    policySha256, completionSha256, candidateManifestSha256: sha(JSON.stringify(manifest)), preflight: 'reviewed-sealed', journal: null };
  const record = { schemaVersion: 1, kind: 'first-window', operationId: operation, sequence: 1,
    old: previous, target: source, oldPid: oldProcess.pid, oldProcess, frontend: 'a'.repeat(64),
    writesOpened: false, policySha256, completionSha256, phase: 'backend_ready', candidatePid: candidateProcess.pid, candidateProcess };
  const completed = { ...status, current: source, currentProcess: candidateProcess, preflight: 'journal-sealed', journal: record };
  const recoveredRecord = { ...record, phase: 'recovered', recoveryPid: recoveryProcess.pid, recoveryProcess };
  const recovered = { ...completed, current: previous, currentProcess: recoveryProcess, journal: recoveredRecord };
  const shared = ['--expected-current', previous, '--operation', operation, '--policy-sha256', policySha256,
    '--completion-sha256', completionSha256, '--state-dir', resolve(f.folder, 'first-window-state')];
  const args = ['first-window', 'run', '--artifact', artifact, '--manifest', manifestPath, '--sha', source,
    '--archive-sha256', sha('first-window artifact fixture'), '--manifest-sha256', sha(JSON.stringify(manifest)), '--run-number', '125', ...shared];
  const recoverArgs = ['first-window', 'recover', '--target', source, ...shared];
  return { ...f, args, recoverArgs, manifest, oldProcess, candidateProcess, recoveryProcess, status, record, completed, recovered,
    state: resolve(f.folder, 'first-window-state', `first-window-${operation}-run.json`) };
}
function firstWindowReceipt(request, checkedAt) {
  if (!request.verifierProtocol) return { ...fixtureReceipt(request, checkedAt), requestSha256: requestSha(request) };
  return { schemaVersion: 1, verifierProtocol: 'zimage-legacy-readonly-v1', operationId: request.operationId,
    backendRelease: request.backendRelease, pid: request.pid, processStart: request.processStart, nonce: request.nonce,
    requestSha256: requestSha(request), checkedAt,
    checks: ['/api/health/ready', '/api/account', '/api/sessions'].map((path, index) => ({ path, status: 200, noStore: true, authenticated: index > 0 })),
    authenticatedReadOnly: true, independentPublic: true };
}

test('dedicated first-window status accepts genuinely absent frontend and legacy process without weakening generic backend status', async t => {
  const f = await firstWindowFixture(t);
  const calls = [];
  const runner = async (command, args) => { calls.push({ command, args }); return response(f.status); };
  assert.deepEqual(await runRelease(['first-window', 'status'], { runner, environment: {} }), f.status);
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET['first-window'], 'status']);
  await assert.rejects(runRelease(['backend', 'status'], { runner }), /Backend status schema/);
  assert.equal(calls.every(call => call.command === 'ssh'), true);
  for (const mutate of [value => { value.frontend = 'a'.repeat(64); }, value => { value.currentProcess = null; },
    value => { value.preflight = 'approved'; }, value => { value.legacyProcess = { pid: 99 }; }, value => { value.meta = {}; }]) {
    const value = structuredClone(f.status); mutate(value);
    await assert.rejects(runRelease(['first-window', 'status'], { runner: async () => response(value) }), /First-window status schema/);
  }
});

test('first-window rejects arbitrary flags, missing authorization and unapproved root evidence before upload or activation', async t => {
  const f = await firstWindowFixture(t);
  let commands = 0, factories = 0;
  const runner = async () => { commands++; return response(f.status); };
  for (const flags of [['--host', 'evil'], ['--helper', '/tmp/release.py'], ['--force', 'true'], ['--skip-approval', 'true'],
    ['--receipt', '/tmp/proof.json'], ['--remote-path', '/tmp/upload'], ['--allow-legacy', 'true'], ['--env', 'staging']]) {
    await assert.rejects(runRelease([...f.args, ...flags], { runner }));
  }
  const noPolicy = f.args.filter((_, index) => index !== f.args.indexOf('--policy-sha256') && index !== f.args.indexOf('--policy-sha256') + 1);
  await assert.rejects(runRelease(noPolicy, { runner }));
  await assert.rejects(runRelease(f.args, { runner, environment: {} }), /existing authorized/);
  assert.equal(commands, 0);
  const factory = async () => { factories++; throw Error('Must never start for unapproved evidence'); };
  for (const value of [{}, { ...f.status, policySha256: 'd'.repeat(64) }, { ...f.status, completionSha256: 'd'.repeat(64) },
    { ...f.status, candidateManifestSha256: 'd'.repeat(64) }]) {
    await assert.rejects(runRelease(f.args, { runner: async (command, argv) => {
      assert.equal(command, 'ssh'); assert.equal(argv.at(-1), 'status'); return response(value);
    }, verifierFactory: factory }));
  }
  assert.equal(factories, 0);
});

test('first-window starts one isolated verifier, checks Linux closure and approved evidence, then accepts only the exact candidate v2 receipt', async t => {
  const f = await firstWindowFixture(t);
  let clock = 1800000001, finish, state = f.status, verifierClosed = false;
  const sequence = [];
  const challenge = { schemaVersion: 1, operationId: f.status.operationId, backendRelease: source, pid: 100,
    nonce: 'd'.repeat(64), createdAt: 1800000000, expiresAt: 1800000120 };
  const result = await runRelease(f.args, { now: () => clock, pause: async () => { clock += 0.1; },
    verifierFactory: async ({ cookie }) => {
      assert.equal(cookie, fixtureEnvironment.ZIMAGE_AUTH_COOKIE); sequence.push('verifier-ready');
      return { close: async () => { verifierClosed = true; }, verify: async raw => {
        sequence.push('verify-v2'); assert.deepEqual(JSON.parse(raw), challenge);
        return JSON.stringify(firstWindowReceipt(challenge, clock));
      } };
    }, runner: async (command, argv, options) => {
      f.calls.push({ command, args: argv, input: options?.input });
      assert.equal(JSON.stringify({ argv, options }).includes(fixtureEnvironment.ZIMAGE_AUTH_COOKIE), false);
      if (command === 'python3') { sequence.push('linux-closure'); return response({ manifest: f.manifest, productionReady: false }); }
      if (command === 'scp') {
        sequence.push(argv.at(-1).endsWith('.layers.tgz') ? 'artifact-upload' : 'receipt-upload');
        assert.equal(argv.at(-1), `aliyun-lian:/opt/zimage/incoming/${argv.at(-1).endsWith('.layers.tgz') ? source + '.layers.tgz' : 'backend-readonly-receipt.json'}`);
        return response({});
      }
      assert.equal(argv.includes(TARGET['first-window']), true);
      if (argv.at(-1) === 'status') { sequence.push('status'); return response(state); }
      if (argv.includes('run')) {
        sequence.push('run');
        assert.deepEqual(argv.slice(argv.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET['first-window'], 'run', source,
          f.args[f.args.indexOf('--archive-sha256') + 1], f.args[f.args.indexOf('--manifest-sha256') + 1], '125', previous, f.status.operationId,
          f.status.policySha256, f.status.completionSha256]);
        return new Promise(resolve => { finish = resolve; });
      }
      if (argv.at(-1) === 'verification-request') { sequence.push('challenge'); return response(challenge); }
      if (argv.includes('accept-receipt')) {
        sequence.push('accept'); state = f.completed;
        finish(response({ schemaVersion: 1, firstWindowJournal: f.record, productionReady: false }));
        return response({ schemaVersion: 1, accepted: true, operationId: challenge.operationId, backendRelease: source, pid: 100, requestSha256: requestSha(challenge) });
      }
      throw Error('Unexpected first-window fixture command');
    } });
  assert.deepEqual(sequence, ['status', 'verifier-ready', 'linux-closure', 'artifact-upload', 'run', 'challenge', 'verify-v2', 'receipt-upload', 'accept', 'status']);
  assert.equal(result.firstWindowJournal.phase, 'backend_ready'); assert.equal(result.productionReady, false); assert.equal(result.sealed, true);
  assert.equal(verifierClosed, true);
  const journal = await readFile(f.state, 'utf8');
  assert.equal(journal.includes(fixtureEnvironment.ZIMAGE_AUTH_COOKIE), false);
  assert.equal(journal.includes('fixture@example.test'), false);
  assert.equal(JSON.parse(journal).receiptEvents.at(-1).phase, 'accepted');
});

test('explicit first-window recovery uses only the separate legacy safe receipt and never asks B0 for meta, drain or credit routes', async t => {
  const f = await firstWindowFixture(t);
  let clock = 1800000001, finish, state = f.completed, factories = 0, receipt;
  const challenge = { schemaVersion: 1, verifierProtocol: 'zimage-legacy-readonly-v1', operationId: f.status.operationId,
    backendRelease: previous, pid: f.recoveryProcess.pid, processStart: f.recoveryProcess, nonce: 'e'.repeat(64), createdAt: 1800000000, expiresAt: 1800000120 };
  const result = await runRelease(f.recoverArgs, { now: () => clock, pause: async () => { clock += 0.1; },
    verifierFactory: async () => { factories++; return { close: async () => {}, verify: async raw => {
      assert.deepEqual(JSON.parse(raw), challenge); receipt = firstWindowReceipt(challenge, clock); return JSON.stringify(receipt);
    } }; }, runner: async (command, argv) => {
      f.calls.push({ command, args: argv });
      if (command === 'scp') { assert.equal(argv.at(-1), 'aliyun-lian:/opt/zimage/incoming/backend-readonly-receipt.json'); return response({}); }
      assert.equal(command, 'ssh');
      if (argv.at(-1) === 'status') return response(state);
      if (argv.includes('recover')) {
        assert.deepEqual(argv.slice(argv.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET['first-window'], 'recover', f.status.operationId,
          f.status.policySha256, f.status.completionSha256]);
        return new Promise(resolve => { finish = resolve; });
      }
      if (argv.at(-1) === 'verification-request') return response(challenge);
      if (argv.includes('accept-receipt')) {
        state = f.recovered; finish(response({ schemaVersion: 1, firstWindowJournal: state.journal, productionReady: false }));
        return response({ schemaVersion: 1, accepted: true, operationId: challenge.operationId, backendRelease: previous, pid: challenge.pid, requestSha256: requestSha(challenge) });
      }
      throw Error('Unexpected legacy fixture command');
    } });
  assert.equal(result.firstWindowJournal.phase, 'recovered'); assert.equal(result.sealed, true); assert.equal(result.productionReady, false);
  assert.equal(factories, 1);
  assert.deepEqual(receipt.checks.map(check => check.path), ['/api/health/ready', '/api/account', '/api/sessions']);
  assert.equal('catalogReady' in receipt, false);
  assert.equal(f.calls.some(call => call.command === 'python3' || call.args.includes('run')), false);
});

test('uncertain first-window run and upload outcomes reconcile read-only without replaying any mutation', async t => {
  for (const failedStage of ['run', 'upload']) {
    const f = await firstWindowFixture(t);
    let mutations = 0;
    const runner = async (command, argv) => {
      if (command === 'python3') return response({ manifest: f.manifest, productionReady: false });
      if (command === 'ssh' && argv.at(-1) === 'status') return response(f.status);
      mutations++;
      if (command === 'scp' && failedStage === 'run') return response({});
      throw Error('Fixture connection lost; outcome unknown');
    };
    await assert.rejects(runRelease(f.args, { runner }), error => error.outcome === 'uncertain');
    assert.equal(JSON.parse(await readFile(f.state, 'utf8')).phase, 'uncertain');
    const before = mutations;
    const readOnly = async (command, argv) => { assert.equal(command, 'ssh'); assert.equal(argv.at(-1), 'status'); return response(f.status); };
    await assert.rejects(runRelease(f.args, { runner: readOnly, verifierFactory: async () => { throw Error('Must not restart verifier during reconciliation'); } }), /no upload, run or recovery was replayed/);
    assert.equal(mutations, before);
    if (failedStage === 'run') {
      const result = await runRelease(f.args, { runner: async (command, argv) => { assert.equal(argv.at(-1), 'status'); return response(f.completed); } });
      assert.equal(result.reconciled, true); assert.equal(result.firstWindowJournal.phase, 'backend_ready');
    }
  }
});

test('first-window timeout aborts the local wait, preserves uncertainty and never auto recovers', async t => {
  const f = await firstWindowFixture(t);
  let clock = 1800000001, aborted = false, mutations = 0;
  await assert.rejects(runRelease(f.args, { now: () => clock, pause: async () => { clock += 901; }, runner: async (command, argv, options) => {
    if (command === 'python3') return response({ manifest: f.manifest, productionReady: false });
    if (command === 'scp') return response({});
    if (argv.at(-1) === 'status') return response(f.status);
    assert.equal(argv.includes('run'), true); mutations++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(Error('Fixture aborted local SSH')); }));
  } }), error => error.outcome === 'uncertain');
  assert.equal(aborted, true); assert.equal(mutations, 1);
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).phase, 'uncertain');
});

test('failed first-window candidate stays failed after exact sealed B0 recovery is observed', async t => {
  const f = await firstWindowFixture(t);
  await assert.rejects(runRelease(f.args, { runner: async (command, argv) => {
    if (command === 'python3') return response({ manifest: f.manifest, productionReady: false });
    if (command === 'scp') return response({});
    if (argv.at(-1) === 'status') return response(f.status);
    return { code: 1, stdout: '', stderr: 'Fixture candidate failed after sealed recovery' };
  } }), error => error.outcome === 'uncertain');
  await assert.rejects(runRelease(f.args, { runner: async (command, argv) => {
    assert.equal(command, 'ssh'); assert.equal(argv.at(-1), 'status'); return response(f.recovered);
  } }), error => error.outcome === 'recovered');
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).phase, 'rejected');
});

test('first-window rejects v2 evidence for B0, forged request digests, credit claims and altered legacy process identity', async t => {
  const invalid = [
    ['digest', receipt => { receipt.requestSha256 = 'f'.repeat(64); }],
    ['v2', receipt => { receipt.verifierProtocol = 'zimage-backend-readonly-v2'; }],
    ['meta', receipt => { receipt.checks[0].path = '/api/meta'; }],
    ['wallet', receipt => { receipt.checks[2].path = '/api/credits'; }],
    ['ledger', receipt => { receipt.checks[2].path = '/api/credits/ledger'; }],
    ['catalog', receipt => { receipt.catalogReady = true; }],
    ['identity', receipt => { receipt.processStart = { ...receipt.processStart, startTicks: 1 }; }],
  ];
  for (const [label, mutate] of invalid) {
    const f = await firstWindowFixture(t);
    let clock = 1800000001, finish, uploads = 0, verifies = 0;
    const challenge = { schemaVersion: 1, verifierProtocol: 'zimage-legacy-readonly-v1', operationId: f.status.operationId,
      backendRelease: previous, pid: f.recoveryProcess.pid, processStart: f.recoveryProcess,
      nonce: 'e'.repeat(64), createdAt: 1800000000, expiresAt: 1800000120 };
    await assert.rejects(runRelease(f.recoverArgs, { now: () => clock, pause: async () => { clock += 0.1; },
      verifierFactory: async () => ({ close: async () => {}, verify: async () => {
        verifies++; const receipt = firstWindowReceipt(challenge, clock); mutate(receipt);
        // The transport settles after the malformed response, so this fixture
        // needs no timers, background process or real SSH.
        queueMicrotask(() => finish({ code: 1, stdout: '', stderr: 'Fixture receipt rejected' }));
        return JSON.stringify(receipt);
      } }), runner: async (command, argv) => {
        if (command === 'scp') { uploads++; throw Error('Invalid receipt must not upload: ' + label); }
        if (argv.at(-1) === 'status') return response(f.completed);
        if (argv.includes('recover')) return new Promise(resolve => { finish = resolve; });
        if (argv.at(-1) === 'verification-request') return response(challenge);
        throw Error('Invalid receipt must not be accepted: ' + label);
      } }), error => error.outcome === 'uncertain');
    assert.equal(verifies, 1, label); assert.equal(uploads, 0, label);
    const local = JSON.parse(await readFile(resolve(f.folder, 'first-window-state', `first-window-${f.status.operationId}-recover.json`), 'utf8'));
    assert.deepEqual(local.receiptEvents.map(event => event.phase), ['failed'], label);
  }
  const f = await firstWindowFixture(t);
  let clock = 1800000001, finish, verifies = 0, polls = 0;
  await assert.rejects(runRelease(f.recoverArgs, { now: () => clock, pause: async () => { clock += 1; },
    verifierFactory: async () => ({ close: async () => {}, verify: async () => { verifies++; throw Error('B0 cannot use candidate verifier'); } }),
    runner: async (command, argv) => {
      assert.equal(command, 'ssh');
      if (argv.at(-1) === 'status') return response(f.completed);
      if (argv.includes('recover')) return new Promise(resolve => { finish = resolve; });
      if (argv.at(-1) === 'verification-request') {
        polls++;
        if (polls === 2) finish({ code: 1, stdout: '', stderr: 'Fixture old protocol rejected' });
        return response({ schemaVersion: 1, operationId: f.status.operationId, backendRelease: previous, pid: 101,
          nonce: 'e'.repeat(64), createdAt: 1800000000, expiresAt: 1800000120 });
      }
      throw Error('Unexpected candidate evidence for B0');
    } }), error => error.outcome === 'uncertain');
  assert.equal(verifies, 0);
});

test('the actual pure legacy verifier only reads genuine B0 ready/account/sessions and emits CLI-compatible redacted evidence', async t => {
  const f = await firstWindowFixture(t);
  let clock = 1800000001, finish, state = f.completed, paths, receipt;
  const challenge = { schemaVersion: 1, verifierProtocol: 'zimage-legacy-readonly-v1', operationId: f.status.operationId,
    backendRelease: previous, pid: f.recoveryProcess.pid, processStart: f.recoveryProcess,
    nonce: 'e'.repeat(64), createdAt: 1800000000, expiresAt: 1800000120 };
  const requestPath = resolve(f.folder, 'legacy-request.json');
  await writeFile(requestPath, JSON.stringify(challenge));
  const result = await runRelease(f.recoverArgs, { now: () => clock, pause: async () => { clock += 0.1; },
    verifierFactory: async () => ({ close: async () => {}, verify: async raw => {
      assert.deepEqual(JSON.parse(raw), challenge);
      const verified = await runProcess('python3', ['-I', '-B', '-c', `import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('legacy_cli_fixture',sys.argv[1]);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
request=json.loads(Path(sys.argv[2]).read_text());paths=[]
owner='10000000-0000-4000-8000-000000000001'
bodies={'/api/health/ready':{'status':'ok','version':request['backendRelease']},'/api/account':{'id':owner,'email':'fixture@example.test','displayName':None,'status':'active'},'/api/sessions':{'sessions':[]}}
def fetch(path):
 paths.append(path)
 if path not in bodies:raise ValueError('Forbidden genuine B0 route')
 return 200,{'cache-control':'private, no-store'},bodies[path]
receipt=v.verify(request,fetch,now=lambda:float(sys.argv[3]))
print(json.dumps({'receipt':receipt,'paths':paths}))
`, resolve('ops/aliyun/backend/verify.py'), requestPath, String(clock)]);
      assert.equal(verified.code, 0, verified.stderr);
      ({ paths, receipt } = JSON.parse(verified.stdout));
      return JSON.stringify(receipt);
    } }), runner: async (command, argv) => {
      if (command === 'scp') return response({});
      if (argv.at(-1) === 'status') return response(state);
      if (argv.includes('recover')) return new Promise(resolve => { finish = resolve; });
      if (argv.at(-1) === 'verification-request') return response(challenge);
      if (argv.includes('accept-receipt')) {
        state = f.recovered; finish(response({ schemaVersion: 1, firstWindowJournal: state.journal, productionReady: false }));
        return response({ schemaVersion: 1, accepted: true, operationId: challenge.operationId, backendRelease: previous, pid: challenge.pid, requestSha256: receipt.requestSha256 });
      }
      throw Error('Unexpected pure legacy fixture command');
    } });
  assert.equal(result.firstWindowJournal.phase, 'recovered');
  assert.deepEqual(paths, ['/api/health/ready', '/api/account', '/api/sessions', '/api/health/ready']);
  assert.equal(receipt.requestSha256, requestSha(challenge));
  assert.equal(JSON.stringify(receipt).includes('fixture@example.test'), false);
});

test('first-window verifier readiness, Linux metadata and artifact hashes fail before every upload or service mutation', async t => {
  for (const failure of ['readiness', 'darwin', 'checksum']) {
    const f = await firstWindowFixture(t), commands = [];
    if (failure === 'darwin') {
      f.manifest.runtime.platform = 'darwin';
      const body = JSON.stringify(f.manifest);
      await writeFile(f.args[f.args.indexOf('--manifest') + 1], body);
      f.args[f.args.indexOf('--manifest-sha256') + 1] = sha(body);
      f.status.candidateManifestSha256 = sha(body);
    }
    if (failure === 'checksum') await writeFile(f.args[f.args.indexOf('--artifact') + 1], 'changed artifact');
    await assert.rejects(runRelease(f.args, { verifierFactory: failure === 'readiness' ? async () => { throw Error('Fixture verifier not ready'); }
      : async () => ({ close: async () => {}, verify: async () => { throw Error('Unexpected verification'); } }),
      runner: async (command, argv) => {
        commands.push(command); assert.equal(command, 'ssh'); assert.equal(argv.at(-1), 'status'); return response(f.status);
      } }));
    assert.deepEqual(commands, ['ssh'], failure);
  }
});

test('first-window run and explicit recovery share one local operation lock', async t => {
  const f = await firstWindowFixture(t);
  let started, release;
  const starting = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const first = runRelease(f.args, { runner: async (command, argv) => {
    if (command === 'ssh' && argv.at(-1) === 'status') { started(); await blocked; return response(f.status); }
    throw Error('Fixture verification ends before mutation');
  } });
  await starting;
  await assert.rejects(runRelease(f.recoverArgs, { runner: async () => { throw Error('Concurrent transport must not execute'); } }), /already running/);
  release();
  await assert.rejects(first, /Fixture verification ends before mutation/);
});

test('first-window uploaded and invalid local phases cannot resume a prior operation', async t => {
  const f = await firstWindowFixture(t);
  await assert.rejects(runRelease(f.args, { runner: async (command, argv) => {
    if (command === 'ssh' && argv.at(-1) === 'status') return response(f.status);
    if (command === 'python3') return response({ manifest: f.manifest, productionReady: false });
    throw Error('Fixture upload response lost');
  } }));
  const journal = JSON.parse(await readFile(f.state, 'utf8'));
  journal.phase = 'uploaded'; await writeFile(f.state, JSON.stringify(journal));
  await assert.rejects(runRelease(f.args, { runner: async (command, argv) => {
    assert.equal(command, 'ssh'); assert.equal(argv.at(-1), 'status'); return response(f.status);
  } }), /no upload, run or recovery was replayed/);
  journal.phase = 'unrecognized'; await writeFile(f.state, JSON.stringify(journal));
  await assert.rejects(runRelease(f.args, { runner: async () => { throw Error('Invalid journal cannot transport'); } }), /local journal phase is invalid/);
});

test('first-window forwards the original expected approval hashes so root rejects approval drift after preflight or upload', async t => {
  for (const action of ['run', 'recover']) for (const changedKey of ['policySha256', 'completionSha256']) {
    const f = await firstWindowFixture(t);
    const args = action === 'run' ? f.args : f.recoverArgs;
    const initial = action === 'run' ? f.status : f.completed;
    let rootStatus = structuredClone(initial), uploads = 0, rootMutations = 0, helperCalls = 0, statusCalls = 0;
    const expected = [initial.policySha256, initial.completionSha256];
    const runner = async (command, argv) => {
      if (command === 'python3') return response({ manifest: f.manifest, productionReady: false });
      if (command === 'scp') {
        uploads++;
        // The root approval can legitimately be replaced by another operator
        // after a client's successful preflight and fixed artifact transfer.
        rootStatus[changedKey] = 'f'.repeat(64);
        return response({});
      }
      assert.equal(command, 'ssh');
      if (argv.at(-1) === 'status') {
        statusCalls++;
        if (statusCalls === 1) return response(initial);
        return response(rootStatus);
      }
      assert.equal(argv.includes(action), true);
      helperCalls++;
      assert.deepEqual(argv.slice(-2), expected, 'the fixed helper receives the original caller approvals');
      if (action === 'recover') rootStatus[changedKey] = 'f'.repeat(64);
      // This fixture mirrors the root helper's compare-before-mutation guard.
      // It must never adopt the newly installed document or invoke recovery.
      if (argv.at(-2) !== rootStatus.policySha256 || argv.at(-1) !== rootStatus.completionSha256) {
        return { code: 1, stdout: '', stderr: 'Fixture expected root approval digest mismatch' };
      }
      rootMutations++;
      throw Error('Changed approval must be rejected before root preparation, journal, gate or service mutation');
    };
    await assert.rejects(runRelease(args, { runner }), error => error.outcome === 'uncertain');
    assert.equal(helperCalls, 1); assert.equal(rootMutations, 0); assert.equal(uploads, action === 'run' ? 1 : 0);
    const before = helperCalls;
    // A changed policy also invalidates an existing journal's policy binding.
    // Both outcomes must stay read-only and refuse adopting the replacement.
    const rejectedStatus = action === 'recover'
      ? /First-window status schema or sealed evidence is invalid/
      : /approval, completion evidence or exact release identity differs/;
    await assert.rejects(runRelease(args, { runner }), rejectedStatus);
    assert.equal(helperCalls, before, 'reconciliation must not refresh approval or replay the root command');
  }
});

test('first-window status and explicit recovery accept all exact retained service-configuration crash phases', async t => {
  for (const phase of ['configuring_candidate', 'configuring_legacy', 'legacy_started']) {
    const f = await firstWindowFixture(t);
    const journal = { ...f.record, phase };
    const crashed = { ...f.completed, current: previous, currentProcess: null, journal };
    if (phase === 'legacy_started') {
      crashed.currentProcess = f.recoveryProcess;
      journal.recoveryProcess = f.recoveryProcess;
    }
    const runner = async (command, argv) => {
      assert.equal(command, 'ssh'); assert.equal(argv.at(-1), 'status'); return response(crashed);
    };
    assert.deepEqual(await runRelease(['first-window', 'status'], { runner, environment: {} }), crashed);
    let state = crashed, recoveries = 0;
    const result = await runRelease(f.recoverArgs, { runner: async (command, argv) => {
      assert.equal(command, 'ssh');
      if (argv.at(-1) === 'status') return response(state);
      assert.deepEqual(argv.slice(argv.indexOf(TARGET.host) + 1), ['/usr/bin/python3', '-I', '-B', TARGET['first-window'], 'recover', f.status.operationId,
        f.status.policySha256, f.status.completionSha256]);
      recoveries++; state = f.recovered;
      return response({ schemaVersion: 1, firstWindowJournal: state.journal, productionReady: false });
    } });
    assert.equal(recoveries, 1, phase); assert.equal(result.firstWindowJournal.phase, 'recovered', phase);
    assert.equal(result.sealed, true, phase);
  }
});

test('first-window CLI status recognizes every phase exported by the actual root protocol', async t => {
  const f = await firstWindowFixture(t);
  const protocol = await runProcess('python3', ['-I', '-B', '-c', `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('cli_phase_contract',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print(json.dumps(sorted(module.PHASES)))
`, resolve('ops/aliyun/backend/first_window.py')]);
  assert.equal(protocol.code, 0, protocol.stderr);
  const phases = JSON.parse(protocol.stdout);
  assert.equal(phases.length > 0, true);
  for (const phase of phases) {
    const status = phase === 'recovered' ? f.recovered : { ...f.completed, journal: { ...f.record, phase } };
    const result = await runRelease(['first-window', 'status'], { environment: {}, runner: async (command, argv) => {
      assert.equal(command, 'ssh'); assert.equal(argv.at(-1), 'status'); return response(status);
    } });
    assert.equal(result.journal.phase, phase);
  }
});
