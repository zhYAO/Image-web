import type { CommerceScene } from "@zimage/domain";

const sceneImages: Record<CommerceScene, string> = {
  "apparel-catalog": "product-main",
  "product-main": "product-main",
  "product-set": "selling-point",
  detail: "detail-hero",
  clone: "selling-point",
  social: "social-cover",
  "style-reference": "selling-point",
  model: "model",
  "xhs-poster": "social-cover",
};
export const commerceExampleForScene = (scene: CommerceScene) =>
  ({ "apparel-catalog": "/commerce/apparel-v2/main-1.webp", "product-set": "/commerce/meitu-v1/kit-scene.webp", detail: "/commerce/meitu-v1/detail-hero.webp", clone: "/commerce/meitu-v1/clone-result.webp", "product-main": "/commerce/meitu-v1/shoot-botanical.webp" } as Partial<Record<CommerceScene, string>>)[scene] ?? `/commerce/examples/womenswear/${sceneImages[scene]}.webp`;

export const templatePreviewUrl = (templateId: string) =>
  `/commerce/templates/${templateId}-womenswear-v1.webp`;
