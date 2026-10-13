// Offline only: actual service/Sharp, synthetic RPC and byte-copy Storage.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { createApparelService } from "../server/apparel/apparel-service";
import { getApparelRetainedSourceBytes } from "../server/apparel/apparel-source-reader";

type Source = { id: string; file: string; bytes: number; sha256: string };
type Fixture = {
  name: string;
  displays: number;
  plan: unknown;
  sources: Source[];
};
type Trial = {
  reuse: boolean;
  elapsedMs: number;
  reads: number;
  readBytes: number;
  outputs: number;
  digest: string;
  retainedPeakBytes: number;
  retainedAfterBytes: number;
  startRssBytes: number;
  sampledPeakRssBytes: number;
  endRssBytes: number;
  firstClaimProcessAgeMs: number;
  endedAt: string;
  startMemory: ReturnType<typeof process.memoryUsage>;
  endMemory: ReturnType<typeof process.memoryUsage>;
  sharpCache: ReturnType<typeof sharp.cache>;
  sharpCounters: ReturnType<typeof sharp.counters>;
  sharpConcurrency: number;
  outputHashes: { name: string; hash: string }[];
};
async function main() {
  const [
    phase,
    manifestFile,
    caseName,
    outputFile,
    countText = "120",
    mode = "baseline",
    latencyText = "25",
  ] = process.argv.slice(2);
  if (!phase || !manifestFile || !outputFile)
    throw new Error("phase manifest case output required");
  const measurementRunId = randomUUID(),
    partialFile = `${outputFile}.${measurementRunId}.jsonl`;
  await fs.writeFile(partialFile, "", { flag: "wx" });
  const count = Number(countText),
    latencyMs = Number(latencyText);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isFinite(latencyMs) ||
    latencyMs < 0
  )
    throw new Error("invalid count/latency");
  const startupRssBytes = process.memoryUsage().rss;
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")) as {
    seed: number;
    cases: Fixture[];
  };
  const fixture = manifest.cases.find((item) => item.name === caseName);
  if (!fixture) throw new Error("unknown fixture");
  const byId = new Map<string, Buffer>();
  const byFile = new Map<string, Buffer>();
  for (const source of fixture.sources) {
    let bytes = byFile.get(source.file);
    if (!bytes) {
      bytes = await fs.readFile(
        path.join(path.dirname(manifestFile), source.file),
      );
      if (
        bytes.length !== source.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== source.sha256
      )
        throw new Error("input hash mismatch");
      byFile.set(source.file, bytes);
    }
    byId.set(source.id, bytes);
  }
  const preloadRssBytes = process.memoryUsage().rss;
  const uuid = (n: number) =>
    `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  let referenceDigest: string | undefined;
  let sequence = 0;
  function collectGarbage() {
    global.gc?.();
  }
  async function trial(reuse: boolean, setEnvironment = true): Promise<Trial> {
    if (setEnvironment)
      process.env.ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED = reuse
        ? "true"
        : "false";
    const serial = ++sequence,
      owner = uuid(serial * 10),
      taskId = uuid(serial * 10 + 1);
    const task = {
      id: taskId,
      sessionId: taskId,
      engine: "apparel-catalog",
      revision: 1,
      plan: fixture!.plan,
      createdAt: "2026-10-13",
      updatedAt: "2026-10-13",
      runs: [],
      archived: false,
    };
    const hashes: { name: string; hash: string }[] = [];
    let reads = 0,
      readBytes = 0,
      registeredName = "",
      retainedPeakBytes = 0;
    const startMemory = process.memoryUsage(),
      startRssBytes = startMemory.rss;
    let sampledPeakRssBytes = startRssBytes;
    const pulse = () => {
      retainedPeakBytes = Math.max(
        retainedPeakBytes,
        getApparelRetainedSourceBytes(),
      );
      sampledPeakRssBytes = Math.max(
        sampledPeakRssBytes,
        process.memoryUsage().rss,
      );
    };
    const sampler = setInterval(pulse, 20);
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (
          name !== "apparel_dispatch" ||
          args.p_user_id !== owner ||
          args.p_task_id !== taskId
        )
          throw new Error("unscoped mock RPC");
        pulse();
        const op = args.p_operation;
        if (op === "fail") throw new Error("unexpected failed benchmark claim");
        const data =
          op === "submit"
            ? {
                claimed: true,
                runId: uuid(serial * 10 + 2),
                claimToken: uuid(serial * 10 + 3),
                plan: fixture!.plan,
                task,
              }
            : op === "sources"
              ? fixture!.sources.map((s) => ({
                  id: s.id,
                  path: `${owner}/${s.id}`,
                }))
              : op === "register"
                ? (() => {
                    registeredName = (args.p_input as { name: string }).name;
                    return {
                      id: uuid(serial * 10 + 4),
                      path: `${owner}/output.jpg`,
                    };
                  })()
                : task;
        return { data, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          download: async (sourcePath: string) => {
            if (bucket !== "uploads" || !sourcePath.startsWith(`${owner}/`))
              throw new Error("unscoped mock download");
            const bytes = byId.get(sourcePath.slice(owner.length + 1));
            if (!bytes) throw new Error("unknown authorized source");
            reads++;
            readBytes += bytes.length;
            pulse();
            if (latencyMs)
              await new Promise((resolve) => setTimeout(resolve, latencyMs));
            return {
              data: { arrayBuffer: async () => new Uint8Array(bytes).buffer },
              error: null,
            };
          },
          upload: async (destination: string, bytes: Uint8Array) => {
            if (bucket !== "generated" || !destination.startsWith(`${owner}/`))
              throw new Error("unscoped mock upload");
            pulse();
            hashes.push({
              name: registeredName,
              hash: createHash("sha256").update(bytes).digest("hex"),
            });
            return { error: null };
          },
        }),
      },
    };
    const firstClaimProcessAgeMs = process.uptime() * 1000,
      started = performance.now();
    try {
      await createApparelService(client).dispatch(
        owner,
        "submit",
        taskId,
        { requestId: uuid(serial * 10 + 5), revision: 1 },
        uuid(serial * 10 + 6),
      );
    } finally {
      pulse();
      clearInterval(sampler);
    }
    const elapsedMs = performance.now() - started;
    const expected = 10 + fixture!.displays;
    if (hashes.length !== expected)
      throw new Error(`output count ${hashes.length}/${expected}`);
    const digest = createHash("sha256")
      .update(JSON.stringify(hashes))
      .digest("hex");
    if (referenceDigest && digest !== referenceDigest)
      throw new Error("output digest changed across modes/claims");
    referenceDigest = digest;
    const retainedAfterBytes = getApparelRetainedSourceBytes();
    if (setEnvironment && retainedAfterBytes !== 0)
      throw new Error("retained budget leaked after serial claim");
    if (retainedPeakBytes > 32 * 1024 * 1024)
      throw new Error("global byte budget exceeded");
    return {
      reuse,
      elapsedMs,
      reads,
      readBytes,
      outputs: hashes.length,
      digest,
      retainedPeakBytes,
      retainedAfterBytes,
      startRssBytes,
      sampledPeakRssBytes,
      endRssBytes: process.memoryUsage().rss,
      firstClaimProcessAgeMs,
      endedAt: new Date().toISOString(),
      startMemory,
      endMemory: process.memoryUsage(),
      sharpCache: sharp.cache(),
      sharpCounters: sharp.counters(),
      sharpConcurrency: sharp.concurrency(),
      outputHashes: hashes,
    };
  }
  // Repeatable balanced AB/BA order, shuffled independently of measured timings.
  let state = manifest.seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const orders: string[] = Array.from({ length: count }, (_, i) =>
    i % 2 ? "RB" : "BR",
  );
  for (let i = orders.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [orders[i], orders[j]] = [orders[j]!, orders[i]!];
  }
  const result: Record<string, unknown> = {
    measurementRunId,
    partialFile,
    phase,
    caseName,
    latencyMs,
    seed: manifest.seed,
    node: process.version,
    startupRssBytes,
    preloadRssBytes,
    forceGc: Boolean(global.gc),
    scope:
      "actual offline apparel service/Sharp; synthetic RPC, local copied bytes; no provider, production, network, or ZIP operation",
  };
  if (phase === "steady" || phase === "pilot") {
    const warmups = [];
    for (let i = 0; i < (phase === "steady" ? 3 : 0); i++) {
      collectGarbage();
      const b = await trial(false);
      collectGarbage();
      const r = await trial(true);
      warmups.push({ baseline: b, reuse: r });
    }
    const pairs = [];
    for (let i = 0; i < count; i++) {
      const order = orders[i]!,
        entries: Trial[] = [];
      for (const letter of order) {
        collectGarbage();
        entries.push(await trial(letter === "R"));
      }
      const baseline = entries.find((t) => !t.reuse)!,
        reuse = entries.find((t) => t.reuse)!;
      pairs.push({
        index: i,
        order,
        baselineMs: baseline.elapsedMs,
        reuseMs: reuse.elapsedMs,
        baseline,
        reuse,
      });
      // Outside the timed claim; preserve completed pairs if a watchdog aborts.
      await fs.appendFile(partialFile, JSON.stringify(pairs.at(-1)) + "\n");
      if ((i + 1) % 10 === 0)
        console.log(JSON.stringify({ caseName, pairs: i + 1, total: count }));
    }
    Object.assign(result, { warmups, pairs });
  } else if (phase === "concurrency") {
    const reuse = mode === "reuse";
    process.env.ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED = reuse ? "true" : "false";
    collectGarbage();
    const started = performance.now();
    const trials = await Promise.all(
      Array.from({ length: count }, () => trial(reuse, false)),
    );
    const retainedAfterBytes = getApparelRetainedSourceBytes();
    if (retainedAfterBytes !== 0) throw new Error("concurrent budget leaked");
    Object.assign(result, {
      mode,
      concurrency: count,
      wallMs: performance.now() - started,
      trials,
      retainedAfterBytes,
    });
  } else if (phase === "cold" || phase === "memory") {
    const trials = [];
    for (let i = 0; i < count; i++) {
      if (phase === "memory") collectGarbage();
      trials.push(await trial(mode === "reuse"));
      await fs.appendFile(partialFile, JSON.stringify(trials.at(-1)) + "\n");
    }
    Object.assign(result, { mode, trials });
  } else throw new Error("unknown measurement phase");
  Object.assign(result, {
    processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
    retainedAfterBytes: getApparelRetainedSourceBytes(),
  });
  await fs.writeFile(outputFile, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify({
      phase,
      caseName,
      outputFile,
      processMaxRssBytes: result.processMaxRssBytes,
    }),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
