import { describe, expect, it, vi } from "vitest";
import {
  createSourceBudget,
  createApparelSourceReader,
} from "@/server/apparel/apparel-source-reader";

describe("claim-scoped source admission", () => {
  it("deduplicates an in-flight read and releases its reservation once", async () => {
    let finish!: (value: Uint8Array) => void;
    const load = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    const budget = createSourceBudget(8);
    const reader = createApparelSourceReader(load, () => {}, {
      maxBytes: 4,
      budget,
    });
    const a = reader.read("same"),
      b = reader.read("same");
    finish(new Uint8Array(4));
    expect(await a).toBe(await b);
    expect(load).toHaveBeenCalledTimes(1);
    expect(budget.usedBytes).toBe(4);
    reader.dispose();
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("bounds five overlapping claims at 32 MiB and admits again after release", async () => {
    const size = 8 * 1024 * 1024;
    const budget = createSourceBudget(4 * size);
    const readers = Array.from({ length: 5 }, () =>
      createApparelSourceReader(
        async () => new Uint8Array(size),
        () => {},
        { maxBytes: size, budget },
      ),
    );
    await Promise.all(readers.map((reader) => reader.read("same-source-id")));
    expect(budget.usedBytes).toBe(4 * size);
    expect(readers.map((reader) => reader.retainedBytes)).toEqual([
      size,
      size,
      size,
      size,
      0,
    ]);
    readers[0]!.dispose();
    await readers[4]!.read("same-source-id");
    expect(readers[4]!.retainedBytes).toBe(size);
    readers.forEach((reader) => reader.dispose());
    expect(budget.usedBytes).toBe(0);
  });
  it("remembers only successful overbudget exclusions and keeps fallback guarded", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(new Uint8Array(3));
    let active = true;
    const budget = createSourceBudget(8);
    const reader = createApparelSourceReader(
      load,
      () => {
        if (!active) throw new Error("lease_lost");
      },
      { maxBytes: 2, budget },
    );
    await expect(reader.read("large")).rejects.toThrow("temporary");
    expect(reader.excludedSourceCount).toBe(0);
    await reader.read("large");
    expect(reader.excludedSourceCount).toBe(1);
    expect(reader.retainedBytes).toBe(0);
    await reader.read("large");
    expect(load).toHaveBeenCalledTimes(3);
    active = false;
    await expect(reader.read("large")).rejects.toThrow("lease_lost");
    expect(load).toHaveBeenCalledTimes(3);
    reader.dispose();
    expect(reader.excludedSourceCount).toBe(0);
    expect(budget.usedBytes).toBe(0);
  });
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
