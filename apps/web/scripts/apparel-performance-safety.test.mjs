import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requiredHeadroom,
  assertOutputDigests,
  assertPilotFingerprint,
  readMemoryResource,
} from "./apparel-performance-safety.mjs";
test("measured peak and concurrency grow the child admission gate", () => {
  assert.equal(requiredHeadroom(100 * 1024 * 1024, 1), 768 * 1024 * 1024);
  assert.equal(
    requiredHeadroom(512 * 1024 * 1024, 5),
    512 * 1024 * 1024 * 5 * 1.3 + 256 * 1024 * 1024,
  );
  assert.throws(() => requiredHeadroom(NaN, 2));
});
test("concurrent results must equal the serial reference, not just each other", () => {
  assertOutputDigests([{ digest: "serial" }, { digest: "serial" }], "serial");
  assert.throws(() =>
    assertOutputDigests(
      [{ digest: "changed" }, { digest: "changed" }],
      "serial",
    ),
  );
  assert.throws(() => assertOutputDigests([], "serial"));
});
test("pilot admission is bound to both inputs and measurement code", () => {
  const current = {
    manifestSha256: "a".repeat(64),
    benchmarkSha256: "b".repeat(64),
    runnerSha256: "c".repeat(64),
  };
  assertPilotFingerprint(current, { ...current });
  for (const field of Object.keys(current))
    assert.throws(() =>
      assertPilotFingerprint(current, { ...current, [field]: "d".repeat(64) }),
    );
  assert.throws(() => assertPilotFingerprint(current, undefined));
});
test("resource readings fail closed on missing or invalid metrics", () => {
  assert.equal(
    readMemoryResource("1024", "2048", "MemAvailable: 4 kB").safeRemainingBytes,
    1024,
  );
  assert.equal(
    readMemoryResource("1024", "max", "MemAvailable: 4 kB").safeRemainingBytes,
    4096,
  );
  for (const args of [
    ["bad", "2048", "MemAvailable: 4 kB"],
    ["1024", "bad", "MemAvailable: 4 kB"],
    ["1024", "2048", "MemTotal: 4 kB"],
    ["", "2048", "MemAvailable: 4 kB"],
    ["1024", "Infinity", "MemAvailable: 4 kB"],
  ])
    assert.throws(() => readMemoryResource(...args));
});
