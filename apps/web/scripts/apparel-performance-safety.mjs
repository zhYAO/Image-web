export function requiredHeadroom(singlePeakBytes, concurrency = 1) {
  if (
    !Number.isFinite(singlePeakBytes) ||
    singlePeakBytes <= 0 ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1
  )
    throw new RangeError("positive peak and concurrency required");
  return Math.max(
    768 * 1024 * 1024,
    singlePeakBytes * concurrency * 1.3 + 256 * 1024 * 1024,
  );
}
export function assertOutputDigests(trials, reference) {
  if (
    !reference ||
    !trials.length ||
    trials.some((t) => t.digest !== reference)
  )
    throw new Error("wave output differs from serial reference");
}
export function assertPilotFingerprint(current, saved) {
  const fields = ["manifestSha256", "benchmarkSha256", "runnerSha256"];
  if (
    fields.some(
      (k) =>
        !/^[a-f0-9]{64}$/.test(current?.[k] ?? "") || current[k] !== saved?.[k],
    )
  )
    throw new Error(
      "pilot input/code fingerprint changed; repeat pilot before measuring",
    );
}
export function readMemoryResource(currentText, maxText, info) {
  const currentValue = currentText.trim(),
    maxValue = maxText.trim();
  const current = /^\d+$/.test(currentValue) ? Number(currentValue) : NaN,
    max =
      maxValue === "max"
        ? Infinity
        : /^\d+$/.test(maxValue)
          ? Number(maxValue)
          : NaN;
  const match = info.match(/MemAvailable:\s+(\d+)/),
    available = match ? Number(match[1]) * 1024 : NaN;
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    !(max === Infinity || (Number.isSafeInteger(max) && max > 0)) ||
    !Number.isSafeInteger(available) ||
    available < 0
  )
    throw new Error("memory metrics unavailable; do not admit workload");
  return {
    cgroupCurrentBytes: current,
    cgroupMaxBytes: max === Infinity ? null : max,
    memAvailableBytes: available,
    safeRemainingBytes: Math.max(0, Math.min(max - current, available)),
  };
}
