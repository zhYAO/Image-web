import { COMMERCE_SCENES, type CommerceScene } from "@zimage/domain";
import { commerceExampleForScene } from "@/features/commerce/commerce-examples";

const tags: [CommerceScene, string][] = [
  ["product-set", "风格统一"],
  ["detail", "卖点呈现"],
  ["clone", "灵感再创作"],
  ["product-main", "场景塑造"],
  ["apparel-catalog", "服装展示"],
];
/** Presentation metadata only. Business scene IDs and capabilities remain domain-owned. */
export const scenes = tags.map(([id, tag]) => {
  const scene = COMMERCE_SCENES.find((item) => item.id === id)!;
  return {
    id,
    name: scene.name,
    description: scene.description,
    tag,
    image: commerceExampleForScene(id),
  };
});
