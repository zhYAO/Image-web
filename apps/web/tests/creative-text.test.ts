import { describe, expect, it } from 'vitest';
import { optimizeCreativeText, validateOptimizedText } from '@/server/creative-text/creative-text-service';

describe('field optimization safeguards', () => {
  it('rejects changed product facts and invented specs', () => {
    const input = { field: 'facts' as const, text: '小米 X20 500ml', maxLength: 100 };
    expect(() => validateOptimizedText(input, '小米 X20 600ml')).toThrow();
    expect(() => validateOptimizedText(input, '苹果 X20 500ml')).toThrow();
    expect(() => validateOptimizedText(input, '小米 X20 500ml 防水')).toThrow();
    expect(validateOptimizedText(input, '小米 X20，500ml')).toBe('小米 X20，500ml');
  });
  it('allows selling point rewrites while retaining numbers and model identifiers', () => {
    const input = { field: 'sellingPoints' as const, text: 'X20 500ml 轻便易携' };
    expect(validateOptimizedText(input, '轻松携带，X20 500ml')).toBe('轻松携带，X20 500ml');
    expect(() => validateOptimizedText(input, '轻松携带，X30 500ml')).toThrow();
    expect(() => validateOptimizedText(input, '轻松携带，X20 600ml')).toThrow();
    expect(() => validateOptimizedText({ field: 'sellingPoints', text: '耐温 -5℃，容量 500毫升' }, '耐温 5℃，容量 500克')).toThrow();
  });
  it('rejects empty, oversized and malformed model output', async () => {
    const input = { field: 'instruction' as const, text: '突出商品', maxLength: 10 };
    for (const output of ['{}', '{"text":""}', '{"text":"12345678901"}', 'plain text']) {
      await expect(optimizeCreativeText(input, async function* () { yield output; })).rejects.toThrow();
    }
  });
  it('assembles a valid response without starting a conversation', async () => {
    const result = await optimizeCreativeText({ field: 'instruction', text: '突出商品' }, async function* () {
      yield '{"text":"'; yield '突出商品主体，保持背景简洁。"}';
    });
    expect(result).toEqual({ text: '突出商品主体，保持背景简洁。', mock: false, changeType: 'rewritten' });
  });
  it('allows improving a visual role instead of treating it as an immutable product fact', () => {
    expect(validateOptimizedText({ field: 'role', text: '卖点图' }, '核心卖点展示图')).toBe('核心卖点展示图');
  });
  it('permits a supplied product parameter in expanded copy but rejects invented or changed parameters', () => {
    const input = { field: 'sellingPoints' as const, text: '轻便易携', productContext: { name: '小米 X20', facts: '容量 500ml' } };
    expect(validateOptimizedText(input, '小米 X20，500ml 随身携带。')).toContain('500ml');
    expect(() => validateOptimizedText(input, '小米 X30，600ml 随身携带。')).toThrow();
    expect(() => validateOptimizedText({ ...input, text: 'X20 500ml 轻便易携' }, 'X20 600ml 随身携带。')).toThrow();
  });
  it('accepts structured context and generates one bounded expansion, preserving unchanged classification', async () => {
    let calls = 0;
    const result = await optimizeCreativeText({ field: 'description', text: '宽松衬衫', productContext: { platform: 'taobao', scene: 'product-set', facts: '棉质面料', designStyle: '简洁' } }, async function* (prompt) {
      calls++;
      expect(prompt).toContain('棉质面料');
      yield JSON.stringify({ text: '宽松版型的棉质衬衫，呈现简洁利落的穿搭风格。' });
    });
    expect(calls).toBe(1);
    expect(result.changeType).toBe('rewritten');
    const unchanged = await optimizeCreativeText({ field: 'name', text: '衬衫' }, async function* () { yield '{"text":"衬衫"}'; });
    expect(unchanged.changeType).toBe('unchanged');
  });
});
