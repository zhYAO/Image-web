import { describe, expect, it } from 'vitest';
import { buildCommerceSlots, compileCommerceSlot } from '../src/commerce';

const brief = {
  name: '米白衬衫', facts: '六颗门襟扣，两颗袋扣', sellingPoints: '',
  platform: 'taobao' as const, placement: '商品展示',
  productReferenceIds: [crypto.randomUUID()], styleReferenceIds: [],
};
const settings = { provider: 'seedream', model: 'doubao-seedream-5.0-pro',
  aspectRatio: '3:4' as const, resolution: '2K' as const };

describe('commerce composition constraints', () => {
  it('gives an explicit knee framing priority over a studio template subject size', () => {
    const slot = { ...buildCommerceSlots(brief, 'model', 1, settings)[0]!,
      instruction: '成年模特穿衬衫与白裤，上身至膝盖，双手放低' };
    const prompt = compileCommerceSlot(brief, slot, 'soft-studio');
    expect(prompt).toContain(slot.instruction);
    expect(prompt).toContain('取景硬约束（3:4）');
    expect(prompt).toContain('双膝完整可见');
    expect(prompt).toContain('膝盖下方');
    expect(prompt).toContain('3:4');
    expect(prompt).toContain('用户明确的取景范围 > 图片角色');
    expect(prompt).toContain('缩小人物占比');
  });
  it('does not let an older visual strategy impose knee framing after a slot requests a closeup', () => {
    const slot = { ...buildCommerceSlots(brief, 'model', 1, settings)[0]!, instruction: '改为脸部特写' };
    const prompt = compileCommerceSlot({ ...brief, visualStrategy: '成年模特头到膝盖构图' }, slot, 'soft-studio');
    expect(prompt).not.toContain('取景硬约束（3:4）');
    expect(prompt).toContain(slot.instruction);
  });
  it('applies an 8% inset to the whole detail composition on each independent axis', () => {
    const slot = { ...buildCommerceSlots(brief, 'social', 1, settings)[0]!, role: '细节说明',
      instruction: '整体加翻领和双胸袋两个特写，四边8%安全留白',
      exactText: '米白衬衫\n翻领设计\n双胸袋' };
    const prompt = compileCommerceSlot(brief, slot, 'detail-module');
    expect(prompt).toContain('左右各至少画布宽度的8%，上下各至少画布高度的8%');
    expect(prompt).toContain('横向8%–92%、纵向8%–92%');
    expect(prompt).toContain('商品整体、全部特写模块及其边框、文字');
    expect(prompt).toContain('不能只给文字留白');
    expect(prompt).toContain('不裁切商品');
    expect(prompt).toContain(`仅绘制以下确认文案：${slot.exactText}`);
    // Exact copy is content, so it must not trigger a photographic framing rule.
    expect(compileCommerceSlot(brief, { ...slot, exactText: '头到膝盖构图' }, 'detail-module'))
      .not.toContain('双膝完整可见');
  });
  it.each([['white-main', 12], ['spec-layout', 10]])('retains the larger %s template inset', (template, margin) => {
    const slot = buildCommerceSlots(brief, 'product-main', 1, settings)[0]!;
    expect(compileCommerceSlot(brief, slot, template))
      .toContain(`左右各至少画布宽度的${margin}%，上下各至少画布高度的${margin}%`);
  });
});
