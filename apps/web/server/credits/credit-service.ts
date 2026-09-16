import {
  TRIAL_CREDIT_CATALOG,
  creditCatalogSchema,
  creditLedgerSchema,
  creditQuoteSchema,
  creditWalletSchema,
  type CreditConfirmation,
} from "@zimage/domain";
import { z } from "zod";
import { ApiRouteError } from "@/server/api-error";

export const creditsEnabled = () =>
  process.env.ZIMAGE_CREDITS_ENABLED === "true";
export interface CreditRpc {
  rpc(
    name: string,
    input: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
}
export function creditFailure(
  error: { message?: string; code?: string } | null,
): ApiRouteError {
  const message = error?.message ?? "";
  if (message.includes("insufficient_credits"))
    return new ApiRouteError({
      code: "insufficient_credits",
      status: 402,
      message: "可用积分不足，请减少生成数量或查看账号积分。",
      retryable: false,
    });
  if (/credit_price_changed|credit_request_id_required/.test(message))
    return new ApiRouteError({
      code: "price_changed",
      status: 409,
      message: "价格或确认信息已变化，请重新查看费用后确认。",
      retryable: false,
    });
  if (/idempotency_conflict|revision_conflict/.test(message))
    return new ApiRouteError({
      code: "conflict",
      status: 409,
      message: "这次请求或方案已变化，请重新确认。",
      retryable: false,
    });
  if (/quota/.test(message))
    return new ApiRouteError({
      code: "quota_exceeded",
      status: 429,
      message: "今日图片额度或请求额度不足，请稍后重试。",
      retryable: false,
    });
  if (/credit_result_pending|credit_operation_not_found/.test(message))
    return new ApiRouteError({
      code: "billing_pending",
      status: 409,
      message: "结果正在核对，冻结积分暂时保留，请勿重复提交。",
      retryable: false,
    });
  if (/not_found|unauthorized/.test(message))
    return new ApiRouteError({
      code: "not_found",
      status: 404,
      message: "记录不存在或无权访问。",
      retryable: false,
    });
  if (/reference_|expired/.test(message))
    return new ApiRouteError({
      code: "asset_expired",
      status: 410,
      message: "参考图已失效，请重新上传或选择。",
      retryable: false,
    });
  if (/provider_reconciliation|unknown|active|pending/.test(message))
    return new ApiRouteError({
      code: "billing_pending",
      status: 409,
      message: "已有生成结果待核对，请勿重复生成。",
      retryable: false,
    });
  if (/provider_unavailable|feature_disabled/.test(message))
    return new ApiRouteError({
      code: "provider_error",
      status: 503,
      message: "所选模型暂不可用，请选择其他模型。",
      retryable: false,
    });
  if (/invalid_|no_generations/.test(message))
    return new ApiRouteError({
      code: "bad_request",
      status: 400,
      message: "请检查当前模型、参数与选中图片。",
      retryable: false,
    });
  return new ApiRouteError({
    code: "service_not_ready",
    status: 503,
    message: "积分服务尚未就绪，请稍后重新加载。",
    retryable: true,
  });
}
export async function creditCall(
  client: CreditRpc,
  userId: string,
  action: string,
  input: Record<string, unknown> = {},
) {
  const { data, error } = await client.rpc("credit_dispatch", {
    p_user_id: userId,
    p_action: action,
    p_input: input,
  });
  if (error || data === null) throw creditFailure(error);
  return data;
}
export const readCredits = async (c: CreditRpc, u: string) =>
  creditWalletSchema.parse(await creditCall(c, u, "wallet"));
export const readLedger = async (c: CreditRpc, u: string, cursor?: string) =>
  creditLedgerSchema.parse(await creditCall(c, u, "ledger", { cursor }));
export const readPrices = async (c: CreditRpc, u: string) => {
  const { data, error } = await c.rpc("credit_dispatch", {
    p_user_id: u,
    p_action: "catalog",
    p_input: {},
  });
  if (error || data === null) {
    // Compatibility deployment may precede the additive wallet migration.
    if (!creditsEnabled() && ["PGRST202", "42883"].includes(error?.code ?? ""))
      return { ...TRIAL_CREDIT_CATALOG, enabled: false };
    throw creditFailure(error);
  }
  const catalog = creditCatalogSchema.parse(data);
  return { ...catalog, enabled: catalog.enabled && creditsEnabled() };
};
export const readQuote = async (
  c: CreditRpc,
  u: string,
  input: Record<string, unknown>,
) => creditQuoteSchema.parse(await creditCall(c, u, "quote", input));
const textOperationSchema = z.object({
  id: z.uuid(),
  status: z.enum([
    "reserved",
    "processing",
    "result",
    "succeeded",
    "refunded",
    "needs_review",
  ]),
  result: z.record(z.string(), z.unknown()).nullable(),
  started: z.unknown().nullable(),
  session_id: z.string().nullable(),
});
export type TextOperation = z.infer<typeof textOperationSchema>;
export async function startText(
  c: CreditRpc,
  u: string,
  input: {
    requestId?: string;
    operation: "chat" | "optimize";
    model: string;
    billing?: CreditConfirmation;
    input: unknown;
  },
) {
  if (!input.requestId)
    throw creditFailure({ message: "credit_request_id_required" });
  return textOperationSchema.parse(await creditCall(c, u, "text_start", input));
}
export async function textStep(
  c: CreditRpc,
  u: string,
  requestId: string,
  step: string,
  extra: Record<string, unknown> = {},
) {
  return textOperationSchema.parse(
    await creditCall(c, u, `text_${step}`, { requestId, ...extra }),
  );
}
export function pendingCreditError() {
  return new ApiRouteError({
    code: "billing_pending",
    status: 409,
    message: "本次调用正在处理或等待核对，请保留原请求稍后恢复。",
    retryable: false,
  });
}
