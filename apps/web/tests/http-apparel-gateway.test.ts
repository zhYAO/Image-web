import { describe, expect, it, vi } from "vitest";
import { HttpWorkspaceGateway } from "@/gateways/http-workspace-gateway";
import { apparelFixture, apparelIds } from "./apparel-fixtures";
const task = {
  id: apparelIds[7]!,
  sessionId: apparelIds[7]!,
  engine: "apparel-catalog",
  revision: 1,
  plan: apparelFixture,
  createdAt: "now",
  updatedAt: "now",
  runs: [],
  archived: false,
};
describe("apparel HTTP task contract", () => {
  it("routes create, save, submit and history through the existing creative-task entry points", async () => {
    const fetcher = vi.fn(
      async (path: RequestInfo | URL, init?: RequestInit) => {
        void init;
        return Response.json(String(path).includes("sessionId=") ? [task] : task);
      },
    );
    const gateway = new HttpWorkspaceGateway({ fetcher }).commerce.apparel;
    await gateway.create({
      sessionId: task.sessionId,
      requestId: apparelIds[0]!,
      plan: apparelFixture,
    });
    await gateway.save(task.id, {
      expectedRevision: 1,
      requestId: apparelIds[1]!,
      plan: apparelFixture,
    });
    await gateway.submit(task.id, { requestId: apparelIds[2]!, revision: 1 });
    await gateway.list(task.sessionId);
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/creative-tasks?engine=apparel-catalog",
      `/api/creative-tasks/${task.id}?engine=apparel-catalog`,
      `/api/creative-tasks/${task.id}/submit?engine=apparel-catalog`,
      `/api/creative-tasks?engine=apparel-catalog&sessionId=${task.sessionId}`,
    ]);
    const bodies = fetcher.mock.calls
      .slice(0, 3)
      .map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies[2]).toEqual({ requestId: apparelIds[2], revision: 1 });
    expect(bodies[0].plan).not.toHaveProperty("model");
    expect(bodies[2]).not.toHaveProperty("billing");
  });
  it("downloads binary ZIP through the injected fetcher and reports expired assets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { "content-type": "application/zip" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "asset_expired",
            message: "已到期",
            correlationId: apparelIds[0],
            retryable: false,
          },
          { status: 410 },
        ),
      );
    const gateway = new HttpWorkspaceGateway({ fetcher }).commerce.apparel,
      input = { requestId: apparelIds[0]!, revision: 1, runId: apparelIds[1]! };
    expect((await gateway.download(task.id, input)).type).toBe(
      "application/zip",
    );
    await expect(gateway.download(task.id, input)).rejects.toMatchObject({
      safe: { code: "ASSET_EXPIRED" },
    });
  });
});
