import type { CommerceScene } from "@zimage/domain";

const roleImages: Record<string, string> = {
  商品主图: "product-main",
  核心卖点: "selling-point",
  材质细节: "material-detail",
  使用场景: "daily-scene",
  商品说明: "spec-layout",
  详情首屏: "detail-hero",
  种草封面: "social-cover",
  生活场景: "daily-scene",
  细节说明: "material-detail",
  风格创作: "selling-point",
  模特展示: "model",
};
export const commerceExampleForRole = (role: string = "商品主图") =>
  `/commerce/examples/womenswear/${roleImages[role] ?? "product-main"}.webp`;
export const commerceExampleForScene = (scene: CommerceScene) =>
  `/commerce/examples/womenswear/${
    {
      "product-main": "product-main",
      "product-set": "selling-point",
      detail: "detail-hero",
      social: "social-cover",
      "style-reference": "selling-point",
      model: "model",
    }[scene]
  }.webp`;
