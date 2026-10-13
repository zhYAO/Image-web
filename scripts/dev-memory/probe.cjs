const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const v8 = require('node:v8');

// Only the direct Next worker participates; no inspector, sockets or snapshots.
if (process.env.__NEXT_DEV_SERVER === '1' && process.env.NEXT_PRIVATE_WORKER === '1') {
  const output = process.env.ZIMAGE_MEMORY_OUTPUT;
  const generations = [];
  const original = vm.runInNewContext;
  vm.runInNewContext = function (source, context, options) {
    const result = original.call(this, source, context, options);
    if (context && String(source).includes('__RSC_MANIFEST')) generations.push(new WeakRef(context));
    return result;
  };
  const handshake = path.join(output, `worker-${process.ppid}.json`);
  fs.writeFileSync(`${handshake}.tmp`, JSON.stringify({ pid: process.pid, parent: process.ppid, gc: typeof global.gc === 'function' }), { flag: 'wx', mode: 0o600 });
  fs.linkSync(`${handshake}.tmp`, handshake); // Atomic and exclusive: refuse a replacement worker.
  fs.unlinkSync(`${handshake}.tmp`);
  let sequence = 0, busy = false;
  process.on('SIGUSR2', async () => {
    if (busy) return;
    busy = true;
    try {
      for (let i = 0; i < 3; i++) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const memory = process.memoryUsage(), heap = v8.getHeapStatistics();
      const sample = { sequence: ++sequence, pid: process.pid, rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external, arrayBuffers: memory.arrayBuffers, nativeContexts: heap.number_of_native_contexts, detachedContexts: heap.number_of_detached_contexts, totalVmGenerations: generations.length, liveVmGenerations: generations.flatMap((ref, generation) => ref.deref() ? [generation] : []) };
      const filename = path.join(output, `sample-${process.pid}.json`);
      fs.writeFileSync(`${filename}.tmp`, JSON.stringify(sample), { mode: 0o600 });
      fs.renameSync(`${filename}.tmp`, filename);
    } finally { busy = false; }
  });
}
