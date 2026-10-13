import { VISUAL_DIRECTIONS } from "./commerce-visuals";
export const COMMERCE_PRIMARY_SCENE_IDS = ['product-set', 'detail', 'clone', 'product-main', 'apparel-catalog'] as const;
export const COMMERCE_SCENES = [
  { id: "apparel-catalog", name: "服装商品图片", description: "上传五张主图、展示照片与 Logo，按固定版式排出完整商品图。", count: 11, roles: ["服装固定排版"] },
  {
    id: "product-main",
    name: "AI 商品图",
    description: "上传商品，选择场景或自定义要求，生成候选图并继续修改。",
    count: 1,
    roles: ["商品主图"],
  },
  {
    id: "product-set",
    name: "商品套图",
    description: "上传商品、分配白底／卖点／场景／其他图，生成完整上架套图。",
    count: 7,
    roles: ["商品主图", "核心卖点", "材质细节", "使用场景", "商品说明", "卖点延展", "场景延展"],
  },
  {
    id: "detail",
    name: "A+ 详情页",
    description: "先编辑视觉策略与模块文案，再生成普通或高级 A+ 图片。",
    count: 6,
    roles: ["品牌首屏", "核心卖点", "产品展示", "使用场景", "材质细节", "功能介绍"],
  },
  { id: "clone", name: "爆款图复刻", description: "每张参考图独立设置要求，按图逐张生成。", count: 1, roles: ["参考风格"] },
  {
    id: "social",
    name: "种草图文",
    description: "以照片为主的种草套图，展示穿搭、生活场景与商品细节。",
    count: 3,
    roles: ["种草封面", "生活场景", "细节说明"],
  },
  {
    id: "style-reference",
    name: "参考风格",
    description: "用真实商品图保持主体，用参考图表达视觉方向。",
    count: 1,
    roles: ["风格创作"],
  },
  {
    id: "model",
    name: "模特图",
    description: "让商品自然穿着或展示在成年模特场景中。",
    count: 1,
    roles: ["模特展示"],
  },
  { id: "xhs-poster", name: "小红书海报", description: "以标题与正文排版为主的海报，支持商品种草与通用内容分享。", count: 1, roles: ["海报封面", "内容卡片"] },
] as const;
export const COMMERCE_PLATFORMS = [
  { id: "taobao", name: "淘宝" },
  { id: "tmall", name: "天猫" },
  { id: "jd", name: "京东" },
  { id: "pinduoduo", name: "拼多多" },
  { id: "douyin", name: "抖音" },
  { id: "xiaohongshu", name: "小红书" },
  { id: "amazon", name: "Amazon" },
  { id: "shopee", name: "Shopee" },
  { id: "tiktok", name: "TikTok Shop" },
  { id: "shopify", name: "Shopify" },
] as const;
const source = {
  kind: "original" as const,
  inspiration: "https://github.com/freestylefly/awesome-gpt-image-2",
  commit: "b477278bb2a36d4c59655eb0daa4ce48e8dbc4c4",
};
export const COMMERCE_TEMPLATES = (
  [
    ["white-main", "白底主图", "纯白背景，商品居中，保留柔和接触阴影"],
    ["soft-studio", "柔光棚拍", "大面积柔光，简洁背景，准确呈现材质"],
    ["material-detail", "材质特写", "突出可见材质和结构，不创造隐藏的内部结构"],
    ["selling-point", "核心卖点", "清晰主体，信息分层，精简文案，避免遮挡商品"],
    ["spec-layout", "参数版式", "仅呈现已确认参数，无规格信息时省略参数区"],
    ["daily-scene", "日常场景", "自然光，真实生活环境，商品始终为视觉主体"],
    ["handheld", "手持展示", "成年人的自然手持姿态，准确比例，清楚展示商品"],
    [
      "brand-hero",
      "品牌主视觉",
      "统一色调，简洁构图，不添加未经确认的品牌标识",
    ],
    [
      "social-cover",
      "种草封面",
      "生活化构图，清楚标题和留白，避免虚构使用评价",
    ],
    [
      "lifestyle-collage",
      "生活方式拼贴",
      "在单张图片内安排场景与细节，保持同一商品外观",
    ],
    ["detail-hero", "详情首屏", "商品主视觉与简短标题结合，突出已确认核心信息"],
    ["detail-module", "详情模块", "模块化信息层级，主体和文案各有空间"],
    ["xhs-fresh", "清新种草", "清新自然光与轻盈杂志标题"],
    ["xhs-collage", "杂志拼贴", "有秩序的生活摄影拼贴"],
    ["xhs-minimal", "极简大字", "大字与留白构成视觉中心"],
    ["xhs-sketch", "手绘知识卡", "柔和手绘图解与清晰知识模块"],
    ["xhs-checklist", "攻略清单", "编号清单与精简线描插图"],
    ["xhs-retro", "复古海报", "复古印刷肌理与强烈标题"],
  ] as const
).map(([id, name, guidance]) => ({
  id,
  name,
  guidance: `${guidance}。${VISUAL_DIRECTIONS[id]!.guidance}`,
  visual: VISUAL_DIRECTIONS[id]!,
  version: "2.1.0",
  source,
  validation: "待真实模型评测",
  published: true,
}));
export function sceneForSkill(skillId?: string) {
  return skillId === "white-background"
    ? "product-main"
    : skillId === "model"
      ? "model"
      : skillId === "social"
        ? "social"
        : undefined;
}

export function templatesForScene(scene: string) {
  if (scene === 'clone') return COMMERCE_TEMPLATES.filter(t => t.published);
  if (scene === 'product-main') return COMMERCE_TEMPLATES.filter(t => t.published && (t.visual.scenes.includes('product-main') || t.visual.scenes.includes('product-set')));
  return COMMERCE_TEMPLATES.filter(t => t.published && t.visual.scenes.includes(scene));
}
