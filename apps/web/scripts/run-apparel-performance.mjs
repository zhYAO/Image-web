// Offline only. node apps/web/scripts/run-apparel-performance.mjs /absolute/evidence-dir
//   prepare | cold|warm CASE PAIRS SEED LATENCY_MS WINDOW | concurrency CASE COUNT | report
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { cpus, availableParallelism } from "node:os";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  createFixtures,
  balancedOrders,
} from "./apparel-performance-fixtures.mjs";
import {
  policy,
  assertTrial,
  assertCompatible,
  evaluateCase,
  chronologicalBatches,
  evidenceBlockers,
  isCompetingCommand,
} from "./apparel-performance-policy.mjs";
import {
  readMemoryResource,
  requiredHeadroom,
} from "./apparel-performance-safety.mjs";

let failureDirectory, ownedAbort, stoppingSignal;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stoppingSignal = signal;
    if (ownedAbort) ownedAbort(`runner interrupted: ${signal}`);
    else {
      if (failureDirectory)
        try {
          writeFileSync(
            path.join(failureDirectory, `run-failure-${randomUUID()}.json`),
            JSON.stringify({ reason: signal }),
          );
        } catch {}
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
  });
async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const web = path.resolve(scriptDir, "..");
  const repo = path.resolve(web, "../..");
  const require = createRequire(path.join(web, "package.json"));
  const sharp = require("sharp");
  const esbuild = createRequire(
    createRequire(require.resolve("vitest/package.json")).resolve(
      "vite/package.json",
    ),
  )("esbuild");
  const [
    dirArg,
    phase = "prepare",
    caseName,
    countArg = "1",
    seedArg = "20261013",
    latencyArg = "0",
    window = "first",
  ] = process.argv.slice(2);
  if (
    !dirArg ||
    !path.isAbsolute(dirArg) ||
    !["prepare", "cold", "warm", "concurrency", "report"].includes(phase)
  )
    throw new Error("absolute evidence directory and explicit phase required");
  const directory = path.resolve(dirArg);
  if (!path.relative(repo, directory).startsWith(".."))
    throw new Error("raw evidence must be outside the Git tree");
  failureDirectory = directory;
  if (!/^[\w-]+$/.test(window)) throw new Error("invalid window name");
  const count = Number(countArg),
    seed = Number(seedArg),
    latency = Number(latencyArg);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > policy.maxBatchPairs ||
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    ![0, 25].includes(latency) ||
    (phase === "concurrency" && count > 5)
  )
    throw new Error(
      "batch 1..8, concurrency 1..5, uint32 seed and latency 0|25 required",
    );
  await fs.mkdir(directory, { recursive: true });
  const lockFile = "/tmp/zimage-apparel-performance.lock";
  const lock = await fs.open(lockFile, "wx", 0o600);
  await lock.writeFile(
    JSON.stringify({
      pid: process.pid,
      directory,
      startedAt: new Date().toISOString(),
    }),
  );
  await lock.close();
  process.once("exit", () => {
    try {
      unlinkSync(lockFile);
    } catch {}
  });
  const manifestFile = path.join(directory, "fixtures/manifest.json");
  const bundle = path.join(directory, "benchmark.cjs");
  await esbuild.build({
    entryPoints: [path.join(scriptDir, "apparel-performance-benchmark.ts")],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["sharp"],
    tsconfig: path.join(web, "tsconfig.json"),
  });
  try {
    await fs.symlink(
      path.join(web, "node_modules"),
      path.join(directory, "node_modules"),
      "dir",
    );
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  async function fingerprint() {
    return {
      manifestSha256: hash(await fs.readFile(manifestFile)),
      benchmarkSha256: hash(await fs.readFile(bundle)),
      runnerSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
      policySha256: hash(
        Buffer.concat(
          await Promise.all(
            [
              "apparel-performance-policy.mjs",
              "apparel-performance-statistics.mjs",
              "apparel-performance-safety.mjs",
            ].map((f) => fs.readFile(path.join(scriptDir, f))),
          ),
        ),
      ),
      node: process.version,
      sharp: JSON.stringify(sharp.versions),
      platform: `${process.platform}/${process.arch}`,
      cpu: JSON.stringify({
        availableParallelism: availableParallelism(),
        models: [...new Set(cpus().map((c) => c.model))],
      }),
    };
  }
  async function resource() {
    const [current, max, info] = await Promise.all([
      fs.readFile("/sys/fs/cgroup/memory.current", "utf8"),
      fs.readFile("/sys/fs/cgroup/memory.max", "utf8"),
      fs.readFile("/proc/meminfo", "utf8"),
    ]);
    return readMemoryResource(current, max, info);
  }
  async function assertQuiet(ownedChildPid) {
    if (stoppingSignal) throw new Error(`interrupted: ${stoppingSignal}`);
    const names = await fs.readdir("/proc");
    for (const name of names.filter((n) => /^\d+$/.test(n))) {
      if (Number(name) === process.pid || Number(name) === ownedChildPid)
        continue;
      let cmd;
      try {
        cmd = (await fs.readFile(`/proc/${name}/cmdline`, "utf8")).replaceAll(
          "\0",
          " ",
        );
      } catch {
        continue;
      }
      const args = cmd.trim().split(" ");
      if (
        path.basename(args[0] ?? "").startsWith("node") &&
        args.some((a) =>
          /(?:run-apparel-performance\.mjs|benchmark\.cjs)$/.test(a),
        )
      )
        throw new Error(`competing benchmark PID ${name}; do not measure`);
      if (isCompetingCommand(cmd))
        throw new Error(`competing workload PID ${name}; do not measure`);
    }
  }
  await assertQuiet();
  if ((await resource()).safeRemainingBytes < policy.minHeadroomBytes)
    throw new Error("insufficient local headroom");
  if (phase === "prepare") {
    // Never silently replace prior inputs or evidence.
    try {
      await fs.access(manifestFile);
      throw new Error(
        "fixtures already prepared; use a new evidence directory",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const manifest = await createFixtures(
      sharp,
      path.dirname(manifestFile),
      async () => {
        if ((await resource()).safeRemainingBytes < policy.minHeadroomBytes)
          throw new Error("fixture preparation headroom lost");
      },
    );
    await fs.writeFile(
      path.join(directory, "fingerprint.json"),
      JSON.stringify(await fingerprint(), null, 2),
    );
    console.log(
      JSON.stringify({
        prepared: manifest.cases.map((c) => ({
          name: c.name,
          pixels: c.pixels,
          padded: c.padded,
        })),
      }),
    );
    process.exit(0);
  }
  const frozen = JSON.parse(
    await fs.readFile(path.join(directory, "fingerprint.json"), "utf8"),
  );
  assertCompatible(await fingerprint(), frozen);
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  let batches = [];
  const files = await fs.readdir(directory);
  for (const file of files.filter(
    (f) => f.startsWith("batch-") && f.endsWith(".json"),
  )) {
    const batch = JSON.parse(
      await fs.readFile(path.join(directory, file), "utf8"),
    );
    assertCompatible(frozen, batch.fingerprint);
    batches.push(batch);
  }
  batches = chronologicalBatches(batches);
  async function child(childPhase, mode, index, concurrency = 1) {
    await assertQuiet();
    assertCompatible(await fingerprint(), frozen);
    const output = path.join(
      directory,
      `${phase}-${caseName}-${window}-${seed}-${latency}-${mode}-${index}.json`,
    );
    const admission = await resource();
    const knownPeaks = batches
      .filter((b) => b.caseName === caseName)
      .flatMap((b) => b.children.map((c) => c.processMaxRssBytes));
    const required =
      concurrency > 1
        ? requiredHeadroom(
            Math.max(128 * 1024 * 1024, ...knownPeaks),
            concurrency,
          )
        : policy.minHeadroomBytes;
    if (admission.safeRemainingBytes < required)
      throw new Error(
        `child admission blocked: need ${required}, available ${admission.safeRemainingBytes}`,
      );
    try {
      await fs.access(output);
      throw new Error("refusing to overwrite trial");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const proc = spawn(
        process.execPath,
        [
          "--expose-gc",
          bundle,
          childPhase,
          manifestFile,
          caseName,
          output,
          String(concurrency),
          mode,
          String(latency),
        ],
        { cwd: repo, stdio: ["ignore", "pipe", "pipe"] },
      );
      let aborted,
        done = false,
        checking = false,
        killTimer;
      const log = [];
      proc.stdout.on("data", (b) => log.push(b));
      proc.stderr.on("data", (b) => log.push(b));
      const abort = (reason) => {
        if (done || aborted) return;
        aborted = reason;
        proc.kill("SIGTERM");
        killTimer = setTimeout(() => proc.kill("SIGKILL"), 5000);
      };
      ownedAbort = abort;
      const timeout = setTimeout(
        () => abort("180s child timeout"),
        policy.childTimeoutMs,
      );
      const watchdog = setInterval(async () => {
        if (checking || done || aborted) return;
        checking = true;
        try {
          await assertQuiet(proc.pid);
          if ((await resource()).safeRemainingBytes < policy.abortHeadroomBytes)
            abort("128MiB headroom lost");
        } catch (e) {
          abort(e.message);
        } finally {
          checking = false;
        }
      }, 250);
      const finish = async (code, signal, error) => {
        if (done) return;
        done = true;
        ownedAbort = undefined;
        clearInterval(watchdog);
        clearTimeout(timeout);
        clearTimeout(killTimer);
        await fs.writeFile(`${output}.log`, Buffer.concat(log));
        if (error || code !== 0 || aborted) {
          await fs.writeFile(
            `${output}.aborted.json`,
            JSON.stringify({
              code,
              signal,
              reason: aborted ?? error?.message ?? "child failure",
              admission,
            }),
          );
          reject(
            error ??
              new Error(
                `child failed: ${code}/${signal}, ${aborted ?? "see log"}`,
              ),
          );
        } else resolve();
      };
      proc.once("error", (e) => void finish(null, null, e));
      proc.once("exit", (code, signal) => void finish(code, signal));
    });
    await assertQuiet();
    const result = JSON.parse(await fs.readFile(output, "utf8"));
    if (!result.inputsUnchanged || result.retainedAfterBytes !== 0)
      throw new Error("child source integrity/release failure");
    return {
      ...result,
      admission,
      requiredHeadroomBytes: required,
      launchToCompletionMs: performance.now() - start,
    };
  }
  if (phase !== "report") {
    if (!manifest.cases.some((c) => c.name === caseName))
      throw new Error("unknown fixture");
    const batchFile = path.join(
      directory,
      `batch-${phase}-${caseName}-${window}-${seed}-${latency}.json`,
    );
    try {
      await fs.access(batchFile);
      throw new Error("batch exists; use a new seed/window");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const windowFile = path.join(directory, `window-${phase}-${window}.json`);
    let windowRecord;
    try {
      windowRecord = JSON.parse(await fs.readFile(windowFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      windowRecord = {
        startedAt: new Date().toISOString(),
        openingResource: await resource(),
      };
      await fs.writeFile(windowFile, JSON.stringify(windowRecord, null, 2), {
        flag: "wx",
      });
    }
    const batch = {
      windowStartedAt: windowRecord.startedAt,
      phase,
      caseName,
      seed,
      latency,
      window,
      policy,
      fingerprint: frozen,
      startedAt: new Date().toISOString(),
      pairs: [],
      children: [],
    };
    const reference = batches.find((b) => b.caseName === caseName)?.children[0]
      ?.trials[0]?.digest;
    let digest = reference;
    const orders = balancedOrders(phase === "concurrency" ? 1 : count, seed);
    for (const [index, order] of orders.entries()) {
      const entries = [];
      for (const letter of order) {
        const result = await child(
          phase,
          letter === "R" ? "reuse" : "baseline",
          index,
          phase === "concurrency" ? count : 1,
        );
        digest ??= result.trials[0].digest;
        for (const trial of [
          ...(result.warmup ? [result.warmup] : []),
          ...result.trials,
        ])
          assertTrial(trial, digest, { concurrent: phase === "concurrency" });
        entries.push(result);
        batch.children.push(result);
      }
      const baseline = entries.find((e) => e.mode === "baseline"),
        reuse = entries.find((e) => e.mode === "reuse");
      batch.pairs.push({
        index,
        order,
        window,
        windowStartedAt: windowRecord.startedAt,
        baselineMs: baseline.trials[0].elapsedMs,
        reuseMs: reuse.trials[0].elapsedMs,
      });
      // Checkpoint completed pairs outside the claim timings.
      await fs.writeFile(batchFile, JSON.stringify(batch, null, 2));
      console.log(
        JSON.stringify({
          phase,
          caseName,
          pair: index + 1,
          count: orders.length,
          baselineMs: baseline.trials[0].elapsedMs,
          reuseMs: reuse.trials[0].elapsedMs,
          reads: [baseline.trials[0].reads, reuse.trials[0].reads],
          digest,
          released: true,
        }),
      );
    }
    batch.endedAt = new Date().toISOString();
    batch.pairs = batch.pairs.map((row) => ({
      ...row,
      batchStartedAt: batch.startedAt,
      batchEndedAt: batch.endedAt,
    }));
    await fs.writeFile(batchFile, JSON.stringify(batch, null, 2));
    batches.push(batch);
  }
  batches = chronologicalBatches(batches);
  const blockers = evidenceBlockers(await fs.readdir(directory), batches);
  const cases = manifest.cases.map((fixture) => {
    const own = batches.filter(
      (b) => b.caseName === fixture.name && b.latency === 0 && b.endedAt,
    );
    const warm = own.filter((b) => b.phase === "warm").flatMap((b) => b.pairs);
    const cold = own.filter((b) => b.phase === "cold").flatMap((b) => b.pairs);
    return {
      name: fixture.name,
      ...evaluateCase(warm, cold, blockers),
      coldPairs: cold.length,
      warmPairs: warm.length,
      reads: [
        ...new Set(
          own.flatMap((b) =>
            b.children.flatMap((c) =>
              c.trials.map((t) => `${c.mode}:${t.reads}`),
            ),
          ),
        ),
      ],
      sampledCachePeakBytes: Math.max(
        0,
        ...own.flatMap((b) =>
          b.children.flatMap((c) => c.trials.map((t) => t.retainedPeakBytes)),
        ),
      ),
      maxRssBytes: Math.max(
        0,
        ...own.flatMap((b) => b.children.map((c) => c.processMaxRssBytes)),
      ),
    };
  });
  const summary = {
    fingerprint: frozen,
    policy,
    blockers,
    cases,
    accepted: cases.every((c) => c.accepted),
    productionFlagsChanged: false,
    scope:
      "offline screening only; independent child modes; no network/provider/ZIP/browser measurement",
  };
  await fs.writeFile(
    path.join(directory, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  if (phase === "report") console.log(JSON.stringify(summary, null, 2));
}
void main().catch(async (error) => {
  if (failureDirectory) {
    try {
      await fs.mkdir(failureDirectory, { recursive: true });
      await fs.writeFile(
        path.join(failureDirectory, `run-failure-${randomUUID()}.json`),
        JSON.stringify({ at: new Date().toISOString(), reason: error.message }),
      );
    } catch {}
  }
  console.error(error);
  process.exitCode = 1;
});
