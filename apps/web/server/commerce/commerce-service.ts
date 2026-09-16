import { creditsEnabled, creditCall } from "@/server/credits/credit-service";
import {
  COMMERCE_TEMPLATES,
  MODEL_REGISTRY_VERSION,
  commerceCreateSchema,
  commerceSaveSchema,
  commerceSubmitSchema,
  commerceSelectSchema,
  commerceExportSchema,
  commerceTaskSchema,
  commerceCancelSchema,
  commerceArchiveSchema,
  commercePlanSchema,
  commerceExportResultSchema,
  compileCommerceSlot,
  resolveImageModel,
  type CommercePlan,
} from "@zimage/domain";
import { z } from "zod";
import { ApiRouteError } from "@/server/api-error";
import { hashCanonicalRequest } from "@/server/image/image-service";

export type CommerceOperation =
  | "list"
  | "get"
  | "create"
  | "save"
  | "submit"
  | "select"
  | "export"
  | "archive"
  | "cancel";
interface CommerceRpc {
  rpc(
    name: string,
    input: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
}
function failure(message: string) {
  if (/invalid_commerce_plan|PGRST202|commerce_not_ready/.test(message))
    return new ApiRouteError({
      code: "service_not_ready",
      status: 503,
      message: "创作服务尚未完成更新，请稍后重试；当前方案已保留。",
      retryable: true,
    });
  if (/invalid_model/.test(message))
    return new ApiRouteError({
      code: "bad_request",
      status: 400,
      message: "所选模型不支持当前比例或分辨率，请检查逐图设置。",
      retryable: false,
    });
  if (/commerce_brief_incomplete/.test(message))
    return new ApiRouteError({
      code: "bad_request",
      status: 400,
      message: "请检查标题与正文；商品模式还需要真实商品图。",
      retryable: false,
    });
  const map: Array<
    [
      RegExp,
      number,
      (
        | "conflict"
        | "not_found"
        | "asset_expired"
        | "quota_exceeded"
        | "bad_request"
        | "provider_error"
      ),
      string,
    ]
  > = [
    [
      /conflict|active_slot|slot_active|already_generated|recreate_required|task_archived|unknown_result|pending_result/,
      409,
      "conflict",
      "方案或图片状态已变化，请刷新后再确认。",
    ],
    [
      /not_found|forbidden|session_deleting|unauthorized/,
      404,
      "not_found",
      "任务或素材不存在，或无权访问。",
    ],
    [
      /expired|reference_|generation_unavailable/,
      410,
      "asset_expired",
      "参考图或结果已失效，请重新上传或选择。",
    ],
    [
      /quota/,
      429,
      "quota_exceeded",
      "本次操作额度不足，请减少提交内容或稍后重试。",
    ],
    [
      /provider_unavailable|feature_disabled/,
      503,
      "provider_error",
      "图片服务暂时不可用。",
    ],
    [
      /invalid|missing|required|brief_incomplete/,
      400,
      "bad_request",
      "请补齐商品资料并检查当前方案。",
    ],
  ];
  const result = map.find(([pattern]) => pattern.test(message));
  return new ApiRouteError(
    result
      ? {
          status: result[1],
          code: result[2],
          message: result[3],
          retryable: result[1] >= 500,
        }
      : {
          status: 503,
          code: "network",
          message: "创作任务暂时无法保存，请稍后重试。",
          retryable: true,
        },
  );
}
async function compile(plan: CommercePlan) {
  const template = COMMERCE_TEMPLATES.find(
    (t) => t.id === plan.templateId && t.published,
  );
  if (!template)
    throw new ApiRouteError({
      code: "bad_request",
      status: 400,
      message: "所选模板暂不可用。",
      retryable: false,
    });
  return Promise.all(
    plan.slots.map(async (slot) => {
      let capability;
      try {
        capability = resolveImageModel(slot).capability;
      } catch {
        throw failure("invalid_model");
      }
      if (
        !capability.aspectRatios.includes(slot.aspectRatio) ||
        !capability.resolutions.includes(slot.resolution)
      )
        throw failure("invalid_model_settings");
      let prompt: string;
      try {
        prompt = compileCommerceSlot(plan.brief, slot, plan.templateId);
      } catch (error) {
        throw new ApiRouteError({
          code: "bad_request",
          status: 400,
          message:
            error instanceof Error ? error.message : "请精简图片要求后再保存。",
          retryable: false,
        });
      }
      const config = {
        aspectRatio: slot.aspectRatio,
        resolution: slot.resolution,
        count: 1,
        referenceIds: slot.referenceIds,
        registryVersion: MODEL_REGISTRY_VERSION,
      };
      return {
        slotId: slot.id,
        prompt,
        config,
        provider: slot.provider,
        model: slot.model,
        templateVersion: template.version,
        compilerVersion: "commerce-3",
        hash: await hashCanonicalRequest({
          slot,
          prompt,
          template: template.id,
          version: template.version,
          compiler: "commerce-3",
        }),
      };
    }),
  );
}
export function createCommerceService(client: CommerceRpc) {
  return {
    async dispatch(
      userId: string,
      operation: CommerceOperation,
      taskId: string | undefined,
      raw: unknown,
      correlationId: string,
    ) {
      z.uuid().parse(userId);
      if (taskId) z.uuid().parse(taskId);
      const input =
        operation === "create"
          ? commerceCreateSchema.parse(raw)
          : operation === "save"
            ? commerceSaveSchema.parse(raw)
            : operation === "submit"
              ? commerceSubmitSchema.parse(raw)
              : operation === "select"
                ? commerceSelectSchema.parse(raw)
                : operation === "export"
                  ? commerceExportSchema.parse(raw)
                  : operation === "list"
                    ? z.object({ sessionId: z.uuid() }).parse(raw)
                    : operation === "archive"
                      ? commerceArchiveSchema.parse(raw)
                      : operation === "cancel"
                        ? commerceCancelSchema.parse(raw)
                        : {};
      if ("sessionId" in input) z.uuid().parse(input.sessionId);
      const args = {
        p_user_id: userId,
        p_operation: operation,
        p_task_id: taskId ?? null,
        p_input: input,
        p_request_hash: await hashCanonicalRequest({
          userId,
          operation,
          taskId,
          input,
        }),
        p_correlation_id: correlationId,
      };
      if (operation === "submit" && creditsEnabled())
        return commerceTaskSchema.parse(
          await creditCall(client, userId, "commerce", {
            ...input,
            taskId,
            requestHash: args.p_request_hash,
            correlationId,
          }),
        );
      if (
        "plan" in input &&
        commercePlanSchema.parse(input.plan).scene === "xhs-poster"
      ) {
        const capability = await client.rpc("get_commerce_capabilities", {});
        if (
          capability.error ||
          !(capability.data as { contentPosters?: boolean } | null)
            ?.contentPosters
        )
          throw failure("commerce_not_ready");
      }
      if ("plan" in input) {
        // Authorized replay lookup must precede the current compiler registry.
        // The write transaction checks again after compilation to close races.
        const prior = await client.rpc("commerce_dispatch", {
          ...args,
          p_compiled: null,
        });
        if (prior.error)
          throw failure(prior.error.message ?? prior.error.code ?? "");
        if (prior.data !== null) return commerceTaskSchema.parse(prior.data);
      }
      const compiled =
        "plan" in input
          ? await compile(commercePlanSchema.parse(input.plan))
          : [];
      const { data, error } = await client.rpc("commerce_dispatch", {
        ...args,
        p_compiled: compiled,
      });
      if (error) throw failure(error.message ?? error.code ?? "");
      return operation === "list"
        ? z.array(commerceTaskSchema).parse(data)
        : operation === "export"
          ? commerceExportResultSchema.parse(data)
          : commerceTaskSchema.parse(data);
    },
  };
}
