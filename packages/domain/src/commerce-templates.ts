export const COMMERCE_SCENES = [
  {
    id: "product-main",
    name: "商品主图",
    description: "清晰展示真实商品，适合主图与产品目录。",
    count: 1,
    roles: ["商品主图"],
  },
  {
    id: "product-set",
    name: "商品套图",
    description: "统一规划主图、卖点、细节与使用场景。",
    count: 5,
    roles: ["商品主图", "核心卖点", "材质细节", "使用场景", "商品说明"],
  },
  {
    id: "detail",
    name: "详情图",
    description: "独立详情图片，AI 绘制图文；改字需要重新生成。",
    count: 5,
    roles: ["详情首屏", "核心卖点", "材质细节", "使用场景", "商品说明"],
  },
  {
    id: "social",
    name: "种草图文",
    description: "小红书、抖音图文的封面、场景与细节图片。",
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
] as const;
export const COMMERCE_PLATFORMS = [
  { id: "taobao", name: "淘宝" },
  { id: "douyin", name: "抖音" },
  { id: "xiaohongshu", name: "小红书" },
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
  ] as const
).map(([id, name, guidance]) => ({
  id,
  name,
  guidance,
  version: "1.0.0",
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
