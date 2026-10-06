import {
  apparelCreateSchema,
  apparelSaveSchema,
  apparelSubmitSchema,
  apparelSelectSchema,
  apparelExportSchema,
  apparelTaskSchema,
  apparelExportResultSchema,
  apparelPlanSchema,
  type ApparelTask,
} from "@zimage/domain";
import { z } from "zod";
import { ApiRouteError } from "@/server/api-error";
import { hashCanonicalRequest } from "@/server/image/image-service";
import { renderApparelPages } from "./apparel-renderer";
interface Client {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{
        data: { arrayBuffer(): Promise<ArrayBuffer | Uint8Array> } | null;
        error: unknown;
      }>;
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean; cacheControl: string },
      ): Promise<{ error: unknown }>;
    };
  };
}
export type ApparelOperation =
  "list" | "get" | "create" | "save" | "submit" | "select" | "export";
function failure(message: string) {
  const expired = /expired/.test(message),
    missing = /not_found|forbidden|unauthorized/.test(message),
    conflict = /conflict|busy|lease_lost/.test(message),
    quota = /quota/.test(message),
    bad = /invalid/.test(message);
  return new ApiRouteError({
    code: expired
      ? "asset_expired"
      : missing
        ? "not_found"
        : conflict
          ? "conflict"
          : quota
            ? "quota_exceeded"
            : bad
              ? "bad_request"
              : "network",
    status: expired
      ? 410
      : missing
        ? 404
        : conflict
          ? 409
          : quota
            ? 429
            : bad
              ? 400
              : 503,
    retryable: !expired && !missing && !bad,
    message: expired
      ? "素材或结果已过期，请重新上传。"
      : missing
        ? "任务或素材不存在，或无权访问。"
        : conflict
          ? "排版正在执行或版本已变化，请稍后刷新重试。"
          : quota
            ? "操作过于频繁，请稍后重试。"
            : bad
              ? "请检查服装资料、素材和裁切坐标。"
              : "排版服务暂时不可用，当前请求可重试。",
  });
}
function hydrate(task: ApparelTask): ApparelTask {
  return {
    ...task,
    runs: task.runs.map((run) => ({
      ...run,
      assets: run.assets.map((asset) => ({
        ...asset,
        ...(!asset.expired
          ? { url: `/api/creative-tasks/${task.id}/assets/${asset.id}` }
          : {}),
      })),
    })),
  };
}
export function createApparelService(client: Client) {
  async function rpc(
    userId: string,
    operation: string,
    taskId: string | undefined,
    input: unknown,
    correlationId: string,
    hash?: string,
  ) {
    const { data, error } = await client.rpc("apparel_dispatch", {
      p_user_id: userId,
      p_operation: operation,
      p_task_id: taskId ?? null,
      p_input: input,
      p_request_hash: hash ?? null,
      p_correlation_id: correlationId,
    });
    if (error) throw failure(error.message ?? "");
    return data;
  }
  async function asset(
    userId: string,
    taskId: string,
    assetId: string,
    correlationId: string,
  ) {
    z.uuid().parse(assetId);
    const item = z
      .object({ path: z.string(), name: z.string() })
      .parse(await rpc(userId, "asset", taskId, { assetId }, correlationId));
    const { data, error } = await client.storage
      .from("generated")
      .download(item.path);
    if (error || !data) throw failure("asset_expired");
    return { ...item, bytes: new Uint8Array(await data.arrayBuffer()) };
  }
  return {
    asset,
    async dispatch(
      userId: string,
      operation: ApparelOperation,
      taskId: string | undefined,
      raw: unknown,
      correlationId: string,
    ) {
      z.uuid().parse(userId);
      if (taskId) z.uuid().parse(taskId);
      const input =
        operation === "create"
          ? apparelCreateSchema.parse(raw)
          : operation === "save"
            ? apparelSaveSchema.parse(raw)
            : operation === "submit"
              ? apparelSubmitSchema.parse(raw)
              : operation === "select"
                ? apparelSelectSchema.parse(raw)
                : operation === "export"
                  ? apparelExportSchema.parse(raw)
                  : operation === "list"
                    ? z.object({ sessionId: z.uuid() }).parse(raw)
                    : {};
      if ("sessionId" in input) z.uuid().parse(input.sessionId);
      const hash = await hashCanonicalRequest({
        userId,
        operation,
        taskId,
        input,
      });
      const data = await rpc(
        userId,
        operation,
        taskId,
        input,
        correlationId,
        hash,
      );
      if (operation === "list")
        return z.array(apparelTaskSchema).parse(data).map(hydrate);
      if (operation === "export") return apparelExportResultSchema.parse(data);
      if (operation !== "submit") return hydrate(apparelTaskSchema.parse(data));
      const claim = z
        .object({
          claimed: z.boolean(),
          runId: z.uuid().optional(),
          claimToken: z.uuid().optional(),
          plan: apparelPlanSchema.optional(),
          task: apparelTaskSchema,
        })
        .parse(data);
      if (!claim.claimed) return hydrate(claim.task);
      if (!claim.runId || !claim.claimToken || !claim.plan || !taskId)
        throw failure("invalid_claim");
      const fence = { runId: claim.runId, claimToken: claim.claimToken };
      let leaseError: unknown;
      let renewing = false;
      const renew = async () => {
        if (leaseError) throw leaseError;
        await rpc(userId, "renew", taskId, fence, correlationId);
        if (leaseError) throw leaseError;
      };
      const timer = setInterval(() => {
        if (renewing) return;
        renewing = true;
        renew()
          .catch((error) => {
            leaseError = error;
          })
          .finally(() => {
            renewing = false;
          });
      }, 25000);
      try {
        const sources = z
          .array(z.object({ id: z.uuid(), path: z.string() }))
          .parse(await rpc(userId, "sources", taskId, fence, correlationId));
        const load = async (id: string) => {
          if (leaseError) throw leaseError;
          const source = sources.find((item) => item.id === id);
          if (!source) throw failure("reference_expired");
          const response = await client.storage
            .from("uploads")
            .download(source.path);
          if (response.error || !response.data)
            throw failure("reference_expired");
          return new Uint8Array(await response.data.arrayBuffer());
        };
        for await (const page of renderApparelPages(claim.plan, load)) {
          await renew();
          const intent = z.object({ id: z.uuid(), path: z.string() }).parse(
            await rpc(
              userId,
              "register",
              taskId,
              {
                ...fence,
                name: page.name,
                width: page.width,
                height: page.height,
              },
              correlationId,
            ),
          );
          if (leaseError) throw leaseError;
          const written = await client.storage
            .from("generated")
            .upload(intent.path, page.bytes, {
              contentType: "image/jpeg",
              upsert: false,
              cacheControl: "0",
            });
          if (written.error) throw failure("storage_write_failed");
          await rpc(
            userId,
            "uploaded",
            taskId,
            { ...fence, assetId: intent.id },
            correlationId,
          );
        }
        return hydrate(
          apparelTaskSchema.parse(
            await rpc(userId, "complete", taskId, fence, correlationId),
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "排版失败，请重试。";
        try {
          await rpc(
            userId,
            "fail",
            taskId,
            { ...fence, error: message },
            correlationId,
          );
        } catch {
          /* Lease expiry recovers an interrupted request and registered Storage intents. */
        }
        if (error instanceof ApiRouteError) throw error;
        throw new ApiRouteError({
          code: "bad_request",
          status: 400,
          retryable: false,
          message,
        });
      } finally {
        clearInterval(timer);
      }
    },
  };
}
