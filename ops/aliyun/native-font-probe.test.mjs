import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm, writeFile, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Execute the actual adapter's native payload on this OS. runuser/systemd and
// Linux archive assembly remain separate Linux-only checks.
const adapter = await readFile(new URL('./release.py', import.meta.url), 'utf8');
const probe = adapter.match(/NATIVE_PROBE = r"""([\s\S]*?)"""/)[1];
const cwd = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const run = (directory, sha) => spawnSync(process.execPath, ['-e', probe], {
  cwd, encoding: 'utf8', env: { ...process.env, ZIMAGE_SHARED_FONT_DIR: directory, ZIMAGE_STATIC_ASSET_SHA256: sha },
});

test('actual deployment native payload validates original external fonts and all six codec operations', () => {
  const result = run(process.env.ZIMAGE_SHARED_FONT_DIR, process.env.ZIMAGE_STATIC_ASSET_SHA256);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { native: true, fonts: 2, codecs: 6 });
});

for (const target of ['asset-manifest.json', 'fonts/LICENSE.txt', 'fonts/NotoSansCJKsc-Regular.otf']) {
  test(`actual native payload fails safely for changed ${target}`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'zimage-native-font-probe-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sha = process.env.ZIMAGE_STATIC_ASSET_SHA256;
    const version = path.join(root, sha);
    await cp(path.dirname(process.env.ZIMAGE_SHARED_FONT_DIR), version, { recursive: true });
    await writeFile(path.join(version, target), 'modified');
    const result = run(path.join(version, 'fonts'), sha);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Native\/font verification failed/);
    assert.equal(result.stdout, '');
  });
}

for(const problem of ['missing directory','wrong fingerprint','missing pair']) {
  test('actual native payload refuses '+problem,()=>{
    const directory=problem==='missing directory'?path.join(tmpdir(),'missing-zimage-font-version','fonts'):process.env.ZIMAGE_SHARED_FONT_DIR;
    const sha=problem==='missing pair'?'':problem==='wrong fingerprint'?'0'.repeat(64):process.env.ZIMAGE_STATIC_ASSET_SHA256;
    const result=run(directory,sha);
    assert.notEqual(result.status,0);
    assert.equal(result.stdout,'');
  });
}
test('actual native payload refuses an aliased version directory',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'zimage-font-alias-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const sha=process.env.ZIMAGE_STATIC_ASSET_SHA256;
  await symlink(path.dirname(process.env.ZIMAGE_SHARED_FONT_DIR),path.join(root,sha),process.platform==='win32'?'junction':'dir');
  const result=run(path.join(root,sha,'fonts'),sha);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Native\/font verification failed/);
});

for(const problem of ['traversal','duplicate']) {
  test('actual native payload rejects a correctly hashed manifest with '+problem,async t=>{
    const root=await mkdtemp(path.join(tmpdir(),'zimage-unsafe-font-manifest-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const pending=path.join(root,'pending');
    await cp(path.dirname(process.env.ZIMAGE_SHARED_FONT_DIR),pending,{recursive:true});
    const manifest=JSON.parse(await readFile(path.join(pending,'asset-manifest.json'),'utf8'));
    manifest.files.push({...manifest.files[0],path:problem==='traversal'?'fonts/../escape':manifest.files[0].path});
    const body=JSON.stringify(manifest),sha=createHash('sha256').update(body).digest('hex');
    await writeFile(path.join(pending,'asset-manifest.json'),body);
    await rename(pending,path.join(root,sha));
    const result=run(path.join(root,sha,'fonts'),sha);
    assert.notEqual(result.status,0);
    assert.equal(result.stdout,'');
  });
}
