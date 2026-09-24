import type { CommerceScene } from "@zimage/domain";

const sceneImages: Record<CommerceScene, string> = {
  "product-main": "product-main",
  "product-set": "selling-point",
  detail: "detail-hero",
  clone: "selling-point",
  batch: "selling-point",
  social: "social-cover",
  "style-reference": "selling-point",
  model: "model",
  "xhs-poster": "social-cover",
};
export const commerceExampleForScene = (scene: CommerceScene) =>
  `/commerce/examples/womenswear/${sceneImages[scene]}.webp`;

export const templatePreviewUrl = (templateId: string) =>
  `/commerce/templates/${templateId}-womenswear-v1.webp`;
