import { retainCreditRequest, completeCreditRequest, rejectCreditRequest } from "./pending-credit-request";
import { getWorkspaceGateway } from "./index";
import { notifyCreditsChanged } from "./mock-credit-ledger";
import {
  creativeTextFieldLimits,
  creativeTextOptimizeRequestSchema,
  creativeTextOptimizeResponseSchema,
  type CreativeTextOptimizeRequest,
} from "@zimage/domain";

/** Stateless auxiliary request: never writes session, timeline, or image state. */
export async function requestCreativeTextOptimization(
  value: CreativeTextOptimizeRequest,
  signal?: AbortSignal,
) {
  const input = creativeTextOptimizeRequestSchema.parse({
    ...value,
    context: value.context?.slice(0, 2000),
  });
  signal?.throwIfAborted();
  const mode = process.env.NEXT_PUBLIC_DATA_MODE ?? "mock";
  if (mode === "mock") {
    if (input.field === 'strategy') {
      const modules = input.text.split('\n').find(line => line.startsWith('模块：'))?.slice(3).split('、') ?? [];
      return creativeTextOptimizeResponseSchema.parse({ text: JSON.stringify({ strategy: '主体清晰、构图统一，逐屏说明已确认的商品特点；保持字体和配色一致。', modules: modules.map(name => ({ name, copy: input.productContext?.sellingPoints || input.productContext?.facts || input.productContext?.description || input.productContext?.name || '' })) }), mock: true });
    }
    if (input.field === 'listingCopy') return creativeTextOptimizeResponseSchema.parse({ text: JSON.stringify({ title: input.productContext?.name || '', highlights: input.productContext?.sellingPoints || '', description: input.productContext?.description || input.productContext?.facts || '', keywords: input.productContext?.name || '' }), mock: true });
    if (input.billing) {
      const result = await getWorkspaceGateway().optimizeText?.(input);
      if (result) return result;
    }
    let text = input.text.replace(/[ \t]+/g, ' ').replace(/(?<!\d)[,;]|[,;](?!\d)/g, '，');
    if (!/[。！？.!?]$/.test(text) && text.length < Math.min(input.maxLength ?? 6000, creativeTextFieldLimits[input.field])) text += '。';
    return creativeTextOptimizeResponseSchema.parse({ text, mock: true });
  }
  if (mode !== "http") throw new Error("Unsupported data mode");
  const pending=retainCreditRequest("/api/creative-text/optimize",JSON.stringify(input));
  const response = await fetch("/api/creative-text/optimize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: pending?.body??JSON.stringify(input),
    signal,
  });
  notifyCreditsChanged();
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    rejectCreditRequest(pending,error);
    throw Object.assign(new Error(error?.message ?? "优化失败，请稍后重试。"),{userMessage:true,newRequest:["provider_error","price_changed","insufficient_credits","quota_exceeded","bad_request"].includes(error?.code)});
  }
  const result = creativeTextOptimizeResponseSchema.parse(
    await response.json(),
  );
  if (result.text.length > Math.min(input.maxLength ?? 6000, creativeTextFieldLimits[input.field])) throw new Error('optimized_text_too_long');
  completeCreditRequest(pending);
  return result;
}
