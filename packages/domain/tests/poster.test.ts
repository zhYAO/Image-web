import { describe, expect, it } from 'vitest';
import { buildCommerceSlots, compileCommerceSlot, validateCommercePlan } from '../src/commerce';
import { COMMERCE_TEMPLATES } from '../src/commerce-templates';

const brief = { name: '周末阅读', facts: '选一本书\n留出半小时\n记录一句感想', sellingPoints: '', platform: 'xiaohongshu' as const, placement: '海报', contentMode: 'content' as const, productReferenceIds: [], styleReferenceIds: [] };
const settings = { provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '3:4' as const, resolution: '2K' as const };
describe('content posters', () => {
  it('accepts content posters without inventing product references', () => {
    const slots = buildCommerceSlots(brief, 'xhs-poster', 1, settings);
    expect(() => validateCommercePlan(brief, 'xhs-poster', slots, 'xhs-minimal')).not.toThrow();
    expect(slots[0]?.exactText).toContain('周末阅读');
    expect(compileCommerceSlot(brief, slots[0]!, 'xhs-minimal')).toContain('通用内容海报');
  });
  it('does not permit using content mode to bypass product requirements', () => {
    const slots = buildCommerceSlots(brief, 'xhs-poster', 1, settings);
    expect(() => validateCommercePlan(brief, 'product-set', slots, 'soft-studio')).toThrow();
    expect(() => validateCommercePlan({ ...brief, contentMode: 'product' }, 'xhs-poster', slots, 'xhs-fresh')).toThrow();
  });
  it('splits supplied paragraphs across cards and asks for more when insufficient', () => {
    const slots = buildCommerceSlots(brief, 'xhs-poster', 3, settings);
    expect(slots[0]?.exactText).toBe('周末阅读');
    expect(slots[1]?.exactText).not.toBe(slots[2]?.exactText);
    expect(slots.map(s => s.exactText).join('\n')).toContain('记录一句感想');
    expect(() => buildCommerceSlots({ ...brief, facts: '只有一段' }, 'xhs-poster', 4, settings)).toThrow('内容');
  });
  it('defines six distinct poster styles and versioned visual directions', () => {
    const templates = COMMERCE_TEMPLATES.filter(t => t.id.startsWith('xhs-'));
    expect(templates).toHaveLength(6);
    expect(new Set(templates.map(t => t.guidance)).size).toBe(6);
    expect(templates.every(t => t.version === '2.0.0')).toBe(true);
  });
  it('explains per-card capacity without silently cutting supplied text', () => {
    expect(() => buildCommerceSlots({ ...brief, facts: '字'.repeat(1100) }, 'xhs-poster', 1, settings)).toThrow('每张文案最多 1000');
  });
});
