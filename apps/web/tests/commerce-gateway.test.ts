import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommerceSlots, type CommercePlan } from "@zimage/domain";
import {
  MOCK_STORAGE_KEY,
  MockWorkspaceGateway,
  type StorageLike,
} from "@/gateways/mock-workspace-gateway";
import { CapturingGateway } from "./workspace-test-fixtures";
const settings = {
  provider: "seedream",
  model: "seedream-4.5",
  aspectRatio: "1:1" as const,
  resolution: "2K" as const,
};
function storage(): StorageLike {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      items.set(k, v);
    },
  };
}
async function setup() {
  const store = storage(),
    gateway = new MockWorkspaceGateway({ storage: store });
  const session = await gateway.createSession();
  const reference = await gateway.commerce.upload(session.id, {
    file: new File(["test image"], "product.png", { type: "image/png" }),
    name: "product.png",
    size: 10,
    mimeType: "image/png",
  });
  const brief = {
    name: "陶瓷杯",
    facts: "白色",
    sellingPoints: "",
    platform: "taobao" as const,
    placement: "商品展示",
    productReferenceIds: [reference],
    styleReferenceIds: [],
  };
  const plan: CommercePlan = {
    scene: "product-set",
    templateId: "soft-studio",
    brief,
    slots: buildCommerceSlots(brief, "product-set", 3, settings),
  };
  const task = await gateway.commerce.create({
    requestId: crypto.randomUUID(),
    sessionId: session.id,
    plan,
  });
  return { gateway, store, session, plan, task };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("commerce gateway transaction and recovery", () => {
  it("saves a plan without generating and deduplicates confirmation across reload", async () => {
    const { gateway, store, session, task } = await setup();
    expect(await gateway.getTimeline(session.id)).toHaveLength(0);
    const request = {
      requestId: crypto.randomUUID(),
      revision: task.revision,
      slotIds: task.slots.map((s) => s.id),
    };
    const accepted = await gateway.commerce.submit(task.id, request);
    await vi.runAllTimersAsync();
    const reloaded = new MockWorkspaceGateway({ storage: store });
    const repeated = await reloaded.commerce.submit(task.id, request);
    expect(repeated.runs[0]!.id).toBe(accepted.runs[0]!.id);
    expect(await reloaded.getTimeline(session.id)).toHaveLength(3);
    expect((await reloaded.commerce.get(task.id)).selections).toHaveLength(3);
    expect((await reloaded.getQuota()).used).toBe(3);
  });
  it("rejects reused request keys with changed content", async () => {
    const { gateway, task } = await setup();
    const request = {
      requestId: crypto.randomUUID(),
      revision: task.revision,
      slotIds: [task.slots[0]!.id],
    };
    await gateway.commerce.submit(task.id, request);
    await expect(
      gateway.commerce.submit(task.id, {
        ...request,
        slotIds: [task.slots[1]!.id],
      }),
    ).rejects.toThrow("请求编号");
  });
  it("replaces only the third selected result, retains old candidates and freezes export", async () => {
    const { gateway, task, plan } = await setup();
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: task.slots.map((s) => s.id),
    });
    await vi.runAllTimersAsync();
    const first = await gateway.commerce.get(task.id);
    const oldIds = first.selections.map((s) => s.generationId);
    const nextPlan = {
      ...plan,
      slots: plan.slots.map((s, i) =>
        i === 2 ? { ...s, instruction: "背景换为米色" } : s,
      ),
    };
    const revision = await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: nextPlan,
    });
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: revision.revision,
      slotIds: [task.slots[2]!.id],
      recreate: true,
    });
    await vi.runAllTimersAsync();
    const latest = await gateway.commerce.get(task.id);
    const latestIds = latest.selections.map((s) => s.generationId);
    expect(latestIds.slice(0, 2)).toEqual(oldIds.slice(0, 2));
    expect(latestIds[2]).not.toBe(oldIds[2]);
    const exportInput = {
      requestId: crypto.randomUUID(),
      revision: latest.revision,
      selections: latest.selections.map(({ slotId, generationId }) => ({
        slotId,
        generationId,
      })),
    };
    const exported = await gateway.commerce.export(task.id, exportInput);
    await gateway.commerce.select(task.id, {
      requestId: crypto.randomUUID(),
      revision: latest.revision,
      slotId: task.slots[2]!.id,
      generationId: oldIds[2]!,
      expectedSelectionVersion: latest.selections[2]!.version,
    });
    expect((await gateway.commerce.export(task.id, exportInput)).items).toEqual(
      exported.items,
    );
    expect(
      (await gateway.commerce.get(task.id)).selections.find(
        (s) => s.slotId === task.slots[2]!.id,
      )!.generationId,
    ).toBe(oldIds[2]);
  });
  it("does not let a late retry overwrite a manual result selection", async () => {
    const { gateway, task } = await setup();
    const slotId = task.slots[0]!.id;
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [slotId],
    });
    await vi.runAllTimersAsync();
    const first = await gateway.commerce.get(task.id);
    const selected = first.selections[0]!;
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [slotId],
      recreate: true,
    });
    await gateway.commerce.select(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotId,
      generationId: selected.generationId,
      expectedSelectionVersion: selected.version,
    });
    await vi.runAllTimersAsync();
    expect(
      (await gateway.commerce.get(task.id)).selections[0]!.generationId,
    ).toBe(selected.generationId);
  });

  it("cancels pending work once and prevents delayed timers from restarting it", async () => {
    const { gateway, task } = await setup();
    const accepted = await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: task.slots.map((s) => s.id),
    });
    const request = {
      requestId: crypto.randomUUID(),
      revision: 1,
      runId: accepted.runs[0]!.id,
    };
    await gateway.commerce.cancel(task.id, request);
    await gateway.commerce.cancel(task.id, request);
    await vi.runAllTimersAsync();
    const cancelled = await gateway.commerce.get(task.id);
    expect(cancelled.runs[0]!.items.every((i) => i.status === "failed")).toBe(
      true,
    );
    expect(cancelled.selections).toHaveLength(0);
    expect((await gateway.getQuota()).used).toBe(0);
  });
  it("preserves completed results on archive and reuses promoted references", async () => {
    const { gateway, task } = await setup();
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [task.slots[0]!.id],
    });
    await vi.runAllTimersAsync();
    const complete = await gateway.commerce.get(task.id);
    const generationId = complete.selections[0]!.generationId;
    const first = await gateway.commerce.promote(task.id, {
      requestId: crypto.randomUUID(),
      generationId,
    });
    const again = await gateway.commerce.promote(task.id, {
      requestId: crypto.randomUUID(),
      generationId,
    });
    expect(again.id).toBe(first.id);
    await gateway.commerce.archive(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
    });
    await expect(
      gateway.commerce.submit(task.id, {
        requestId: crypto.randomUUID(),
        revision: 1,
        slotIds: [task.slots[1]!.id],
      }),
    ).rejects.toThrow();
    const exported = await gateway.commerce.export(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      selections: [{ slotId: task.slots[0]!.id, generationId }],
    });
    expect(exported.items[0]!.generationId).toBe(generationId);
  });

  it("rolls back every child and quota when a later child fails to be admitted", async () => {
    const { gateway, session, task } = await setup();
    const original = gateway.submitImage.bind(gateway);
    vi.spyOn(gateway, "submitImage")
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error("injected admission failure"));
    await expect(
      gateway.commerce.submit(task.id, {
        requestId: crypto.randomUUID(),
        revision: 1,
        slotIds: task.slots.map((s) => s.id),
      }),
    ).rejects.toThrow("injected");
    await vi.runAllTimersAsync();
    expect(await gateway.getTimeline(session.id)).toHaveLength(0);
    expect((await gateway.getQuota()).used).toBe(0);
    expect((await gateway.commerce.get(task.id)).runs).toHaveLength(0);
  });
  it("rejects references from another session and preserves consumed quota on deletion", async () => {
    const { gateway, session, task, plan } = await setup();
    const other = await gateway.createSession();
    const foreign = await gateway.commerce.create({
      requestId: crypto.randomUUID(),
      sessionId: other.id,
      plan,
    });
    await expect(
      gateway.commerce.submit(foreign.id, {
        requestId: crypto.randomUUID(),
        revision: 1,
        slotIds: foreign.slots.map((s) => s.id),
      }),
    ).rejects.toThrow("参考图");
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [task.slots[0]!.id],
    });
    await vi.runAllTimersAsync();
    await gateway.deleteSession(session.id);
    expect((await gateway.getQuota()).used).toBe(1);
    await expect(gateway.commerce.get(task.id)).rejects.toThrow("不存在");
  });
  it("commits host charges, commerce runs and request replay in one durable write", async () => {
    const { gateway, store, session, task } = await setup();
    const request = {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [task.slots[0]!.id],
    };
    const before = store.getItem(MOCK_STORAGE_KEY);
    const persist = vi.spyOn(store, "setItem").mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    await expect(gateway.commerce.submit(task.id, request)).rejects.toThrow(
      "QuotaExceededError",
    );
    expect(store.getItem(MOCK_STORAGE_KEY)).toBe(before);
    expect((await gateway.getQuota()).used).toBe(0);
    expect(await gateway.getTimeline(session.id)).toHaveLength(0);
    await vi.runAllTimersAsync();
    const recovered = new MockWorkspaceGateway({ storage: store });
    expect((await recovered.commerce.get(task.id)).runs).toHaveLength(0);
    expect((await recovered.getQuota()).used).toBe(0);
    persist.mockClear();
    const accepted = await recovered.commerce.submit(task.id, request);
    expect(persist).toHaveBeenCalledTimes(1);
    const reloaded = new MockWorkspaceGateway({ storage: store });
    expect(await reloaded.commerce.submit(task.id, request)).toEqual(accepted);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await reloaded.getTimeline(session.id)).toHaveLength(1);
    expect((await reloaded.getQuota()).used).toBe(1);
  });

  it("rolls back cancellation and its refund if durable commit fails", async () => {
    const { gateway, store, task } = await setup();
    const accepted = await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [task.slots[0]!.id],
    });
    const request = {
      requestId: crypto.randomUUID(),
      revision: 1,
      runId: accepted.runs[0]!.id,
    };
    vi.spyOn(store, "setItem").mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    await expect(gateway.commerce.cancel(task.id, request)).rejects.toThrow(
      "QuotaExceededError",
    );
    expect((await gateway.getQuota()).used).toBe(1);
    expect(
      (await gateway.commerce.get(task.id)).runs[0]!.items[0]!.status,
    ).toBe("pending");
    const reloaded = new MockWorkspaceGateway({ storage: store });
    await reloaded.commerce.cancel(task.id, request);
    await reloaded.commerce.cancel(task.id, request);
    expect((await reloaded.getQuota()).used).toBe(0);
    expect(
      (await reloaded.commerce.get(task.id)).runs[0]!.items[0]!.error,
    ).toBe("user_cancelled");
  });

  it("requires explicit recreation after selecting an incompatible historical success", async () => {
    const { gateway, task, plan } = await setup();
    const slotId = task.slots[0]!.id;
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [slotId],
    });
    await vi.runAllTimersAsync();
    const first = (await gateway.commerce.get(task.id)).selections[0]!;
    await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: {
        ...plan,
        slots: plan.slots.map((s) =>
          s.id === slotId ? { ...s, instruction: "new background" } : s,
        ),
      },
    });
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 2,
      slotIds: [slotId],
    });
    await vi.runAllTimersAsync();
    const latest = await gateway.commerce.get(task.id);
    await gateway.commerce.select(task.id, {
      requestId: crypto.randomUUID(),
      revision: 2,
      slotId,
      generationId: first.generationId,
      expectedSelectionVersion: latest.selections[0]!.version,
    });
    await expect(
      gateway.commerce.submit(task.id, {
        requestId: crypto.randomUUID(),
        revision: 2,
        slotIds: [slotId],
        recreate: false,
      }),
    ).rejects.toThrow("重做");
    expect((await gateway.getQuota()).used).toBe(2);
    await expect(
      gateway.commerce.submit(task.id, {
        requestId: crypto.randomUUID(),
        revision: 2,
        slotIds: [slotId],
        recreate: true,
      }),
    ).resolves.toMatchObject({ runs: [{}, {}, {}] });
  });

  it("persists an invalidated pending candidate across A to B to A while untouched slots inherit", async () => {
    const { gateway, store, task, plan } = await setup();
    const [changed, untouched] = task.slots;
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [changed!.id, untouched!.id],
    });
    await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: {
        ...plan,
        slots: plan.slots.map((s) =>
          s.id === changed!.id ? { ...s, instruction: "B" } : s,
        ),
      },
    });
    await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 2,
      plan,
    });
    await vi.runAllTimersAsync();
    const reloaded = new MockWorkspaceGateway({ storage: store });
    const complete = await reloaded.commerce.get(task.id);
    expect(complete.selections).toEqual([
      expect.objectContaining({ slotId: untouched!.id, version: 0 }),
    ]);
    expect(
      complete.runs[0]!.items.every((item) => item.status === "succeeded"),
    ).toBe(true);
  });

  it("hides removed selections, rejects removed membership and retains manual versions when re-added", async () => {
    const { gateway, store, task, plan } = await setup();
    const slotId = task.slots[0]!.id;
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [slotId],
    });
    await vi.runAllTimersAsync();
    const selected = (await gateway.commerce.get(task.id)).selections[0]!;
    expect(selected.version).toBe(0);
    await gateway.commerce.select(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotId,
      generationId: selected.generationId,
      expectedSelectionVersion: 0,
    });
    await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: { ...plan, slots: plan.slots.slice(1) },
    });
    const reloaded = new MockWorkspaceGateway({ storage: store });
    expect((await reloaded.commerce.get(task.id)).selections).toEqual([]);
    await expect(
      reloaded.commerce.select(task.id, {
        requestId: crypto.randomUUID(),
        revision: 2,
        slotId,
        generationId: selected.generationId,
        expectedSelectionVersion: 1,
      }),
    ).rejects.toThrow();
    const restored = await reloaded.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 2,
      plan,
    });
    expect(restored.selections).toEqual([
      expect.objectContaining({
        slotId,
        version: 1,
        generationId: selected.generationId,
      }),
    ]);
    await expect(
      reloaded.commerce.select(task.id, {
        requestId: crypto.randomUUID(),
        revision: 3,
        slotId,
        generationId: selected.generationId,
        expectedSelectionVersion: 0,
      }),
    ).rejects.toThrow();
  });

  it("does not revive a pending candidate after its slot is removed and re-added", async () => {
    const { gateway, store, task, plan } = await setup();
    const slotId = task.slots[0]!.id;
    await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [slotId],
    });
    await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: { ...plan, slots: plan.slots.slice(1) },
    });
    await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 2,
      plan,
    });
    await vi.runAllTimersAsync();
    expect(
      (await new MockWorkspaceGateway({ storage: store }).commerce.get(task.id))
        .selections,
    ).toEqual([]);
  });

  it("authorizes create replays against the still-live session after reload", async () => {
    const { gateway, store, session, plan } = await setup();
    const request = {
      requestId: crypto.randomUUID(),
      sessionId: session.id,
      plan,
    };
    const created = await gateway.commerce.create(request);
    expect(await gateway.commerce.create(request)).toEqual(created);
    await gateway.deleteSession(session.id);
    await expect(gateway.commerce.create(request)).rejects.toThrow("会话");
    await expect(
      new MockWorkspaceGateway({ storage: store }).commerce.create(request),
    ).rejects.toThrow("会话");
  });

  it("imports the legacy separate commerce store and thereafter ignores its stale snapshot", async () => {
    const { gateway, store, task, plan } = await setup();
    const envelope = JSON.parse(store.getItem(MOCK_STORAGE_KEY)!);
    const commerce = JSON.parse(envelope.state.commerce);
    delete commerce.slotStates;
    store.setItem("zimage:commerce:mock:v1", JSON.stringify(commerce));
    delete envelope.state.commerce;
    store.setItem(MOCK_STORAGE_KEY, JSON.stringify(envelope));
    const migrated = new MockWorkspaceGateway({ storage: store });
    expect((await migrated.commerce.get(task.id)).revision).toBe(1);
    await migrated.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: {
        ...plan,
        brief: { ...plan.brief, name: "updated after migration" },
      },
    });
    const reloaded = new MockWorkspaceGateway({ storage: store });
    expect(await reloaded.commerce.get(task.id)).toMatchObject({
      revision: 2,
      brief: { name: "updated after migration" },
    });
    expect((await reloaded.getQuota()).used).toBe(
      (await gateway.getQuota()).used,
    );
  });
  it("keeps concurrent acknowledged host edits durable when commerce commit rolls back", async () => {
    const { gateway, store, session, plan } = await setup();
    const commerce = gateway.commerce
      .create({ requestId: crypto.randomUUID(), sessionId: session.id, plan })
      .catch((error: Error) => error.message);
    await Promise.resolve();
    const rename = gateway.renameSession(session.id, "acknowledged rename");
    const create = gateway.createSession("acknowledged new session");
    vi.spyOn(store, "setItem").mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    const [outcome, renamed, created] = await Promise.all([
      commerce,
      rename,
      create,
    ]);
    expect(outcome).toBe("QuotaExceededError");
    expect(renamed.title).toBe("acknowledged rename");
    for (const host of [
      gateway,
      new MockWorkspaceGateway({ storage: store }),
    ]) {
      const sessions = await host.listSessions();
      expect(sessions).toContainEqual(
        expect.objectContaining({ id: session.id, title: renamed.title }),
      );
      expect(sessions).toContainEqual(
        expect.objectContaining({ id: created.id, title: created.title }),
      );
    }
  });

  it("protects chat completion writes after a yield from a failing commerce transaction", async () => {
    const { gateway, store, session, plan } = await setup();
    const stream = gateway
      .streamChat({
        sessionId: session.id,
        imageToolEnabled: false,
        message: "discuss composition",
      })
      [Symbol.asyncIterator]();
    for (let i = 0; i < 3; i++) {
      const next = stream.next();
      await vi.runAllTimersAsync();
      expect((await next).value?.type).toBe("message.delta");
    }
    const commerce = gateway.commerce
      .create({ requestId: crypto.randomUUID(), sessionId: session.id, plan })
      .catch((error: Error) => error.message);
    await Promise.resolve();
    const completion = stream.next();
    vi.spyOn(store, "setItem").mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    const [outcome, completed] = await Promise.all([commerce, completion]);
    expect(outcome).toBe("QuotaExceededError");
    expect(completed.value?.type).toBe("message.completed");
    for (const host of [gateway, new MockWorkspaceGateway({ storage: store })])
      expect(await host.getTimeline(session.id)).toEqual([
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({ role: "assistant" }),
      ]);
    await stream.return?.(undefined);
  });
  it("runs commerce children and recreation through the actual CapturingGateway without lock re-entry", async () => {
    const { store, task } = await setup();
    const gateway = new CapturingGateway({ storage: store });
    const accepted = await gateway.commerce.submit(task.id, {
      requestId: crypto.randomUUID(),
      revision: task.revision,
      slotIds: [task.slots[0]!.id],
    });
    expect(gateway.lastImageRequest).toMatchObject({
      count: 1,
      sessionId: task.sessionId,
    });
    await vi.runAllTimersAsync();
    expect((await gateway.commerce.get(task.id)).selections).toHaveLength(1);
    const recreated = await gateway.recreateGeneration({
      batchId: accepted.runs[0]!.items[0]!.batchId,
      scope: "all",
    });
    expect(recreated.status).toBe("pending");
    expect(gateway.lastRecreateRequest?.batchId).toBe(
      accepted.runs[0]!.items[0]!.batchId,
    );
    expect((await gateway.getQuota()).used).toBe(2);
  });
});
