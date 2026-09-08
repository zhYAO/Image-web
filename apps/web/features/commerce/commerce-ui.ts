import {
  COMMERCE_SCENES,
  COMMERCE_TEMPLATES,
  hasExplicitImageIntent,
  type CommerceScene,
  type CommerceTask,
  type CommercePlan,
  type GenerationBatch,
  type CommerceGateway,
  type CommerceItem,
} from "@zimage/domain";
import { downloadImages } from "@/features/workspace/download-images";

export function resolveCommerceLaunch(search: string) {
  const params = new URLSearchParams(search);
  const scene = COMMERCE_SCENES.find(
    (entry) => entry.id === params.get("scene"),
  )?.id;
  const platform = ["taobao", "douyin", "xiaohongshu"].find(
    (entry) => entry === params.get("platform"),
  ) as CommercePlan["brief"]["platform"] | undefined;
  return { scene, platform };
}

export function defaultTemplate(scene: CommerceScene) {
  return scene === "product-main"
    ? "white-main"
    : scene === "social"
      ? "social-cover"
      : scene === "detail"
        ? "detail-hero"
        : "soft-studio";
}

export function planOf(task: CommerceTask): CommercePlan {
  return {
    scene: task.scene,
    brief: task.brief,
    templateId: task.templateId,
    slots: task.slots,
  };
}

export const templateName = (id: string) =>
  COMMERCE_TEMPLATES.find((template) => template.id === id)?.name ?? id;

/** Explicit generic image intent only. Enabling the tool never authorizes discussion. */
export function isExplicitImageRequest(message: string) {
  return !isCommerceDiscussion(message) && hasExplicitImageIntent(message);
}

export function isCommerceDiscussion(message: string) {
  return /[?？]|(?:不要|别|暂不|先不).*(?:生成|画|制作)|(?:讨论|分析|建议|怎么样|如何|怎么)/.test(
    message,
  );
}

export async function exportCommerceImages(
  gateway: CommerceGateway,
  task: CommerceTask,
  slotIds: string[],
) {
  const selections = task.slots
    .filter((slot) => slotIds.includes(slot.id))
    .flatMap((slot) => {
      const selection = task.selections.find((item) => item.slotId === slot.id);
      return selection
        ? [{ slotId: slot.id, generationId: selection.generationId }]
        : [];
    });
  if (!selections.length) throw new Error("当前没有已选图片。");
  const snapshot = await gateway.export(task.id, {
    requestId: crypto.randomUUID(),
    revision: task.revision,
    selections,
  });
  const slot = task.slots[0];
  if (!slot) throw new Error("方案缺少图片。");
  const batch: GenerationBatch = {
    id: snapshot.id,
    sessionId: task.sessionId,
    createdAt: snapshot.createdAt,
    prompt: task.brief.name,
    provider: slot.provider,
    model: slot.model,
    source: "direct",
    status: "succeeded",
    config: {
      aspectRatio: slot.aspectRatio,
      resolution: slot.resolution,
      count: snapshot.items.length,
    },
    assets: snapshot.items.map((item) => ({
      id: item.generationId,
      status: "succeeded",
      url: item.url,
      expired: item.expired,
    })),
  };
  const result = await downloadImages(batch);
  const expired = snapshot.items.filter(
    (item) => item.expired || !item.url,
  ).length;
  return `已发起 ${result.downloaded} 张下载${expired ? `，${expired} 张已到期或不可用` : ""}${result.failed ? `，${result.failed} 张下载失败，请重试` : ""}。`;
}

export function unsettledCommerceItem(item: CommerceItem | undefined) {
  return Boolean(
    item &&
    (["pending", "processing"].includes(item.status) ||
      /provider_result_unknown|provider_reconciliation_required|result_storage_failed|result_unknown|storage_pending/i.test(
        item.error ?? "",
      )),
  );
}

export function commerceItemNeedsReview(item: CommerceItem | undefined) {
  return Boolean(
    item &&
    /provider_result_unknown|provider_reconciliation_required|result_unknown/i.test(
      item.error ?? "",
    ),
  );
}
