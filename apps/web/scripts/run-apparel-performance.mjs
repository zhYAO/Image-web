// Usage: node apps/web/scripts/run-apparel-performance.mjs /absolute/task-directory [prepare|pilot|measure]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { createFixtures } from "./apparel-performance-fixtures.mjs";
import {
  comparePaired,
  describeSamples,
} from "./apparel-performance-statistics.mjs";
import {
  requiredHeadroom,
  assertOutputDigests,
  assertPilotFingerprint,
  readMemoryResource,
} from "./apparel-performance-safety.mjs";
const scriptDir = path.dirname(fileURLToPath(import.meta.url)),
  web = path.resolve(scriptDir, ".."),
  repo = path.resolve(web, "../..");
const require = createRequire(path.join(web, "package.json"));
const sharp = require("sharp");
const esbuild = createRequire(
  createRequire(require.resolve("vitest/package.json")).resolve(
    "vite/package.json",
  ),
)("esbuild");
const [directoryArg, phase = "prepare"] = process.argv.slice(2);
if (
  !directoryArg ||
  !path.isAbsolute(directoryArg) ||
  !["prepare", "pilot", "measure"].includes(phase)
)
  throw new Error("absolute task directory and prepare|pilot|measure required");
const directory = path.resolve(directoryArg);
await fs.mkdir(directory, { recursive: true });
const manifestFile = path.join(directory, "fixtures", "manifest.json"),
  bundle = path.join(directory, "benchmark.cjs");
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
async function resource() {
  const [current, max, info] = await Promise.all([
    fs.readFile("/sys/fs/cgroup/memory.current", "utf8"),
    fs.readFile("/sys/fs/cgroup/memory.max", "utf8"),
    fs.readFile("/proc/meminfo", "utf8"),
  ]);
  return readMemoryResource(current, max, info);
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fingerprint() {
  return {
    manifestSha256: sha(await fs.readFile(manifestFile)),
    benchmarkSha256: sha(await fs.readFile(bundle)),
    runnerSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
  };
}
let runFingerprint;
if (phase !== "prepare") runFingerprint = await fingerprint();
const pilotPeaks = new Map();
if (phase === "measure") {
  const pilots = JSON.parse(
    await fs.readFile(path.join(directory, "pilot-summary.json"), "utf8"),
  );
  assertPilotFingerprint(runFingerprint, pilots.fingerprint);
  for (const p of pilots.cases)
    if (p.processMaxRssBytes) pilotPeaks.set(p.caseName, p.processMaxRssBytes);
}
async function child(
  step,
  caseName,
  count = 1,
  mode = "baseline",
  latency = 25,
  suffix = "",
) {
  assertPilotFingerprint(runFingerprint, await fingerprint());
  const output = path.join(
    directory,
    `${step}-${caseName}-${mode}${suffix}.json`,
  );
  const before = await resource();
  const required =
    phase === "measure"
      ? requiredHeadroom(
          pilotPeaks.get(caseName),
          step === "concurrency" ? count : 1,
        )
      : 768 * 1024 * 1024;
  if (before.safeRemainingBytes < required)
    throw new Error(
      `child admission blocked ${step}/${caseName}: headroom ${before.safeRemainingBytes}, required ${required}`,
    );
  const started = performance.now();
  await new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        "--expose-gc",
        bundle,
        step,
        manifestFile,
        caseName,
        output,
        String(count),
        mode,
        String(latency),
      ],
      { cwd: repo, stdio: ["ignore", "inherit", "inherit"] },
    );
    let checking = false,
      aborted = false;
    const watchdog = setInterval(async () => {
      if (checking || aborted) return;
      checking = true;
      try {
        const now = await resource();
        if (now.safeRemainingBytes < 128 * 1024 * 1024) {
          aborted = true;
          p.kill("SIGTERM");
          await fs.writeFile(
            output + ".aborted.json",
            JSON.stringify(
              {
                step,
                caseName,
                mode,
                resource: now,
                reason:
                  "watchdog low128MiB headroom; only owned child terminated",
              },
              null,
              2,
            ) + "\n",
          );
        }
      } catch (error) {
        aborted = true;
        p.kill("SIGTERM");
        console.error(error);
      } finally {
        checking = false;
      }
    }, 250);
    p.on("error", (error) => {
      clearInterval(watchdog);
      reject(error);
    });
    p.on("exit", (code, signal) => {
      clearInterval(watchdog);
      if (code === 0 && !aborted) resolve();
      else
        reject(new Error(`child failed ${code}/${signal}, aborted=${aborted}`));
    });
  });
  const value = JSON.parse(await fs.readFile(output, "utf8"));
  value.fingerprint = runFingerprint;
  value.admissionResource = before;
  value.requiredHeadroomBytes = required;
  value.watchdogIntervalMs = 250;
  value.launchToCompletionMs = performance.now() - started;
  await fs.writeFile(output, JSON.stringify(value, null, 2) + "\n");
  return value;
}
const initialResource = await resource();
await fs.writeFile(
  path.join(directory, `resource-${phase}.json`),
  JSON.stringify(initialResource, null, 2) + "\n",
);
if (initialResource.safeRemainingBytes < 512 * 1024 * 1024)
  throw new Error(
    "less than512MiB headroom; retain defaults off and leave benchmark pending",
  );
