// Run the reusable Node helpers through the existing CI Vitest entry point.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("enforces frozen offline gates, randomized ordering and resource checks", () => {
  const script = resolve("scripts/apparel-performance-policy.test.mjs");
  const result = execFileSync(
    process.execPath,
    ["--test", "--test-reporter=tap", script],
    { encoding: "utf8" },
  );
  expect(result).toContain("# fail 0");
});
