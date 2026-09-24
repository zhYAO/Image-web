/** Ecommerce workflow choices. These are product defaults; a saved plan retains its own values. */
export const COMMERCE_REGIONS = [
  { id: 'cn', name: '中国大陆' }, { id: 'us', name: '美国' },
  { id: 'eu', name: '欧洲' }, { id: 'jp', name: '日本' },
  { id: 'kr', name: '韩国' }, { id: 'sea', name: '东南亚' },
  { id: 'other', name: '其他地区' },
] as const;
export const COMMERCE_LANGUAGES = [
  { id: 'zh-CN', name: '简体中文' }, { id: 'en', name: '英语' },
  { id: 'ja', name: '日语' }, { id: 'ko', name: '韩语' },
  { id: 'es', name: '西班牙语' }, { id: 'de', name: '德语' },
  { id: 'fr', name: '法语' }, { id: 'none', name: '无文字' },
] as const;
export const PLATFORM_PRESETS: Record<string, { region: typeof COMMERCE_REGIONS[number]['id']; language: typeof COMMERCE_LANGUAGES[number]['id']; aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9' }> = {
  taobao: { region: 'cn', language: 'zh-CN', aspectRatio: '1:1' },
  tmall: { region: 'cn', language: 'zh-CN', aspectRatio: '1:1' },
  jd: { region: 'cn', language: 'zh-CN', aspectRatio: '1:1' },
  pinduoduo: { region: 'cn', language: 'zh-CN', aspectRatio: '1:1' },
  douyin: { region: 'cn', language: 'zh-CN', aspectRatio: '3:4' },
  xiaohongshu: { region: 'cn', language: 'zh-CN', aspectRatio: '3:4' },
  amazon: { region: 'us', language: 'en', aspectRatio: '1:1' },
  shopee: { region: 'sea', language: 'en', aspectRatio: '1:1' },
  tiktok: { region: 'us', language: 'en', aspectRatio: '9:16' },
  shopify: { region: 'us', language: 'en', aspectRatio: '1:1' },
};
export const SELLING_LAYOUTS = [
  '自动分配', '左文右图', '右文左图', '上文下图', '下文上图',
  '居中标题', '顶部标题', '底部标题', '分栏对比', '三栏卖点',
  '编号清单', '图标矩阵', '环绕标注', '侧边标签', '对角构图',
  '卡片堆叠', '杂志留白', '大字聚焦', '产品特写', '场景拼贴',
  '信息阶梯',
] as const;
export const DETAIL_MODULES = [
  '品牌首屏', '核心卖点', '产品展示', '使用场景', '材质细节', '功能介绍',
  '规格参数', '尺寸说明', '结构拆解', '使用步骤', '适用人群', '对比展示',
  '包装内容', '品牌故事', '常见问题', '购买提示',
] as const;
export const APLUS_SPECS = {
  standard: { width: 970, height: 600, label: '普通 A+ · 970 × 600' },
  desktop: { width: 1464, height: 600, label: '高级 A+ 桌面 · 1464 × 600' },
  mobile: { width: 600, height: 450, label: '高级 A+ 移动 · 600 × 450' },
} as const;
/** The providers expose fixed ratios; keep their native frame close to the exported A+ crop. */
export const aPlusAspectRatio = (spec: keyof typeof APLUS_SPECS) => spec === 'mobile' ? '4:3' as const : '16:9' as const;
export const maxCommerceSlots = (scene: string, advanced = false) => scene === 'detail' ? (advanced ? 32 : 16) : scene === 'product-main' ? 4 : scene === 'product-set' || scene === 'clone' ? 20 : 8;