if (phase === "prepare") {
  await fs.rm(path.join(directory, "pilot-summary.json"), { force: true });
  const manifest = await createFixtures(
    sharp,
    path.dirname(manifestFile),
    async () => {
      if ((await resource()).safeRemainingBytes < 512 * 1024 * 1024)
        throw new Error(
          "fixture preparation paused:512MiB headroom unavailable",
        );
    },
  );
  console.log(
    JSON.stringify({
      prepared: true,
      cases: manifest.cases.map((c) => ({
        name: c.name,
        pixels: c.pixels,
        encodedBytes: c.sources.map((s) => s.bytes),
      })),
    }),
  );
} else {
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")),
    summary = {
      phase,
      fingerprint: runFingerprint,
      initialResource,
      cases: [],
      concurrency: [],
    };
  for (const fixture of manifest.cases) {
    const r = await resource();
    if (r.safeRemainingBytes < 768 * 1024 * 1024) {
      summary.cases.push({
        name: fixture.name,
        blocked: "less than768MiB measured-workload headroom",
        resource: r,
      });
      continue;
    }
    if (phase === "pilot") {
      summary.cases.push(await child("pilot", fixture.name, 1));
      continue;
    }
    const warm = await child("steady", fixture.name, 120);
    const cold = [];
    for (let i = 0; i < 5; i++)
      for (const mode of i % 2 ? ["reuse", "baseline"] : ["baseline", "reuse"])
        cold.push(await child("cold", fixture.name, 1, mode, 25, `-${i}`));
    const memory = [];
    for (const mode of ["baseline", "reuse"])
      memory.push(await child("memory", fixture.name, 3, mode));
    pilotPeaks.set(
      fixture.name,
      Math.max(
        pilotPeaks.get(fixture.name),
        ...memory.map((c) => c.processMaxRssBytes),
      ),
    );
    const comparison = comparePaired(warm.pairs);
    const groups = Object.fromEntries(
      ["BR", "RB"].map((order) => [
        order,
        comparePaired(warm.pairs.filter((p) => p.order === order)),
      ]),
    );
    const thirds = Array.from({ length: 3 }, (_, i) =>
      comparePaired(warm.pairs.slice(i * 40, (i + 1) * 40)),
    );
    const coldSummary = Object.fromEntries(
      ["baseline", "reuse"].map((mode) => [
        mode,
        {
          firstSet: describeSamples(
            cold
              .filter((c) => c.mode === mode)
              .map((c) => c.trials[0].elapsedMs),
          ),
          launchToCompletion: describeSamples(
            cold
              .filter((c) => c.mode === mode)
              .map((c) => c.launchToCompletionMs),
          ),
          p95Interpretation:
            "five launches do not support a cold-tail claim; report min/median/max",
        },
      ]),
    );
    const allDigests = [
      ...warm.pairs.flatMap((p) => [p.baseline.digest, p.reuse.digest]),
      ...cold.flatMap((c) => c.trials.map((t) => t.digest)),
      ...memory.flatMap((c) => c.trials.map((t) => t.digest)),
    ];
    if (new Set(allDigests).size !== 1)
      throw new Error("cross-process output hash mismatch");
    summary.cases.push({
      name: fixture.name,
      comparison,
      orderGroups: groups,
      chronologicalThirds: thirds,
      cold: coldSummary,
      memory: memory.map((c) => ({
        mode: c.mode,
        startupRssBytes: c.startupRssBytes,
        preloadRssBytes: c.preloadRssBytes,
        processMaxRssBytes: c.processMaxRssBytes,
        retainedPeakBytes: Math.max(
          ...c.trials.map((t) => t.retainedPeakBytes),
        ),
        retainedAfterBytes: c.retainedAfterBytes,
      })),
      allOutputHashesIdentical: true,
      digest: allDigests[0],
      acceptance:
        "defaults remain off; intervals and drift require review; synthetic25ms only",
    });
    for (const concurrency of [2, 5])
      for (const mode of ["baseline", "reuse"]) {
        const before = await resource(),
          single = memory.find((c) => c.mode === mode).processMaxRssBytes;
        const required = requiredHeadroom(single, concurrency);
        if (before.safeRemainingBytes < required) {
          summary.concurrency.push({
            name: fixture.name,
            concurrency,
            mode,
            skipped: true,
            requiredBytes: required,
            resource: before,
          });
          continue;
        }
        const wave = await child(
          "concurrency",
          fixture.name,
          concurrency,
          mode,
        );
        assertOutputDigests(wave.trials, allDigests[0]);
        const serialReuse = memory.find((c) => c.mode === "reuse").trials[0];
        const reads = wave.trials.reduce((n, t) => n + t.reads, 0);
        const estimatedAdmission = concurrency * serialReuse.retainedPeakBytes;
        summary.concurrency.push({
          name: fixture.name,
          concurrency,
          mode,
          wallMs: wave.wallMs,
          processMaxRssBytes: wave.processMaxRssBytes,
          retainedPeakBytes: Math.max(
            ...wave.trials.map((t) => t.retainedPeakBytes),
          ),
          retainedAfterBytes: wave.retainedAfterBytes,
          allOutputHashesEqualSerial: true,
          estimatedAdmissionFromSerialBytes: estimatedAdmission,
          reads,
          serialReuseReads: serialReuse.reads,
          extraReadsVsSerialReuse: reads - concurrency * serialReuse.reads,
          budgetContentionObserved:
            mode === "reuse" &&
            estimatedAdmission > 32 * 1024 * 1024 &&
            reads > concurrency * serialReuse.reads,
          scope:
            "one local simulated wave; not sustained production concurrency",
        });
      }
    await fs.writeFile(
      path.join(directory, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
  }
  await fs.writeFile(
    path.join(directory, `${phase}-summary.json`),
    JSON.stringify(summary, null, 2) + "\n",
  );
}
