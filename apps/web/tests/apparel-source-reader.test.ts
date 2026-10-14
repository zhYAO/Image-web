import { describe, expect, it, vi } from "vitest";
import {
  createSourceBudget,
  createApparelSourceReader,
} from "@/server/apparel/apparel-source-reader";

describe("claim-scoped source admission", () => {
  it("uses uncached reads after a large first input instead of retaining one low-coverage source", async () => {
    const large = new Uint8Array(4 * 1024 * 1024 + 1);
    large[0] = 27;
    const budget = createSourceBudget(32 * 1024 * 1024);
    const reader = createApparelSourceReader(
      async (id) =>
        id === "large" ? large.slice() : new Uint8Array([1, 2, 3]),
      () => {},
      { budget },
    );
    expect((await reader.read("large"))[0]).toBe(27);
    expect(reader.retainedBytes).toBe(0);
    const first = await reader.read("small");
    const second = await reader.read("small");
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(reader.excludedSourceCount).toBe(0);
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("does not admit another pending input after large-input fallback starts", async () => {
    const finishes = new Map<string, (bytes: Uint8Array) => void>();
    const budget = createSourceBudget(32 * 1024 * 1024);
    const reader = createApparelSourceReader(
      (id) => new Promise((resolve) => finishes.set(id, resolve)),
      () => {},
      { budget },
    );
    const large = reader.read("large"),
      small = reader.read("small");
    finishes.get("large")!(new Uint8Array(4 * 1024 * 1024 + 1));
    await large;
    finishes.get("small")!(new Uint8Array([8, 9]));
    expect(await small).toEqual(new Uint8Array([8, 9]));
    expect(reader.retainedBytes).toBe(0);
    expect(budget.usedBytes).toBe(0);
    reader.dispose();
  });
  it("keeps reuse when a small source is admitted before a pending large source finishes", async () => {
    const finishes = new Map<string, (bytes: Uint8Array) => void>();
    const load = vi.fn(
      (id: string) =>
        new Promise<Uint8Array>((resolve) => finishes.set(id, resolve)),
    );
    const budget = createSourceBudget(32 * 1024 * 1024);
    const reader = createApparelSourceReader(load, () => {}, { budget });
    const large = reader.read("large"),
      small = reader.read("small");
    finishes.get("small")!(new Uint8Array([8, 9]));
    const admittedSmall = await small;
    finishes.get("large")!(new Uint8Array(4 * 1024 * 1024 + 1));
    const admittedLarge = await large;
    expect(await reader.read("small")).toBe(admittedSmall);
    expect(await reader.read("large")).toBe(admittedLarge);
    expect(load).toHaveBeenCalledTimes(2);
    expect(reader.retainedBytes).toBe(4 * 1024 * 1024 + 3);
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("deduplicates the initial large read and keeps later fallback reads uncached and retryable", async () => {
    let finish!: (bytes: Uint8Array) => void;
    const load = vi
      .fn<(id: string) => Promise<Uint8Array>>()
      .mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      )
      .mockRejectedValueOnce(new Error("temporary"))
      .mockImplementation(async () => new Uint8Array([5, 6]));
    const budget = createSourceBudget(32 * 1024 * 1024);
    const reader = createApparelSourceReader(load, () => {}, { budget });
    const a = reader.read("large"),
      b = reader.read("large");
    finish(new Uint8Array(4 * 1024 * 1024 + 1));
    expect(await a).toBe(await b);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(reader.read("large")).rejects.toThrow("temporary");
    const retry = await reader.read("large");
    const again = await reader.read("large");
    expect(again).toEqual(retry);
    expect(again).not.toBe(retry);
    expect(load).toHaveBeenCalledTimes(4);
    expect(reader.retainedBytes).toBe(0);
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("rejects loss of lease during an uncached fallback read without retaining bytes", async () => {
    let authorized = true;
    let finish!: (bytes: Uint8Array) => void;
    const budget = createSourceBudget(32 * 1024 * 1024);
    const reader = createApparelSourceReader(
      async (id) =>
        id === "large"
          ? new Uint8Array(4 * 1024 * 1024 + 1)
          : new Promise((resolve) => (finish = resolve)),
      () => {
        if (!authorized) throw new Error("lease_lost");
      },
      { budget },
    );
    await reader.read("large");
    const pending = reader.read("small");
    authorized = false;
    finish(new Uint8Array([7]));
    await expect(pending).rejects.toThrow("lease_lost");
    expect(reader.retainedBytes).toBe(0);
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("keeps the first-source cutoff at 4 MiB even with a larger custom claim budget", async () => {
    const budget = createSourceBudget(32 * 1024 * 1024);
    const reader = createApparelSourceReader(
      async () => new Uint8Array(4 * 1024 * 1024 + 1),
      () => {},
      { maxBytes: 16 * 1024 * 1024, budget },
    );
    await reader.read("large");
    expect(reader.retainedBytes).toBe(0);
    expect(reader.excludedSourceCount).toBe(0);
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("keeps failed first reads retryable before choosing a cache policy", async () => {
    let failed = false;
    const budget = createSourceBudget(32 * 1024 * 1024);
    const reader = createApparelSourceReader(
      async () => {
        if (!failed) {
          failed = true;
          throw new Error("temporary");
        }
        return new Uint8Array([3, 4]);
      },
      () => {},
      { budget },
    );
    await expect(reader.read("source")).rejects.toThrow("temporary");
    expect(await reader.read("source")).toBe(await reader.read("source"));
    expect(reader.retainedBytes).toBe(2);
    reader.dispose();
    expect(budget.usedBytes).toBe(0);
  });
  it("guards fallback before and after loading and rejects disposal through a Promise", async () => {
    let authorized = true;
    let finish!: (bytes: Uint8Array) => void;
    const reader = createApparelSourceReader(
      async (id) =>
        id === "large"
          ? new Uint8Array(4 * 1024 * 1024 + 1)
          : new Promise((resolve) => {
              finish = resolve;
            }),
      () => {
        if (!authorized) throw new Error("lease_lost");
      },
    );
    await reader.read("large");
    authorized = false;
    await expect(reader.read("small")).rejects.toThrow("lease_lost");
    authorized = true;
    const pending = reader.read("small");
    reader.dispose();
    finish(new Uint8Array([7]));
    await expect(pending).rejects.toThrow("source_reader_disposed");
    await expect(reader.read("large")).rejects.toThrow(
      "source_reader_disposed",
    );
  });
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
        async () => new Uint8Array(size / 2),
        () => {},
        { maxBytes: size, budget },
      ),
    );
    await Promise.all(
      readers.slice(0, 4).map(async (reader) => {
        await reader.read("source1");
        await reader.read("source2");
      }),
    );
    await readers[4]!.read("source1");
    await readers[4]!.read("source2");
    expect(budget.usedBytes).toBe(4 * size);
    expect(readers.map((reader) => reader.retainedBytes)).toEqual([
      size,
      size,
      size,
      size,
      0,
    ]);
    readers[0]!.dispose();
    await readers[4]!.read("source1");
    await readers[4]!.read("source2");
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
