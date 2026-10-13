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
    countText = "1",
    mode = "baseline",
    latencyText = "25",
  ] = process.argv.slice(2);
  if (!phase || !manifestFile || !outputFile)
    throw new Error("phase manifest case output required");
  const measurementRunId = randomUUID();
  const count = Number(countText),
    latencyMs = Number(latencyText);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 5 ||
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
    let registeredDimensions: { width: number; height: number };
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
                    const input = args.p_input as {
                      name: string;
                      width: number;
                      height: number;
                    };
                    registeredName = input.name;
                    registeredDimensions = {
                      width: input.width,
                      height: input.height,
                    };
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
              ...registeredDimensions!,
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
  const result: Record<string, unknown> = {
    measurementRunId,
    phase,
    caseName,
    latencyMs,
    seed: manifest.seed,
    node: process.version,
    startupRssBytes,
    preloadRssBytes,
    forceGc: Boolean(global.gc),
    scope:
      "actual offline service/Sharp; synthetic scoped RPC and copied bytes; no network, provider or ZIP operation",
  };
  if (phase === "cold" || phase === "warm") {
    const warmup = phase === "warm" ? await trial(mode === "reuse") : undefined;
    if (warmup) collectGarbage();
    const measured = await trial(mode === "reuse");
    Object.assign(result, { mode, warmup, trials: [measured] });
  } else if (phase === "concurrency") {
    const reuse = mode === "reuse";
    process.env.ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED = reuse ? "true" : "false";
    const started = performance.now();
    const trials = await Promise.all(
      Array.from({ length: count }, () => trial(reuse, false)),
    );
    if (getApparelRetainedSourceBytes() !== 0)
      throw new Error("concurrent budget leaked");
    Object.assign(result, {
      mode,
      concurrency: count,
      wallMs: performance.now() - started,
      trials,
    });
  } else throw new Error("unknown measurement phase");
  for (const source of fixture.sources) {
    if (
      createHash("sha256").update(byId.get(source.id)!).digest("hex") !==
      source.sha256
    )
      throw new Error("input bytes mutated");
  }
  Object.assign(result, { inputsUnchanged: true });
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
