import { getWorkspaceGateway } from "./index";
import { HttpWorkspaceGateway } from "./http-workspace-gateway";
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
  const gateway = getWorkspaceGateway();
  if (!(gateway instanceof HttpWorkspaceGateway)) throw new Error('HTTP workspace is unavailable');
  const scope = gateway.createOwnerScope(() => !signal?.aborted);
  try { return await scope.gateway.optimizeText(input, signal); }
  finally { scope.dispose(); }
}
