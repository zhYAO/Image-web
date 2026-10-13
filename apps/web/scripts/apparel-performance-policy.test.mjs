import assert from "node:assert/strict";
import { test } from "node:test";
import {
  policy,
  assertTrial,
  assertCompatible,
  evaluateCase,
  chronologicalBatches,
  evidenceBlockers,
  isCompetingCommand,
} from "./apparel-performance-policy.mjs";
import { balancedOrders } from "./apparel-performance-fixtures.mjs";
import { readMemoryResource } from "./apparel-performance-safety.mjs";

const rows = (n, ratio = 0.9) =>
  Array.from({ length: n }, (_, i) => ({
    baselineMs: 100 + i,
    reuseMs: (100 + i) * ratio,
    order: i % 2 ? "BR" : "RB",
    window: i % 3 ? "a" : "b",
    windowStartedAt: i % 3 ? "2026-10-13T12:00:00Z" : "2026-10-13T12:10:00Z",
    batchStartedAt: i % 3 ? "2026-10-13T12:00:00Z" : "2026-10-13T12:10:00Z",
    batchEndedAt: i % 3 ? "2026-10-13T12:01:00Z" : "2026-10-13T12:11:00Z",
  }));
test("small apparently fast samples never pass the frozen gate", () => {
  const result = evaluateCase(rows(4), rows(1));
  assert.equal(result.accepted, false);
  assert.equal(result.decision, "pending");
  assert.equal(result.comparison, null);
  assert.equal(policy.minWarmPairs, 40);
});
test("requires independent windows and cold coverage even with 40 warm pairs", () => {
  assert.equal(
    evaluateCase(
      rows(40).map((r) => ({ ...r, window: "a" })),
      rows(10),
    ).accepted,
    false,
  );
  assert.equal(evaluateCase(rows(40), rows(9)).accepted, false);
});
test("complete synthetic evidence passes and regression fails without relaxing thresholds", () => {
  assert.equal(evaluateCase(rows(40), rows(10)).accepted, true);
  const result = evaluateCase(rows(40, 1.08), rows(10, 1.08));
  assert.equal(result.accepted, false);
  assert.equal(result.decision, "failed");
  assert.equal(policy.maxRegressionPercent, 5);
});
test("rejects output mismatch, cache overflow and incomplete release", () => {
  const digest = "a".repeat(64);
  const trial = {
    digest,
    retainedAfterBytes: 0,
    retainedPeakBytes: 10,
    outputs: 11,
  };
  assertTrial(trial, digest);
  for (const mutation of [
    { digest: "changed" },
    { retainedAfterBytes: 1 },
    { retainedPeakBytes: 8 * 1024 * 1024 + 1 },
  ])
    assert.throws(() => assertTrial({ ...trial, ...mutation }, digest));
});
test("concurrent claim snapshots may contain other claims' bytes; wave must release", () => {
  const digest = "a".repeat(64);
  const trial = {
    digest,
    retainedAfterBytes: 8,
    retainedPeakBytes: 32 * 1024 * 1024,
    outputs: 11,
  };
  assertTrial(trial, digest, { concurrent: true });
  assert.throws(() =>
    assertTrial({ ...trial, retainedPeakBytes: 32 * 1024 * 1024 + 1 }, digest, {
      concurrent: true,
    }),
  );
});
test("renaming adjacent windows cannot satisfy window independence", () => {
  const adjacent = rows(40).map((r) => ({
    ...r,
    batchStartedAt: "2026-10-13T12:00:00Z",
    batchEndedAt: "2026-10-13T12:01:00Z",
  }));
  assert.equal(evaluateCase(adjacent, rows(10)).accepted, false);
});
test("cold labels cannot falsify actual warm-window separation or cold order balance", () => {
  const warm = rows(40).map((r) => ({
    ...r,
    batchStartedAt: "2026-10-13T13:00:00Z",
    batchEndedAt: "2026-10-13T13:01:00Z",
  }));
  assert.equal(evaluateCase(warm, rows(10)).accepted, false);
  assert.equal(
    evaluateCase(
      rows(40),
      rows(10).map((r) => ({ ...r, order: "BR" })),
    ).accepted,
    false,
  );
});
test("rejects changed code, fixtures or runtime before aggregating measurements", () => {
  const fingerprint = Object.fromEntries(
    [
      "manifestSha256",
      "benchmarkSha256",
      "runnerSha256",
      "policySha256",
      "node",
      "sharp",
      "platform",
      "cpu",
    ].map((k) => [k, "fixed"]),
  );
  assertCompatible(fingerprint, fingerprint);
  for (const key of Object.keys(fingerprint))
    assert.throws(() =>
      assertCompatible(fingerprint, { ...fingerprint, [key]: "changed" }),
    );
});
test("chronological blocks ignore filenames, seed order and directory enumeration", () => {
  const earlier = { startedAt: "2026-10-13T12:00:00Z", seed: 999 };
  const later = { startedAt: "2026-10-13T12:10:00Z", seed: 1 };
  assert.deepEqual(chronologicalBatches([later, earlier]), [earlier, later]);
  assert.throws(() => chronologicalBatches([{}]));
});
test("aborts, correctness rejection and incomplete batches veto later clean evidence", () => {
  const blockers = evidenceBlockers(
    ["child.aborted.json", "run-failure-warm.json"],
    [{ phase: "warm", caseName: "normal", seed: 1 }],
  );
  assert.equal(blockers.length, 3);
  const result = evaluateCase(rows(40), rows(10), blockers);
  assert.equal(result.accepted, false);
  assert.equal(result.decision, "failed");
});
test("balanced pair order is reproducible but changes with the random seed", () => {
  assert.deepEqual(balancedOrders(8, 100), balancedOrders(8, 100));
  assert.ok(
    new Set(
      Array.from({ length: 32 }, (_, i) =>
        JSON.stringify(balancedOrders(8, i)),
      ),
    ).size > 1,
  );
  assert.equal(balancedOrders(8, 100).filter((o) => o === "BR").length, 4);
});
test("single-pair cold pilots randomize the first mode across seeds", () => {
  assert.equal(
    new Set(Array.from({ length: 32 }, (_, i) => balancedOrders(1, i)[0])).size,
    2,
  );
});
test("headroom uses the tighter cgroup/host bound and rejects missing metrics", () => {
  assert.equal(
    readMemoryResource("500", "1000", "MemAvailable: 2 kB").safeRemainingBytes,
    500,
  );
  assert.equal(
    readMemoryResource("0", "max", "MemAvailable: 2 kB").safeRemainingBytes,
    2048,
  );
  assert.throws(() => readMemoryResource("bad", "max", "missing"));
});
test("quiet guard detects renamed Node test/build processes as well as CLI paths", () => {
  for (const command of [
    "node (vitest)",
    "node (vitest 1)",
    "next-build (v16.3.0)",
    "next-server (v16.3.0)",
    "/node /repo/node_modules/.bin/tsc --noEmit",
    "/node next dev",
    "pnpm exec eslint apps/web",
  ])
    assert.equal(isCompetingCommand(command), true, command);
  assert.equal(
    isCompetingCommand("/node --expose-gc /evidence/benchmark.cjs"),
    false,
  );
});
