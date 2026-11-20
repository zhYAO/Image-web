import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { disposableConfig, localStatus, storeCookies } from './isolated-auth-rehearsal.mjs';

test('keeps postgres/auth/api and migrations, disables unrelated provider execution', async () => {
  const source = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  const config = disposableConfig(source, 'zimage_auth_123456789abc');
  assert.match(config, /^project_id = "zimage_auth_123456789abc"$/m);
  assert.match(config, /\[api\]\nenabled = true/);
  assert.match(config, /\[auth\]\nenabled = true/);
  assert.match(config, /\[db.migrations\]\n[^\n]*\nenabled = true/);
  for (const section of ['edge_runtime', 'studio', 'analytics', 'realtime']) {
    const contents = config.split('[' + section + ']')[1].split(/^\[/m)[0];
    assert.match(contents, /^enabled = false$/m);
  }
  assert.throws(() => disposableConfig(source, 'zimage'));
});

test('rejects remote/cloud or legacy credential status: no fallback endpoint', () => {
  const record = { API_URL: 'http://127.0.0.1:54321', PUBLISHABLE_KEY: 'sb_publishable_' + 'A'.repeat(24), SECRET_KEY: 'sb_secret_' + 'B'.repeat(24) };
  assert.deepEqual(Object.keys(localStatus(record)).sort(), ['publishable', 'secret']);
  for (const url of ['https://example.supabase.co', 'http://127.0.0.1:54322', 'http://localhost:54321/path', 'http://127.0.0.1:54321@external.test']) {
    assert.throws(() => localStatus({ ...record, API_URL: url }));
  }
  assert.throws(() => localStatus({ ...record, SECRET_KEY: 'legacy' }));
});

test('captures cookie chunks and respects deletion; stores no unrelated cookies', () => {
  const jar = new Map();
  const headers = new Headers();
  headers.append('set-cookie', 'sb-foo-auth-token.0=first; HttpOnly; Secure');
  headers.append('set-cookie', 'sb-foo-auth-token.1=second; HttpOnly; Secure');
  headers.append('set-cookie', 'misc=x; Secure');
  storeCookies(jar, headers);
  assert.deepEqual([...jar.values()], ['first', 'second']);
  const logout = new Headers();
  logout.append('set-cookie', 'sb-foo-auth-token.0=; Max-Age=0');
  logout.append('set-cookie', 'sb-foo-auth-token.1=ignored; Max-Age=0');
  storeCookies(jar, logout);
  assert.equal(jar.size, 0);
});
