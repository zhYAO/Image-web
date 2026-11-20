import {
  apparelCreateSchema,
  apparelSaveSchema,
  apparelSelectSchema,
  apparelExportSchema,
  apparelTaskSchema,
  apparelExportResultSchema,
  type ApparelTask,
} from "@zimage/domain";
import { z } from "zod";
import { ApiRouteError } from "@/server/api-error";
import { apparelRenderRetired } from "./apparel-render-retired";
import { hashCanonicalRequest } from "@/server/image/image-service";
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
      if (operation === "submit") throw apparelRenderRetired();
      const input =
        operation === "create"
          ? apparelCreateSchema.parse(raw)
          : operation === "save"
            ? apparelSaveSchema.parse(raw)
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
      return hydrate(apparelTaskSchema.parse(data));
    },
  };
}
