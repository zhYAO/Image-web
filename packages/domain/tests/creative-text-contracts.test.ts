import { describe, expect, it } from 'vitest';
import { creativeListingCopySchema, creativeStrategySchema, creativeTextOptimizeRequestSchema, parseCreativeStrategy } from '../src/creative-text-contracts';

const strategy = { strategy: '主体清晰，背景留白。', modules: [{ name: '品牌首屏', copy: '陶瓷杯' }, { name: '核心卖点', copy: '便于携带' }] };

describe('structured commerce copy contracts', () => {
  it('keeps legacy requests valid and accepts explicit selected modules', () => {
    const legacy = { field: 'strategy', text: '模块：品牌首屏、核心卖点' };
    expect(creativeTextOptimizeRequestSchema.parse(legacy)).toEqual(legacy);
    expect(creativeTextOptimizeRequestSchema.parse({ ...legacy, expectedModules: ['品牌首屏', '核心卖点'] }).expectedModules).toEqual(['品牌首屏', '核心卖点']);
    expect(parseCreativeStrategy(strategy)).toEqual(strategy);
    expect(parseCreativeStrategy(strategy, ['核心卖点', '品牌首屏'])).toEqual(strategy);
  });

  it.each([
    { strategy: '只有策略' },
    { strategy: '空模块', modules: [] },
    { ...strategy, modules: [strategy.modules[0], strategy.modules[0]] },
    { ...strategy, modules: [{ name: '未知模块', copy: '内容' }] },
    { ...strategy, extra: 'unexpected' },
    { ...strategy, modules: [{ name: '品牌首屏', copy: '内容', extra: 'unexpected' }] },
  ])('rejects malformed, duplicate and unknown modules %#', value => {
    expect(() => creativeStrategySchema.parse(value)).toThrow();
  });

  it('rejects missing and unselected modules before accepting the response', () => {
    expect(() => parseCreativeStrategy({ ...strategy, modules: [strategy.modules[0]] }, ['品牌首屏', '核心卖点'])).toThrow();
    expect(() => parseCreativeStrategy(strategy, ['品牌首屏'])).toThrow();
  });

  it.each([
    { field: 'strategy', text: '策划', expectedModules: [] },
    { field: 'strategy', text: '策划', expectedModules: ['品牌首屏', '品牌首屏'] },
    { field: 'strategy', text: '策划', expectedModules: ['未知模块'] },
    { field: 'listingCopy', text: '文案', expectedModules: ['品牌首屏'] },
  ])('rejects ambiguous module requests %#', value => {
    expect(() => creativeTextOptimizeRequestSchema.parse(value)).toThrow();
  });

  it('shares exact listing field limits without silently truncating charged output', () => {
    const listing = { title: '陶瓷杯', highlights: '', description: '', keywords: '' };
    expect(creativeListingCopySchema.parse(listing)).toEqual(listing);
    expect(() => creativeListingCopySchema.parse({ ...listing, title: '字'.repeat(301) })).toThrow();
    expect(() => creativeListingCopySchema.parse({ ...listing, extra: '' })).toThrow();
  });
});
