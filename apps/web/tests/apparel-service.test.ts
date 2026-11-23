import { expect, it, vi } from "vitest";
import { createApparelService } from "@/server/apparel/apparel-service";
import { apparelFixture, apparelIds } from "./apparel-fixtures";

const [owner, session, taskId, assetId, requestId, correlationId] = apparelIds as [string, string, string, string, string, string, ...string[]];
const task = { id: taskId, sessionId: session, engine: "apparel-catalog", revision: 1, archived: false,
  createdAt: "2026-10-06", updatedAt: "2026-10-06", plan: apparelFixture, runs: [] };
const storedJpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

function fixture() {
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    data: args.p_operation === "asset" ? { path: "existing/one.jpg", name: "main/1.jpg" }
      : args.p_operation === "list" ? [task] : task, error: null,
  }));
  const download = vi.fn(async (_path: string) => ({ data: { arrayBuffer: async () => storedJpeg }, error: null }));
  const upload = vi.fn();
  const from = vi.fn((_bucket: string) => ({ download, upload }));
  return { service: createApparelService({ rpc, storage: { from } }), rpc, download, upload, from };
}

it("retires fixed apparel rendering before claiming a run or touching storage", async () => {
  const { service, rpc, from } = fixture();
  await expect(service.dispatch(owner, "submit", taskId, { requestId, revision: 1 }, correlationId))
    .rejects.toMatchObject({ status: 410, retryable: false });
  expect(rpc).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
});

it("continues reading existing apparel tasks and original JPEG bytes through the owner-scoped RPC", async () => {
  const { service, rpc, from, download, upload } = fixture();
  await expect(service.dispatch(owner, "list", undefined, { sessionId: session }, correlationId)).resolves.toMatchObject([{ id: taskId }]);
  await expect(service.asset(owner, taskId, assetId, correlationId)).resolves.toEqual({ path: "existing/one.jpg", name: "main/1.jpg", bytes: storedJpeg });
  expect(rpc).toHaveBeenLastCalledWith("apparel_dispatch", expect.objectContaining({ p_user_id: owner, p_task_id: taskId, p_operation: "asset", p_input: { assetId } }));
  expect(from).toHaveBeenCalledWith("generated");
  expect(download).toHaveBeenCalledWith("existing/one.jpg");
  expect(upload).not.toHaveBeenCalled();
});
