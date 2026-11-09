import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';
import { createController, reconcileRef } from './reconcile.mjs';

const sha = 'a'.repeat(40);
const different = 'b'.repeat(40);
const target = { branch: 'main', sha };

function fixture({ check = null, mirror = [sha], run, primary = [sha], startFails = false } = {}) {
  const events = [];
  const read = (values) => values.length > 1 ? values.shift() : values[0];
  const services = {
    readPrimary: async () => read(primary),
    readMirror: async () => read(mirror),
    syncMirror: async () => { events.push('sync'); },
    readCheck: async () => check,
    writeCheck: async (_target, status) => { events.push(status); check = status; },
    start: async (input) => {
      events.push(input);
      if (startFails) throw new Error('submission connection lost');
      return '42';
    },
    readRun: async () => run,
    wait: async () => {},
  };
  return { services, events };
}

test('waits for the Codeup mirror before launching the exact GitHub revision', async () => {
  const { services, events } = fixture({ mirror: [different, different, sha] });
  await reconcileRef(target, services);
  assert.deepEqual(events, ['sync', { state: 'pending' }, target, { state: 'pending', runId: '42' }]);
});

test('does not submit a run when GitHub supersedes the queued revision', async () => {
  const { services, events } = fixture({ mirror: [different, sha], primary: [sha, different] });
  assert.equal(await reconcileRef(target, services), 'superseded');
  assert.deepEqual(events, ['sync']);
});

test('does not reuse another SHA or accept quality without database success', async () => {
  for (const run of [
    { sha: different, status: 'SUCCESS', quality: 'SUCCESS', database: 'SUCCESS' },
    { sha, status: 'SUCCESS', quality: 'SUCCESS', database: 'SKIPPED' },
  ]) {
    const { services, events } = fixture({ check: { state: 'pending', runId: '42' }, run });
    await reconcileRef(target, services);
    assert.deepEqual(events, [{ state: 'failure', runId: '42' }]);
  }
});

test('publishes success only for both checks from the recorded run', async () => {
  const { services, events } = fixture({ check: { state: 'pending', runId: '42' },
    run: { sha, status: 'SUCCESS', quality: 'SUCCESS', database: 'SUCCESS' } });
  await reconcileRef(target, services);
  await reconcileRef(target, services);
  assert.deepEqual(events, [{ state: 'success', runId: '42' }]);
});

test('does not submit a second run after the first submission response is lost', async () => {
  const { services, events } = fixture({ startFails: true });
  await assert.rejects(reconcileRef(target, services), /submission connection lost/);
  assert.equal(await reconcileRef(target, services), 'submission-uncertain');
  assert.deepEqual(events, [{ state: 'pending' }, target]);
});

test('reconciles a manually retried Flow run without submitting a duplicate', async () => {
  const { services, events } = fixture({ check: { state: 'failure', runId: '42' },
    run: { sha, status: 'SUCCESS', quality: 'SUCCESS', database: 'SUCCESS' } });
  assert.equal(await reconcileRef(target, services), 'success');
  assert.deepEqual(events, [{ state: 'success', runId: '42' }]);
});

test('calls mirror synchronization with the official ROA method and resource path', () => {
  const calls = [];
  const client = createController({
    ZIMAGE_GITHUB_APP_TOKEN: 'fixture', ZIMAGE_GITHUB_APP_BOT_ID: '2',
    ZIMAGE_FLOW_PAT: 'fixture', ZIMAGE_FLOW_QUALITY_PIPELINE_ID: '3',
  }, (program, args) => {
    calls.push({ program, args });
    return JSON.stringify({ success: true, result: { result: true } });
  });
  client.syncMirror();
  assert.deepEqual(calls[0].args.slice(0, 3), ['devops', 'POST', '/repository/5027582/mirror']);
});

test('scheduled reconciliation can obtain a GitHub App token scoped to Image-web', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  const client = createController({
    ZIMAGE_GITHUB_APP_CLIENT_ID: 'Iv1.example',
    ZIMAGE_GITHUB_APP_INSTALLATION_ID: '123',
    ZIMAGE_GITHUB_APP_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    ZIMAGE_GITHUB_APP_BOT_ID: '2',
    ZIMAGE_FLOW_PAT: 'fixture',
    ZIMAGE_FLOW_QUALITY_PIPELINE_ID: '3',
  }, undefined, async (url, headers, options) => {
    calls.push({ url, headers, options });
    return calls.length === 1 ? { token: 'short-lived-app-token' } : { object: { sha } };
  });

  assert.equal(await client.readPrimary('main'), sha);
  assert.equal(calls[0].url, 'https://api.github.com/app/installations/123/access_tokens');
  assert.deepEqual(calls[0].options.body, {
    repositories: ['Image-web'],
    permissions: { contents: 'read', pull_requests: 'read', statuses: 'write' },
  });
  const [header, payload, signature] = calls[0].headers.Authorization.replace(/^Bearer /, '').split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, 'Iv1.example');
  assert.equal(claims.exp - claims.iat, 600);
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
  assert.equal(calls[1].headers.Authorization, 'Bearer short-lived-app-token');
});
