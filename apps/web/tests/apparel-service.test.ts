import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApparelService } from "@/server/apparel/apparel-service";
import { apparelFixture, apparelIds } from "./apparel-fixtures";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { getApparelRetainedSourceBytes } from "@/server/apparel/apparel-source-reader";
import { renderApparelPages } from "@/server/apparel/apparel-renderer";
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
describe.each([false, true])(
  "apparel service admission and storage (reuse=%s)",
  (enabled) => {
    beforeEach(() =>
      vi.stubEnv(
        "ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED",
        enabled ? "true" : "false",
      ),
    );
    afterEach(() => {
      expect(getApparelRetainedSourceBytes()).toBe(0);
      vi.unstubAllEnvs();
    });
    it.each(["blob", "download"])(
      "keeps a rejected Storage %s retryable and does not publish partial outputs",
      async (stage) => {
        const rpc = vi.fn(
          async (_name: string, args: Record<string, unknown>) => ({
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
          }),
        );
        const download = vi.fn(async () => {
          if (stage === "download") throw new TypeError("terminated");
          return {
            data: {
              arrayBuffer: async () => {
                throw new Error("transport body failed");
              },
            },
            error: null,
          };
        });
        const upload = vi.fn();
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
        ).rejects.toMatchObject({ status: 503, retryable: true });
        expect(upload).not.toHaveBeenCalled();
        expect(download).toHaveBeenCalledTimes(1);
      },
    );
    it.each([true, false])(
      "switches reuse independently and preserves every output hash: %s",
      async (reuse) => {
        vi.stubEnv(
          "ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED",
          reuse ? "true" : "false",
        );
        const photo = await sharp({
          create: {
            width: 600,
            height: 800,
            channels: 3,
            background: "#bc8e66",
          },
        })
          .jpeg()
          .toBuffer();
        const logo = await sharp(
          Buffer.from(
            '<svg width="200" height="50"><rect x="10" y="10" width="180" height="30" fill="white"/></svg>',
          ),
        )
          .png()
          .toBuffer();
        const source = (id: string) => (id === apparelIds[6] ? logo : photo);
        const baseline: string[] = [];
        for await (const page of renderApparelPages(
          apparelFixture,
          async (id) => source(id),
        ))
          baseline.push(createHash("sha256").update(page.bytes).digest("hex"));
        const rpc = vi.fn(
          async (_name: string, args: Record<string, unknown>) => ({
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
                  : args.p_operation === "register"
                    ? { id: apparelIds[4], path: "synthetic/output.jpg" }
                    : task,
            error: null,
          }),
        );
        const download = vi.fn(async (id: string) => ({
          data: { arrayBuffer: async () => source(id) },
          error: null,
        }));
        const hashes: string[] = [];
        const upload = vi.fn(async (_path: string, bytes: Uint8Array) => {
          hashes.push(createHash("sha256").update(bytes).digest("hex"));
          return { error: null };
        });
        await createApparelService({
          rpc,
          storage: { from: () => ({ download, upload }) },
        }).dispatch(
          apparelIds[0]!,
          "submit",
          task.id,
          { requestId: apparelIds[1]!, revision: 1 },
          apparelIds[2]!,
        );
        expect(download).toHaveBeenCalledTimes(reuse ? 7 : 14);
        expect(new Set(download.mock.calls.map(([id]) => id)).size).toBe(7);
        expect(hashes).toEqual(baseline);
        expect(upload).toHaveBeenCalledTimes(11);
        expect(
          rpc.mock.calls.filter(([, args]) => args.p_operation === "renew"),
        ).toHaveLength(11);
        expect(rpc.mock.calls.at(-1)?.[1].p_operation).toBe("complete");
      },
    );
    it.each([
      [{ statusCode: "503" }, 503, true],
      [{ statusCode: "404" }, 410, false],
      [{ status: 404, statusCode: "NoSuchKey" }, 410, false],
      [new Error("temporary transport failure"), 503, true],
    ])(
      "classifies a failed source download without automatic retry: %j",
      async (error, status, retryable) => {
        const rpc = vi.fn(
          async (_name: string, args: Record<string, unknown>) => ({
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
          }),
        );
        const download = vi.fn(async () => ({ data: null, error }));
        const upload = vi.fn();
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
        ).rejects.toMatchObject({ status, retryable });
        expect(download).toHaveBeenCalledTimes(1);
        expect(upload).not.toHaveBeenCalled();
        expect(rpc.mock.calls.map((call) => call[1].p_operation)).toEqual([
          "submit",
          "sources",
          "fail",
        ]);
      },
    );
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
    it("validates before registering a result and records a nonretryable validation failure on the same run", async () => {
      const bad = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
      const rpc = vi.fn(
        async (_name: string, args: Record<string, unknown>) => ({
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
        }),
      );
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
      ).rejects.toMatchObject({
        status: 400,
        retryable: false,
        message: expect.stringMatching(/3:4/),
      });
      expect(upload).not.toHaveBeenCalled();
      expect(rpc.mock.calls.map((call) => call[1].p_operation)).toEqual([
        "submit",
        "sources",
        "fail",
      ]);
      expect(
        rpc.mock.calls.every((call) => call[0] === "apparel_dispatch"),
      ).toBe(true);
    });
  },
);
