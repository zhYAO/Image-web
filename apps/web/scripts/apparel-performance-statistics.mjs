// Synthetic fixture statistics; these intervals do not establish a production SLA.
export function seededRandom(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rank(sorted, p) {
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
export function describeSamples(values) {
  if (!values.length || values.some((x) => !Number.isFinite(x) || x < 0))
    throw new RangeError("finite nonnegative samples required");
  return summarize(values);
}
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b),
    mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    count: values.length,
    min: sorted[0],
    p50: rank(sorted, 0.5),
    p90: rank(sorted, 0.9),
    p95: rank(sorted, 0.95),
    max: sorted.at(-1),
    mean,
  };
}
export function comparePaired(
  rows,
  { resamples = 5000, seed = 20261013, blockLength = 5 } = {},
) {
  if (
    !Number.isSafeInteger(resamples) ||
    resamples < 1 ||
    !Number.isSafeInteger(blockLength) ||
    blockLength < 1 ||
    blockLength > rows.length
  )
    throw new RangeError("positive integer bootstrap parameters required");
  if (
    rows.length < 20 ||
    rows.some(
      (r) =>
        !(
          Number.isFinite(r.baselineMs) &&
          Number.isFinite(r.reuseMs) &&
          r.baselineMs > 0 &&
          r.reuseMs > 0
        ),
    )
  )
    throw new RangeError("at least20 positive finite paired samples required");
  const a = describeSamples(rows.map((r) => r.baselineMs)),
    b = describeSamples(rows.map((r) => r.reuseMs));
  function bootstrap(block) {
    const random = seededRandom(seed ^ (block ? 0xa523 : 0)),
      deltas = [],
      ratios = [];
    for (let k = 0; k < resamples; k++) {
      const x = [],
        y = [];
      while (x.length < rows.length) {
        const start = Math.floor(random() * rows.length);
        for (
          let j = 0;
          j < (block ? blockLength : 1) && x.length < rows.length;
          j++
        ) {
          const r = rows[(start + j) % rows.length];
          x.push(r.baselineMs);
          y.push(r.reuseMs);
        }
      }
      x.sort((u, v) => u - v);
      y.sort((u, v) => u - v);
      const px = rank(x, 0.95),
        py = rank(y, 0.95);
      deltas.push(py - px);
      ratios.push((py / px - 1) * 100);
    }
    deltas.sort((u, v) => u - v);
    ratios.sort((u, v) => u - v);
    return {
      delta: [rank(deltas, 0.025), rank(deltas, 0.975)],
      ratioPercent: [rank(ratios, 0.025), rank(ratios, 0.975)],
    };
  }
  const paired = bootstrap(false),
    block = bootstrap(true);
  return {
    baseline: a,
    reuse: b,
    deltaMs: b.p95 - a.p95,
    deltaPercent: (b.p95 / a.p95 - 1) * 100,
    pairedDeltaCi95: paired.delta,
    pairedRatioCi95Percent: paired.ratioPercent,
    blockDeltaCi95: block.delta,
    blockRatioCi95Percent: block.ratioPercent,
    pairedDifference: summarize(rows.map((r) => r.reuseMs - r.baselineMs)),
    zeroRegressionSupported: paired.delta[1] <= 0 && block.delta[1] <= 0,
    resamples,
    seed,
    blockLength,
    scope:
      "per-case exploratory paired/circular-block bootstrap; not simultaneous multi-case or real-load proof",
  };
}
