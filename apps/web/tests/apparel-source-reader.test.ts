import { describe, expect, it, vi } from "vitest";
import {
  createSourceBudget,
  createApparelSourceReader,
} from "@/server/apparel/apparel-source-reader";

describe("claim-scoped source admission", () => {
  it("reuses admitted bytes but checks authorization and lease on every hit", async () => {
    const load = vi.fn(async () => new Uint8Array(3));
    const check = vi.fn();
    const budget = createSourceBudget(6);
    const reader = createApparelSourceReader(load, check, {
      maxBytes: 4,
      budget,
    });
    expect(await reader.read("main")).toBe(await reader.read("main"));
    expect(load).toHaveBeenCalledTimes(1);
    check.mockImplementation(() => {
      throw new Error("lease_lost");
    });
    await expect(reader.read("main")).rejects.toThrow("lease_lost");
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(3);
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("bounds claim and process bytes, keeps admitted sources and falls back without eviction", async () => {
    const load = vi.fn(async () => new Uint8Array(3));
    const budget = createSourceBudget(5);
    const a = createApparelSourceReader(load, () => {}, {
      maxBytes: 4,
      budget,
    });
    const b = createApparelSourceReader(load, () => {}, {
      maxBytes: 4,
      budget,
    });
    await a.read("main1");
    await a.read("main2");
    await a.read("main2");
    await a.read("main1");
    await b.read("main1");
    expect(load).toHaveBeenCalledTimes(4);
    expect(budget.usedBytes).toBe(3);
    a.dispose();
    await b.read("main1");
    await b.read("main1");
    expect(load).toHaveBeenCalledTimes(5);
    b.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("does not share sources across claims or retain failed downloads", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(new Uint8Array(2));
    const budget = createSourceBudget(8);
    const a = createApparelSourceReader(load, () => {}, {
      maxBytes: 4,
      budget,
    });
    const b = createApparelSourceReader(load, () => {}, {
      maxBytes: 4,
      budget,
    });
    await expect(a.read("same")).rejects.toThrow("temporary");
    await a.read("same");
    await a.read("same");
    await b.read("same");
    expect(load).toHaveBeenCalledTimes(3);
    a.dispose();
    b.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("rejects a late download after disposal without reserving memory", async () => {
    let finish!: (value: Uint8Array) => void;
    const budget = createSourceBudget(8);
    const reader = createApparelSourceReader(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      () => {},
      { maxBytes: 4, budget },
    );
    const pending = reader.read("main");
    reader.dispose();
    finish(new Uint8Array(3));
    await expect(pending).rejects.toThrow("source_reader_disposed");
    await expect(reader.read("main")).rejects.toThrow("source_reader_disposed");
    expect(budget.usedBytes).toBe(0);
  });
});
