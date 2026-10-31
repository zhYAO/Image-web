import { describe, expect, it } from 'vitest';
import { optimizeCreativeText, validateOptimizedText } from '@/server/creative-text/creative-text-service';

describe('field optimization safeguards', () => {
  it.each([
    { strategy: '简洁留白' },
    { strategy: '简洁留白', modules: [] },
    { strategy: '简洁留白', modules: [{ name: '品牌首屏', copy: '陶瓷杯' }] },
    { strategy: '简洁留白', modules: [{ name: '品牌首屏', copy: '陶瓷杯' }, { name: '品牌首屏', copy: '陶瓷杯' }] },
    { strategy: '简洁留白', modules: [{ name: '品牌首屏', copy: '陶瓷杯' }, { name: '未知模块', copy: '陶瓷杯' }] },
  ])('rejects an unusable structured strategy before billing completion %#', output => {
    expect(() => validateOptimizedText({ field: 'strategy', text: '模块：品牌首屏、核心卖点', expectedModules: ['品牌首屏', '核心卖点'] }, JSON.stringify(output))).toThrow();
  });
  it.each(['B100 陶瓷杯 500毫升', 'A100 陶瓷杯 500千克', 'A100 陶瓷杯 50毫升', 'A100 陶瓷杯 耐温 5℃'])('protects model identifiers and complete quantities in structured copy: %s', copy => {
    const input = { field: 'listingCopy' as const, text: '生成上架文案', productContext: { facts: 'A100 陶瓷杯 容量 500毫升，耐温 -5℃' } };
    expect(() => validateOptimizedText(input, JSON.stringify({ title: copy, highlights: '', description: '', keywords: '' }))).toThrow();
  });
  it('accepts ordinary translated words and equivalent unit spellings in structured copy', () => {
    const output = JSON.stringify({ title: 'A100 ceramic cup', highlights: 'Capacity 500 ml', description: 'Temperature -5°C', keywords: 'ceramic travel cup' });
    expect(validateOptimizedText({ field: 'listingCopy', text: '生成上架文案', productContext: { facts: 'A100 陶瓷杯 容量 500毫升，耐温 -5℃', language: 'en' } }, output)).toBe(output);
  });
  it.each([
    ['型号 24Pro', '型号 24Max'],
    ['储存 128GB', '储存 128TB'],
    ['数量 500', '重量 500吨'],
    ['重量 5g', '支持 5G'],
    ['型号 AB-100', '型号 CD-100'],
    ['容量 500毫升', '容量 500ML'],
    ['功率 500瓦时', '功率 500瓦'],
  ])('retains complete model and unit tokens from %s instead of accepting %s', (facts, copy) => {
    for (const field of ['listingCopy', 'strategy'] as const) {
      const output = field === 'listingCopy'
        ? { title: copy, highlights: '', description: '', keywords: '' }
        : { strategy: '简洁留白', modules: [{ name: '品牌首屏', copy }] };
      expect(() => validateOptimizedText({ field, text: '生成文案', productContext: { facts } }, JSON.stringify(output))).toThrow();
    }
  });
  it.each([
    ['24Pro 陶瓷杯 500毫升', '24Pro ceramic cup, 500 mL capacity'],
    ['128GB 储存', '128GB storage for everyday use'],
    ['AB-100 重量 5克', 'AB-100, weight 5 g'],
    ['500吨', '500 t'],
    ['容量 500', 'Capacity 500 for everyday use'],
    ['容量 500', '500，日常使用'],
  ])('accepts preserved identifiers and ordinary translated prose: %s', (facts, copy) => {
    const output = JSON.stringify({ title: copy, highlights: '', description: '', keywords: '' });
    expect(validateOptimizedText({ field: 'listingCopy', text: '生成文案', productContext: { facts, language: 'en' } }, output)).toBe(output);
  });
  it('passes the selected market and language to copy generation and accepts translated words without new specifications', async () => {
    const input = { field: 'exactText' as const, text: 'X20 陶瓷杯 500ml', productContext: { region: 'us', language: 'en' } };
    const result = await optimizeCreativeText(input, async function* (prompt) {
      expect(prompt).toContain('"region":"us"');
      expect(prompt).toContain('"language":"en"');
      expect(prompt).toContain('优先于输入语言');
      yield JSON.stringify({ text: 'X20 ceramic cup 500ml' });
    });
    expect(result.text).toBe('X20 ceramic cup 500ml');
    expect(() => validateOptimizedText(input, 'X30 ceramic cup 600ml')).toThrow();
  });
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
