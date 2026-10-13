import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSamples,
  comparePaired,
} from "./apparel-performance-statistics.mjs";
test("nearest rank and tail distributions do not hide maxima", () => {
  const d = describeSamples([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(d.p50, 5);
  assert.equal(d.p95, 10);
  assert.equal(d.max, 10);
  assert.equal(d.count, 10);
  assert.throws(() => describeSamples([]));
});
test("paired uncertainty preserves a constant regression and never calls it noise", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    baselineMs: 100 + (i % 5),
    reuseMs: 110 + (i % 5),
  }));
  const d = comparePaired(rows, { resamples: 1000, seed: 17 });
  assert.equal(d.deltaMs, 10);
  assert.equal(d.pairedDifference.p95, 10);
  assert.ok(d.pairedDeltaCi95[0] > 0);
  assert.ok(d.blockDeltaCi95[0] > 0);
  assert.equal(d.zeroRegressionSupported, false);
  assert.deepEqual(d, comparePaired(rows, { resamples: 1000, seed: 17 }));
});
test("zero margin remains zero, rather than allowing ten percent", () => {
  const rows = Array.from({ length: 120 }, () => ({
    baselineMs: 100,
    reuseMs: 101,
  }));
  const d = comparePaired(rows, { resamples: 1000, seed: 18 });
  assert.equal(d.zeroRegressionSupported, false);
});
test("rejects invalid bootstrap bounds and nonfinite timings before sampling", () => {
  const rows = Array.from({ length: 20 }, () => ({
    baselineMs: 100,
    reuseMs: 101,
  }));
  for (const resamples of [0, -1, 1.5, Infinity])
    assert.throws(() => comparePaired(rows, { resamples }));
  for (const blockLength of [0, -1, 1.5, Infinity, 21])
    assert.throws(() => comparePaired(rows, { blockLength }));
  assert.throws(() =>
    comparePaired([...rows.slice(1), { baselineMs: Infinity, reuseMs: 1 }]),
  );
});
