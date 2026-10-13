import {
  comparePaired,
  describeSamples,
} from "./apparel-performance-statistics.mjs";

// Frozen before measurements; screening and acceptance are distinct decisions.
export const policy = Object.freeze({
  version: 1,
  maxBatchPairs: 8,
  minWarmPairs: 40,
  minWindows: 2,
  minWindowSeparationMs: 300000,
  minColdPairs: 10,
  maxRegressionPercent: 5,
  minHeadroomBytes: 768 * 1024 * 1024,
  abortHeadroomBytes: 128 * 1024 * 1024,
  childTimeoutMs: 180000,
});

export function assertTrial(trial, reference, { concurrent = false } = {}) {
  if (
    !trial ||
    !/^[a-f0-9]{64}$/.test(reference) ||
    trial.digest !== reference ||
    (!concurrent && trial.retainedAfterBytes !== 0) ||
    !Number.isFinite(trial.retainedPeakBytes) ||
    trial.retainedPeakBytes < 0 ||
    trial.retainedPeakBytes > (concurrent ? 32 : 8) * 1024 * 1024 ||
    trial.outputs < 11
  )
    throw new Error("output/accounting correctness gate failed");
}

export function assertCompatible(current, saved) {
  for (const field of [
    "manifestSha256",
    "benchmarkSha256",
    "runnerSha256",
    "policySha256",
    "node",
    "sharp",
    "platform",
    "cpu",
  ])
    if (!current?.[field] || current[field] !== saved?.[field])
      throw new Error(`measurement fingerprint changed: ${field}`);
}

const medianChange = (rows) => {
  const a = describeSamples(rows.map((r) => r.baselineMs)).p50;
  const b = describeSamples(rows.map((r) => r.reuseMs)).p50;
  return (b / a - 1) * 100;
};

export function chronologicalBatches(batches) {
  if (batches.some((b) => !Number.isFinite(Date.parse(b.startedAt))))
    throw new Error("missing batch chronology");
  return [...batches].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
}

export function evidenceBlockers(files, batches) {
  return [
    ...files.filter(
      (f) => f.startsWith("run-failure-") || f.endsWith(".aborted.json"),
    ),
    ...batches
      .filter((b) => !b.endedAt)
      .map((b) => `incomplete ${b.phase}/${b.caseName}/${b.seed}`),
  ];
}

export function isCompetingCommand(command) {
  // Node tools often replace argv with titles such as "node (vitest 1)" or
  // "next-build (v16.x)"; checking only executable paths misses those workloads.
  return /\bnext-(?:server|build)\b|\bnext\s+(?:dev|build)\b|\b(?:vitest|tsc|eslint|webpack-cli)\b/.test(
    command,
  );
}

export function evaluateCase(warm, cold, blockers = []) {
  const windows = [...new Set(warm.map((r) => r.window))];
  const pending = [];
  if (warm.length < policy.minWarmPairs) pending.push("warm sample count");
  const ranges = windows
    .map((window) => {
      const rows = warm.filter((r) => r.window === window);
      return {
        start: Math.min(...rows.map((r) => Date.parse(r.batchStartedAt))),
        end: Math.max(...rows.map((r) => Date.parse(r.batchEndedAt))),
      };
    })
    .sort((a, b) => a.start - b.start);
  let independentWindows = 0,
    previousEnd = -Infinity;
  for (const { start, end } of ranges) {
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end >= start &&
      start - previousEnd >= policy.minWindowSeparationMs
    ) {
      independentWindows++;
    }
    previousEnd = Math.max(previousEnd, end);
  }
  if (
    windows.length < policy.minWindows ||
    independentWindows < policy.minWindows
  )
    pending.push("independent windows");
  if (cold.length < policy.minColdPairs) pending.push("cold sample count");
  if (
    !cold.some((r) => r.order === "BR") ||
    !cold.some((r) => r.order === "RB")
  )
    pending.push("both cold order groups");
  const comparison = warm.length >= 20 ? comparePaired(warm) : null;
  const medians = Object.fromEntries([
    ...windows.map((w) => [
      `window:${w}`,
      medianChange(warm.filter((r) => r.window === w)),
    ]),
    ...["BR", "RB"]
      .filter((o) => warm.some((r) => r.order === o))
      .map((o) => [
        `order:${o}`,
        medianChange(warm.filter((r) => r.order === o)),
      ]),
    ...(cold.length ? [["cold", medianChange(cold)]] : []),
  ]);
  if (
    !warm.some((r) => r.order === "BR") ||
    !warm.some((r) => r.order === "RB")
  )
    pending.push("both randomized order groups");
  const failures = [
    ...blockers,
    ...Object.entries(medians)
      .filter(([, n]) => n > policy.maxRegressionPercent)
      .map(([k]) => k),
  ];
  if (
    comparison &&
    (comparison.deltaPercent > policy.maxRegressionPercent ||
      comparison.pairedRatioCi95Percent[1] > policy.maxRegressionPercent ||
      comparison.blockRatioCi95Percent[1] > policy.maxRegressionPercent)
  )
    failures.push("P95 or confidence upper bound");
  return {
    accepted: pending.length === 0 && failures.length === 0,
    decision: blockers.length
      ? "failed"
      : pending.length
        ? "pending"
        : failures.length
          ? "failed"
          : "offline-pass",
    independentWindows,
    pending,
    failures,
    medians,
    comparison,
    screening: warm.length
      ? {
          baseline: describeSamples(warm.map((r) => r.baselineMs)),
          reuse: describeSamples(warm.map((r) => r.reuseMs)),
          interpretation:
            "small samples describe observations only; no production latency or RSS claim",
        }
      : null,
  };
}
