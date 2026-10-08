import { describe, expect, it, vi } from "vitest";
import { createApparelService } from "@/server/apparel/apparel-service";
import { apparelFixture, apparelIds } from "./apparel-fixtures";
import sharp from "sharp";
const task = {
  id: apparelIds[7]!,
  sessionId: apparelIds[7]!,
  engine: "apparel-catalog",
  revision: 1,
  plan: apparelFixture,
  createdAt: "2026-10-06",
  updatedAt: "2026-10-06",
  runs: [],
  archived: false,
};
describe("apparel service admission and storage", () => {
  it("returns a duplicate without rendering, uploading or calling model/credit RPCs", async () => {
    const rpc = vi.fn(async () => ({
        data: { claimed: false, task },
        error: null,
      })),
      upload = vi.fn();
    const client = {
      rpc,
      storage: { from: () => ({ download: vi.fn(), upload }) },
    };
    expect(
      await createApparelService(client).dispatch(
        apparelIds[0]!,
        "submit",
        task.id,
        { requestId: apparelIds[1]!, revision: 1 },
        apparelIds[2]!,
      ),
    ).toEqual(task);
    expect(rpc.mock.calls).toHaveLength(1);
    expect(upload).not.toHaveBeenCalled();
  });
  it("validates before registering a result and records a retryable failure on the same run", async () => {
    const bad = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data:
        args.p_operation === "submit"
          ? {
              claimed: true,
              runId: apparelIds[2],
              claimToken: apparelIds[3],
              plan: apparelFixture,
              task,
            }
          : args.p_operation === "sources"
            ? apparelIds.slice(0, 7).map((id) => ({ id, path: id }))
            : task,
      error: null,
    }));
    const upload = vi.fn(),
      download = vi.fn(async () => ({
        data: { arrayBuffer: async () => bad },
        error: null,
      }));
    await expect(
      createApparelService({
        rpc,
        storage: { from: () => ({ download, upload }) },
      }).dispatch(
        apparelIds[0]!,
        "submit",
        task.id,
        { requestId: apparelIds[1]!, revision: 1 },
        apparelIds[2]!,
      ),
    ).rejects.toThrow(/3:4/);
    expect(upload).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map((call) => call[1].p_operation)).toEqual([
      "submit",
      "sources",
      "fail",
    ]);
    expect(rpc.mock.calls.every((call) => call[0] === "apparel_dispatch")).toBe(
      true,
    );
  });
});
