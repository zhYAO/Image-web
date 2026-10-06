import { describe, expect, it } from "vitest";
import { apparelPlanSchema, apparelOutputNames } from "../src";
const ids = Array.from(
  { length: 26 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
export const apparelPlan = {
  engine: "apparel-catalog",
  scene: "apparel-catalog",
  layoutVersion: "1.0.0",
  brief: {
    name: "亚麻衬衫",
    sku: "A1",
    color: "米白",
    composition: "100 亚麻",
    care: "冷水手洗",
    size: "M",
    measurements: { length: "65", chest: "100", shoulder: "40", sleeve: "58" },
    weightRecommendation: "45-55kg",
    design: "自然舒适的日常衬衫。",
    fabric: "轻盈透气的亚麻面料。",
  },
  sources: {
    mains: ids.slice(0, 5),
    displays: [
      { id: ids[5], name: "展示10.jpg" },
      { id: ids[6], name: "展示2.jpg" },
    ],
    logo: ids[7],
  },
  fabricCrop: [0.24, 0.2, 0.76, 0.57],
};
describe("apparel catalog input and output contract", () => {
  it("accepts a form-based plan without AI provider/model parameters", () => {
    const plan = apparelPlanSchema.parse(apparelPlan);
    expect(plan.sources.displays.map((source) => source.name)).toEqual([
      "展示2.jpg",
      "展示10.jpg",
    ]);
    expect(plan).not.toHaveProperty("model");
    expect(apparelOutputNames(plan)).toEqual([
      "主图/1.jpg",
      "主图/2.jpg",
      "主图/3.jpg",
      "主图/4.jpg",
      "主图/5.jpg",
      "images/详情2_01.jpg",
      "images/详情2_03.jpg",
      "images/详情2_04.jpg",
      "images/详情2_05.jpg",
      "images/详情2_06.jpg",
      "images/详情2_07.jpg",
      "images/详情2_08.jpg",
    ]);
  });
  it("limits display uploads to twenty and produces thirty names without detail 02", () => {
    const plan = apparelPlanSchema.parse({
      ...apparelPlan,
      sources: {
        mains: ids.slice(0, 5),
        logo: ids[25],
        displays: ids
          .slice(5, 25)
          .map((id, index) => ({ id, name: `展示${index + 1}.jpg` })),
      },
    });
    expect(apparelOutputNames(plan)).toHaveLength(30);
    expect(apparelOutputNames(plan).at(-1)).toBe("images/详情2_26.jpg");
    expect(apparelOutputNames(plan)).not.toContain("images/详情2_02.jpg");
    expect(
      apparelPlanSchema.safeParse({
        ...plan,
        sources: {
          ...plan.sources,
          displays: [
            ...plan.sources.displays,
            { id: crypto.randomUUID(), name: "21.jpg" },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("rejects missing sources, duplicates and out-of-bounds crop", () => {
    expect(
      apparelPlanSchema.safeParse({
        ...apparelPlan,
        sources: { ...apparelPlan.sources, mains: ids.slice(0, 4) },
      }).success,
    ).toBe(false);
    expect(
      apparelPlanSchema.safeParse({
        ...apparelPlan,
        sources: { ...apparelPlan.sources, logo: ids[0] },
      }).success,
    ).toBe(false);
    expect(
      apparelPlanSchema.safeParse({
        ...apparelPlan,
        fabricCrop: [0.8, 0, 0.3, 1],
      }).success,
    ).toBe(false);
  });
});
