import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const moduleUrl = new URL('./reproduce.mjs', import.meta.url);
const load = () => import(moduleUrl);

test('CLI rejects unsafe or unbounded experiments before starting a server', async () => {
  const { parseArgs } = await load();
  assert.deepEqual(parseArgs(['--output', '/tmp/example']), {
    bundler: 'webpack', element: 'static', cycles: 3, output: '/tmp/example', assertCollected: false,
  });
  assert.throws(() => parseArgs([]));
  for (const args of [['--cycles', '0'], ['--cycles', '5'], ['--cycles', '1.5'],
    ['--bundler', 'other'], ['--element', 'other'], ['--output', 'relative'],
    ['--unknown'], ['--cycles'], ['--cycles', '2', '--cycles', '3']]) {
    assert.throws(() => parseArgs([...args, ...(args.includes('--output') ? [] : ['--output', '/tmp/out'])]));
  }
});

test('output validation rejects repository paths and symlink aliases without writing', async () => {
  const { validateOutput } = await load();
  const root = await mkdtemp(join(tmpdir(), 'memory-output-test-'));
  try {
    await symlink(root, join(root, 'alias'));
    await assert.rejects(validateOutput(join(root, 'evidence'), root), /outside/);
    await assert.rejects(validateOutput(join(root, 'alias', 'evidence'), root), /outside/);
    assert.equal(await validateOutput(join(root, 'evidence'), join(root, 'repo')), join(root, 'evidence'));
    await assert.rejects(readFile(join(root, 'evidence')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP retries consume error and stale bodies before checking the visible version', async () => {
  const { readVersionResponse } = await load();
  for (const [status, body, expected] of [
    [503, '<p>memory-version-2</p>', false],
    [500, 'Compilation pending', false],
    [200, '<p>memory-version-1</p>', false],
    [200, '<p>memory-version-2</p>', true],
  ]) {
    const response = new Response(body, { status });
    assert.equal(await readVersionResponse(response, 2), expected);
    assert.equal(response.bodyUsed, true, `Status ${status} left its response body unread`);
  }
});

async function running(pid) {
  try { return !/\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8')); }
  catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return false; throw error; }
}

test('normal, failure, timeout, budget and signal exits kill the owned process group', { timeout: 15000 }, async () => {
  const { supervise } = await load();
  const temp = await mkdtemp(join(tmpdir(), 'memory-group-test-'));
  try {
    for (const outcome of ['normal', 'error', 'timeout', 'budget', 'signal']) {
      const pidFile = join(temp, outcome);
      const descendant = `process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
      const fake = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
      let parentPid, descendantPid, ready = false;
      const task = supervise(process.execPath, ['-e', fake], { stdio: 'ignore' }, async (child, signal) => {
        parentPid = child.pid;
        for (let i = 0; i < 100; i++) {
          try { descendantPid = Number(await readFile(pidFile, 'utf8')); break; } catch {}
          await delay(10, undefined, { signal });
        }
        assert.ok(descendantPid);
        await delay(100, undefined, { signal });
        ready = true;
        if (outcome === 'normal') return 'finished';
        if (outcome === 'error') throw new Error('work failed');
        if (outcome === 'signal') process.emit('SIGTERM');
        await delay(5000, undefined, { signal });
      }, { timeoutMs: outcome === 'timeout' ? 500 : 4000, intervalMs: 20, killGraceMs: 80,
        checkBudget: () => { if (outcome === 'budget' && ready) throw new Error('budget exceeded'); } });
      if (outcome === 'normal') assert.equal(await task, 'finished');
      else await assert.rejects(task);
      for (let i = 0; i < 100 && (await running(parentPid) || await running(descendantPid)); i++) await delay(10);
      assert.equal(await running(parentPid), false, `${outcome}: parent survived`);
      assert.equal(await running(descendantPid), false, `${outcome}: descendant survived`);
    }
    await assert.rejects(supervise('/no/such/executable', [], {}, async (_, signal) => delay(5000, undefined, { signal }), { killGraceMs: 10 }));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('the no-inspector probe releases discarded VM contexts and reports primitive generations', { timeout: 8000 }, async () => {
  const { supervise } = await load();
  const temp = await mkdtemp(join(tmpdir(), 'memory-probe-test-'));
  try {
    const code = `const vm=require('node:vm');global.kept={};vm.runInNewContext('globalThis.__RSC_MANIFEST={}',global.kept);vm.runInNewContext('globalThis.__RSC_MANIFEST={}',{});setInterval(()=>{},1000);`;
    await supervise(process.execPath, ['--expose-gc', '--require', new URL('./probe.cjs', import.meta.url).pathname, '-e', code], {
      env: { ...process.env, NODE_OPTIONS: '', __NEXT_DEV_SERVER: '1', NEXT_PRIVATE_WORKER: '1', ZIMAGE_MEMORY_OUTPUT: temp }, stdio: 'ignore',
    }, async (child, signal) => {
      const readWhenReady = async path => {
        for (let i = 0; i < 150; i++) {
          try { return JSON.parse(await readFile(path, 'utf8')); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          await delay(20, undefined, { signal });
        }
        assert.fail('Probe did not publish its private file');
      };
      const handshake = await readWhenReady(join(temp, `worker-${process.pid}.json`));
      assert.equal(handshake.pid, child.pid);
      assert.equal(handshake.gc, true);
      await delay(100, undefined, { signal });
      child.kill('SIGUSR2');
      const sample = await readWhenReady(join(temp, `sample-${child.pid}.json`));
      assert.equal(sample.totalVmGenerations, 2);
      assert.deepEqual(sample.liveVmGenerations, [0]);
      assert.ok(sample.heapUsed > 0 && sample.rss > 0 && sample.nativeContexts > 0);
      assert.ok(Object.values(sample).every(value => typeof value === 'number' || Array.isArray(value)));
    }, { timeoutMs: 6000, killGraceMs: 50 });
  } finally { await rm(temp, { recursive: true, force: true }); }
});
