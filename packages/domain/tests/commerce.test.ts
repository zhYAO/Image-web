import { describe, expect, it } from "vitest";
import {
  buildCommerceSlots,
  compileCommerceSlot,
  nextCommerceQuestion,
  parseCommerceEdit,
  validateCommercePlan,
} from "../src/commerce";
const settings = {
  provider: "seedream",
  model: "doubao-seedream-5.0-pro",
  aspectRatio: "1:1" as const,
  resolution: "2K" as const,
};
const brief = {
  name: "陶瓷杯",
  facts: "白色，圆形杯身",
  sellingPoints: "",
  platform: "taobao" as const,
  placement: "商品展示",
  productReferenceIds: ["f3848fbc-9d96-435c-8807-e2dbbb36a168"],
  styleReferenceIds: [],
};
describe("commerce planning", () => {
  it('honors the selected artwork language while retaining exact copy and legacy defaults', () => {
    const slot = { ...buildCommerceSlots(brief, 'product-set', 1, settings)[0]!, textMode: 'exact' as const, exactText: 'Ceramic cup' };
    const english = compileCommerceSlot({ ...brief, region: 'us', language: 'en' }, slot, 'soft-studio');
    expect(english).toContain('目标语言（en）');
    expect(english).toContain('仅绘制以下确认文案：Ceramic cup');
    expect(english).not.toContain('所有文字使用简体中文');
    expect(compileCommerceSlot(brief, slot, 'soft-studio')).toContain('目标语言（zh-CN）');
    expect(compileCommerceSlot({ ...brief, language: 'none' }, slot, 'soft-studio')).toContain('文字：不添加营销文字');
  });
  it('includes the full description and preserves legacy, automatic, exact and no-text copy rules', () => {
    const described = { ...brief, description: '米白色棉质衬衫。宽松版型，适合通勤。' };
    const slot = { ...buildCommerceSlots(brief, 'product-set', 1, settings)[0]!, exactText: '已确认文字' };
    const compile = (textMode?: 'auto' | 'exact' | 'none') => compileCommerceSlot(described, { ...slot, textMode }, 'soft-studio');
    expect(compile()).toContain('仅绘制以下确认文案：已确认文字');
    expect(compile('exact')).toContain('仅绘制以下确认文案：已确认文字');
    expect(compile('none')).toContain('文字：不添加营销文字');
    expect(compile('none')).not.toContain('仅绘制以下确认文案');
    expect(compile('auto')).toContain(described.description);
    expect(compile('auto')).toContain('提炼适合本张角色');
    expect(compile('auto')).not.toContain('仅绘制以下确认文案');
  });
  it('compiles different art direction for each ecommerce role even with one shared style', () => {
    const slots = buildCommerceSlots(brief, 'product-set', 5, settings);
    const prompts = slots.map((slot) => compileCommerceSlot(brief, slot, 'soft-studio'));
    expect(prompts[0]).toContain('纯白');
    expect(prompts[1]).toContain('信息层级');
    expect(prompts[2]).toContain('微距');
    expect(prompts[3]).toContain('真实使用环境');
    expect(prompts[4]).toContain('信息模块');
    expect(prompts.every((prompt) => prompt.includes('成品图'))).toBe(true);
  });
  it("asks a single blocking question and requires an actual product reference", () => {
    expect(
      nextCommerceQuestion(
        { ...brief, name: "", productReferenceIds: [] },
        "product-set",
      ),
    ).toContain("商品图");
    expect(
      nextCommerceQuestion({ ...brief, name: "" }, "product-set"),
    ).toContain("名称");
    expect(nextCommerceQuestion(brief, "product-set")).toBeUndefined();
  });
  it("creates independently addressed roles without inventing specifications", () => {
    const slots = buildCommerceSlots(brief, "product-set", 5, settings);
    expect(new Set(slots.map((x) => x.id)).size).toBe(5);
    expect(new Set(slots.map((x) => x.role)).size).toBe(5);
    expect(slots.every((x) => !x.exactText)).toBe(true);
    expect(compileCommerceSlot(brief, slots[0]!, "soft-studio")).toContain(
      "不得编造",
    );
    expect(compileCommerceSlot(brief, slots[0]!, "soft-studio")).toBe(
      compileCommerceSlot(brief, slots[0]!, "soft-studio"),
    );
  });
  it("describes reference roles in the actual submitted image order", () => {
    const styleId = crypto.randomUUID();
    const productId = brief.productReferenceIds[0]!;
    const slot = buildCommerceSlots(brief, "product-main", 1, settings)[0]!;
    slot.referenceIds = [styleId, productId];
    const compiled = compileCommerceSlot(
      { ...brief, styleReferenceIds: [styleId] },
      slot,
      "soft-studio",
    );
    expect(compiled).toContain("第1张参考图是风格图");
    expect(compiled).toContain("第2张参考图是真实商品图");
    expect(compiled).not.toContain(styleId);
  });

  it("rejects incompatible model options and scene-specific limits", () => {
    const slots = buildCommerceSlots(brief, "product-set", 5, settings);
    expect(() =>
      validateCommercePlan(
        brief,
        "product-set",
        slots.map((x) => ({ ...x, resolution: "1K" })),
      ),
    ).toThrow();
    expect(() =>
      buildCommerceSlots(brief, "product-set", 21, settings),
    ).toThrow();
    expect(() =>
      validateCommercePlan(
        {
          ...brief,
          styleReferenceIds: Array.from({ length: 9 }, () =>
            crypto.randomUUID(),
          ),
        },
        "product-set",
        slots,
      ),
    ).toThrow();
  });
  it("rejects combined text overflow without silently truncating confirmed facts", () => {
    const slot = buildCommerceSlots(brief, "product-set", 1, settings)[0]!;
    const facts = "事".repeat(4000),
      sellingPoints = "卖".repeat(2000);
    expect(() =>
      compileCommerceSlot(
        { ...brief, facts, sellingPoints },
        {
          ...slot,
          instruction: "求".repeat(2000),
          exactText: "字".repeat(1000),
        },
        "soft-studio",
      ),
    ).toThrow("8000");
    expect(
      compileCommerceSlot(
        { ...brief, facts },
        { ...slot, instruction: "细节保真" },
        "soft-studio",
      ),
    ).toContain(facts);
  });
  it('keeps each of 20 clone references in its own generation input', () => {
    const references = Array.from({ length: 20 }, () => crypto.randomUUID());
    const cloneBrief = { ...brief, productReferenceIds: brief.productReferenceIds, styleReferenceIds: references, cloneMode: 'faithful' as const };
    const slots = buildCommerceSlots(cloneBrief, 'clone', 20, settings);
    expect(slots).toHaveLength(20);
    expect(slots.every((slot, index) => slot.referenceIds.length === 2 && slot.referenceIds[1] === references[index])).toBe(true);
    expect(() => validateCommercePlan(cloneBrief, 'clone', slots)).not.toThrow();
    expect(() => validateCommercePlan({ ...cloneBrief, styleReferenceIds: [...references, crypto.randomUUID()] }, 'clone', slots)).toThrow();
  });
  it('accepts six product images and a 16-module dual-version A+ plan', () => {
    const detailed = { ...brief, productReferenceIds: Array.from({ length: 6 }, () => crypto.randomUUID()) };
    const slots = buildCommerceSlots(detailed, 'detail', 32, settings).map((slot, index) => ({ ...slot,
      outputSpec: index < 16 ? 'desktop' as const : 'mobile' as const,
      targetWidth: index < 16 ? 1464 : 600, targetHeight: index < 16 ? 600 : 450 }));
    expect(() => validateCommercePlan(detailed, 'detail', slots)).not.toThrow();
    expect(() => validateCommercePlan(detailed, 'detail', [{ ...slots[0]!, targetWidth: 970 }])).toThrow('A+ 输出规格与目标像素不一致');
    expect(() => validateCommercePlan(detailed, 'detail', [...slots, { ...slots[0]!, id: crypto.randomUUID() }])).toThrow();
  });
  it("targets an explicit slot and refuses ambiguous discussion", () => {
    expect(parseCommerceEdit("第三张背景换成米色", 5)).toEqual({
      indexes: [2],
      instruction: "第三张背景换成米色",
    });
    expect(parseCommerceEdit("这一套改成暖色", 5)?.indexes).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(parseCommerceEdit("你觉得第三张怎么样？", 5)).toBeUndefined();
    expect(parseCommerceEdit("第九张换背景", 5)).toBeUndefined();
  });
});
