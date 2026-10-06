import type { ApparelPlan } from "@zimage/domain";
export const apparelIds = Array.from(
  { length: 8 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);
export const apparelFixture: ApparelPlan = {
  engine: "apparel-catalog",
  scene: "apparel-catalog",
  layoutVersion: "1.0.0",
  brief: {
    name: "亚麻衬衫",
    sku: "A1",
    color: "米白",
    composition: "100 亚麻",
    care: "冷水手洗，阴凉处晾干。",
    size: "M",
    measurements: { length: "65", chest: "100", shoulder: "40", sleeve: "58" },
    weightRecommendation: "45 - 55kg",
    design: "自然舒适的日常衬衫，简洁的线条适合通勤穿搭。",
    fabric: "轻盈透气的亚麻面料，保留自然质感。",
  },
  sources: {
    mains: apparelIds.slice(0, 5),
    displays: [{ id: apparelIds[5]!, name: "展示1.jpg" }],
    logo: apparelIds[6]!,
  },
  fabricCrop: [0.24, 0.2, 0.76, 0.57],
};
