import { act, renderHook } from "@testing-library/react";
import {
  buildCommerceSlots,
  type CommerceBrief,
  type CommerceTask,
} from "@zimage/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommerceTasks } from "@/features/commerce/use-commerce-tasks";
import { createTestGateway } from "./workspace-test-fixtures";

const brief: CommerceBrief = {
  name: "杯子",
  facts: "",
  sellingPoints: "",
  platform: "taobao",
  placement: "商品展示",
  productReferenceIds: [crypto.randomUUID()],
  styleReferenceIds: [],
};
function task(active = false): CommerceTask {
  const slots = buildCommerceSlots(brief, "product-set", 1, {
    provider: "gemini",
    model: "gemini-3-pro-image",
    aspectRatio: "1:1",
    resolution: "2K",
  });
  const slot = slots[0]!;
  return {
    id: crypto.randomUUID(),
    sessionId: "session",
    revision: 1,
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
    brief,
    scene: "product-set",
    templateId: "soft-studio",
    slots,
    slotHashes: { [slot.id]: "opaque" },
    archived: !active,
    selections: [],
    runs: active
      ? [
          {
            id: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            revision: 1,
            createdAt: "2026-09-08T00:00:00Z",
            items: [
              {
                slotId: slot.id,
                batchId: crypto.randomUUID(),
                generationId: crypto.randomUUID(),
                status: "pending",
                compatibilityHash: "opaque",
                selectionVersion: 0,
              },
            ],
          },
        ]
      : [],
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("commerce task polling", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T00:00:00Z')); });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads twenty terminal tasks once without automatic polling and refreshes manually", async () => {
    const gateway = createTestGateway().commerce;
    const tasks = Array.from({ length: 20 }, () => task());
    const list = vi.spyOn(gateway, "list").mockResolvedValue(tasks);
    const get = vi.spyOn(gateway, "get");
    const { result } = renderHook(() => useCommerceTasks(gateway, "session"));
    await flush();
    expect(result.current.tasks).toHaveLength(20);
    expect(list).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    await advance(15_000);
    expect(list).toHaveBeenCalledTimes(1);
    await advance(15_000);
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue([...tasks, task()]);
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(result.current.tasks).toHaveLength(20);
    await act(async () => {
      await result.current.refresh();
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
  });

  it("polls active results every five seconds, pauses hidden, and stops after completion", async () => {
    const gateway = createTestGateway().commerce;
    const active = task(true);
    const list = vi.spyOn(gateway, "list").mockResolvedValue([active]);
    renderHook(() => useCommerceTasks(gateway, "session"));
    await flush();
    await advance(5000);
    expect(list).toHaveBeenCalledTimes(2);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await advance(6000);
    expect(list).toHaveBeenCalledTimes(2);
    list.mockResolvedValue([{ ...active, runs: [] }]);
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(list).toHaveBeenCalledTimes(3);
    await advance(5000);
    expect(list).toHaveBeenCalledTimes(3);
    await advance(28_500);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("polls pending submissions every five seconds and does not overwrite a newer mutation", async () => {
    const gateway = createTestGateway().commerce;
    const original = task();
    const list = vi.spyOn(gateway, "list").mockResolvedValue([original]);
    const { result, rerender } = renderHook(
      ({ unknown }) => useCommerceTasks(gateway, "session", unknown),
      { initialProps: { unknown: true } },
    );
    await flush();
    await advance(5000);
    expect(list).toHaveBeenCalledTimes(2);
    let resolve!: (tasks: CommerceTask[]) => void;
    list.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refresh();
    });
    act(() => result.current.accept({ ...original, revision: 2 }));
    await act(async () => {
      resolve([original]);
      await pending;
    });
    expect(result.current.tasks[0]?.revision).toBe(2);
    rerender({ unknown: false });
    await advance(5000);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('does not make an automatic request after the task reaches one hour', async () => {
    const gateway = createTestGateway().commerce;
    const list = vi.spyOn(gateway, 'list').mockResolvedValue([task(true)]);
    renderHook(() => useCommerceTasks(gateway, 'session'));
    await flush();
    vi.setSystemTime(new Date('2026-09-08T01:00:00Z'));
    await advance(5000);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
