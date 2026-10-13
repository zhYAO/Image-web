import { describe, expect, it } from 'vitest';
import { kneeFramingGuidance } from '../src/image-composition';
import { COMMERCE_TEMPLATES } from '../src/commerce-templates';

describe('explicit photographic framing', () => {
  it.each(['1:1', '3:4', '4:3', '9:16', '16:9'] as const)('keeps the requested endpoint in %s', ratio => {
    expect(kneeFramingGuidance('头到膝盖构图', ratio)).toContain(`取景硬约束（${ratio}）`);
  });
  it.each(['头顶至膝盖', '上身至膝盖', 'head-to-knee portrait', 'Head to knees',
    '请用“头到膝盖”取景，双膝可见', '写实风格的成年模特头到膝盖构图',
    '写实摄影头到膝盖构图'])('recognizes %s', range => {
    expect(kneeFramingGuidance(range, '3:4')).toContain('双膝完整可见');
  });
  it.each(['不要用头到膝盖构图', '不使用上身至膝盖构图', 'avoid head-to-knee',
    "don't use head-to-knee framing, show a face close-up", '头到膝盖构图不要，改成脸部特写',
    '不要半身，改成脸部特写', '右上只写“头到膝盖构图”', '右上只写 "head-to-knee"',
    '右上写“头到膝盖”',
    '膝盖长度裙子的特写', '陶瓷杯'])('does not infer a knee request from %s', text => {
    expect(kneeFramingGuidance(text, '1:1')).toBe('');
  });
  it('does not treat a different negated framing as negation of the requested knee endpoint', () => {
    expect(kneeFramingGuidance('不要半身，改为头到膝盖构图', '1:1')).toContain('双膝完整可见');
  });
  it('keeps the structured safe margin aligned with every published template brief', () => {
    for (const template of COMMERCE_TEMPLATES) {
      expect(template.visual.guidance).toMatch(new RegExp(`(?:边距|四边)${template.visual.safeMarginPercent}%`));
    }
  });
});
