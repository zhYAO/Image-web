import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MockWorkspaceGateway } from "@/gateways/mock-workspace-gateway";
import { apparelOutputNames } from "@zimage/domain";
import { apparelFixture } from "./apparel-fixtures";
async function fixture() {
  const map = new Map<string, string>(),
    storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
  const host = new MockWorkspaceGateway({ storage, delay: async () => {} }),
    session = await host.createSession("衬衫"),
    gateway = host.commerce.apparel;
  const ids = [];
  for (let i = 0; i < 7; i++)
    ids.push(
      await gateway.upload(session.id, {
        file: new File(["source"], i === 6 ? "logo.png" : `${i + 1}.jpg`, {
          type: i === 6 ? "image/png" : "image/jpeg",
        }),
        name: `${i}.jpg`,
        mimeType: i === 6 ? "image/png" : "image/jpeg",
        size: 6,
        status: "ready",
      }),
    );
  const plan = {
    ...apparelFixture,
    sources: {
      mains: ids.slice(0, 5),
      displays: [{ id: ids[5]!, name: "展示1.jpg" }],
      logo: ids[6]!,
    },
  };
  const task = await gateway.create({
    requestId: crypto.randomUUID(),
    sessionId: session.id,
    plan,
  });
  return { host, gateway, task, plan, storage };
}
describe("mock apparel whole-set history", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => `blob:${crypto.randomUUID()}`),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          pages: apparelOutputNames(apparelFixture).map((name) => ({
            name,
            width: name.startsWith("主图") ? 750 : 790,
            height: 1000,
            base64: "/9j/AQID/9k=",
          })),
        }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it("restores uploaded bytes and history on gateway refresh without creating AI batches", async () => {
    const { host, gateway, task, storage } = await fixture(),
      request = { requestId: crypto.randomUUID(), revision: 1 };
    const completed = await gateway.submit(task.id, request);
    expect(completed.runs[0]?.assets).toHaveLength(11);
    expect(
      completed.runs[0]?.assets.every(
        (asset) => asset.kind === "layout" && asset.url && !asset.expired,
      ),
    ).toBe(true);
    expect((await gateway.submit(task.id, request)).runs).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await host.getTimeline(task.sessionId)).toEqual([]);
    const restored = new MockWorkspaceGateway({
      storage,
      delay: async () => {},
    });
    expect(
      (await restored.commerce.apparel.get(task.id)).runs[0]?.assets,
    ).toHaveLength(11);
    expect(
      (await restored.listSessions()).find(
        (session) => session.id === task.sessionId,
      )?.activityTypes,
    ).toContain("commerce");
    await host.deleteSession(task.sessionId);
    await expect(gateway.get(task.id)).rejects.toMatchObject({
      safe: { code: "NOT_FOUND" },
    });
  });
  it("retries a failed render using one request and preserves the old set after a new revision", async () => {
    const { gateway, task, plan } = await fixture(),
      request = { requestId: crypto.randomUUID(), revision: 1 };
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ message: "Design 文字过长" }, { status: 400 }),
    );
    await expect(gateway.submit(task.id, request)).rejects.toThrow(/Design/);
    const failed = await gateway.get(task.id);
    expect(failed.runs[0]?.status).toBe("failed");
    const completed = await gateway.submit(task.id, request);
    expect(completed.runs).toHaveLength(1);
    expect(completed.runs[0]?.id).toBe(failed.runs[0]?.id);
    const saved = await gateway.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: { ...plan, brief: { ...plan.brief, color: "米色" } },
    });
    expect(saved.revision).toBe(2);
    expect(
      (
        await gateway.export(task.id, {
          requestId: crypto.randomUUID(),
          revision: 2,
          runId: completed.runs[0]!.id,
        })
      ).items,
    ).toHaveLength(11);
  });
  it("recovers an abandoned request after its lease and fences a late response", async () => {
    const { gateway, task, storage } = await fixture(),
      request = { requestId: crypto.randomUUID(), revision: 1 };
    let finishFirst!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = gateway.submit(task.id, request);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121000);
    try {
      const restored = new MockWorkspaceGateway({
        storage,
        delay: async () => {},
      }).commerce.apparel;
      const completed = await restored.submit(task.id, request);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(completed.runs).toHaveLength(1);
      expect(completed.runs[0]?.status).toBe("succeeded");
      finishFirst(
        Response.json({
          pages: apparelOutputNames(apparelFixture).map((name) => ({
            name,
            width: 790,
            height: 1000,
            base64: "/9j/AQID/9k=",
          })),
        }),
      );
      await expect(first).rejects.toThrow(/租约/);
      expect((await restored.get(task.id)).runs[0]?.status).toBe("succeeded");
      expect(
        (
          await new MockWorkspaceGateway({
            storage,
            delay: async () => {},
          }).commerce.apparel.get(task.id)
        ).runs[0]?.status,
      ).toBe("succeeded");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
