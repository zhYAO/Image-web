import { afterEach, describe, expect, it, vi } from "vitest";
import { MockWorkspaceGateway } from "@/gateways/mock-workspace-gateway";
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
describe("mock apparel metadata and legacy render retirement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects legacy rendering before fetching, creating history, or AI jobs", async () => {
    const { host, gateway, task, storage } = await fixture();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const request = { requestId: crypto.randomUUID(), revision: 1 };
    await expect(gateway.submit(task.id, request)).rejects.toThrow();
    await expect(gateway.submit(task.id, request)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await host.getTimeline(task.sessionId)).toEqual([]);
    const restored = new MockWorkspaceGateway({storage, delay: async () => {}});
    expect((await restored.commerce.apparel.get(task.id)).runs).toEqual([]);
  });

  it("retains metadata saving, ownership, and replay after refresh", async () => {
    const { host, gateway, task, plan, storage } = await fixture();
    const input = { requestId: crypto.randomUUID(), expectedRevision: 1, plan };
    const saved = await gateway.save(task.id, input);
    expect(saved.revision).toBe(2);
    const restored = new MockWorkspaceGateway({storage, delay: async () => {}});
    expect((await restored.commerce.apparel.get(task.id)).revision).toBe(2);
    expect((await restored.commerce.apparel.save(task.id, input)).revision).toBe(2);
    await host.deleteSession(task.sessionId);
    await expect(gateway.get(task.id)).rejects.toMatchObject({safe:{code:"NOT_FOUND"}});
  });
});
