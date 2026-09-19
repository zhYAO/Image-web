# 当前预览：女装系列 womenswear-v1

2026-09-13：目录七类封面恢复原米杏色双胸袋衬衫套图；18 个模板的目录、工作台及任务预览统一女装题材。模板语义版本仍为 2.0.0，资源版本独立为 womenswear-v1；原 v2 素材保留作历史记录。

白底主图直接复用原图，其余 17 张由内置 imagegen 参考原模特图及商品主图生成。极简大字、手绘知识卡、攻略清单经视觉复查后重生成，最终三张只使用商品主图作参考。图片仅用于风格展示，不参与用户请求，不代表应用内模型验证。所有最终图片已检查女装题材、可读文字与对应风格。

PNG 输出等比缩放、完整留边并编码为 WebP（质量 88）；白底主图直接复制原 WebP。完整预览使用 contain，支持放大。文件、尺寸、SHA-256、来源及最终提示词见 [女装资源清单](womenswear-manifest.json)。

| 模板 | 当前女装预览 | 最终提示词 |
| --- | --- | --- |
| white-main | [预览](../../../apps/web/public/commerce/templates/white-main-womenswear-v1.webp) | [提示词](prompts/white-main-womenswear-v1.md) |
| soft-studio | [预览](../../../apps/web/public/commerce/templates/soft-studio-womenswear-v1.webp) | [提示词](prompts/soft-studio-womenswear-v1.md) |
| material-detail | [预览](../../../apps/web/public/commerce/templates/material-detail-womenswear-v1.webp) | [提示词](prompts/material-detail-womenswear-v1.md) |
| selling-point | [预览](../../../apps/web/public/commerce/templates/selling-point-womenswear-v1.webp) | [提示词](prompts/selling-point-womenswear-v1.md) |
| spec-layout | [预览](../../../apps/web/public/commerce/templates/spec-layout-womenswear-v1.webp) | [提示词](prompts/spec-layout-womenswear-v1.md) |
| daily-scene | [预览](../../../apps/web/public/commerce/templates/daily-scene-womenswear-v1.webp) | [提示词](prompts/daily-scene-womenswear-v1.md) |
| handheld | [预览](../../../apps/web/public/commerce/templates/handheld-womenswear-v1.webp) | [提示词](prompts/handheld-womenswear-v1.md) |
| brand-hero | [预览](../../../apps/web/public/commerce/templates/brand-hero-womenswear-v1.webp) | [提示词](prompts/brand-hero-womenswear-v1.md) |
| social-cover | [预览](../../../apps/web/public/commerce/templates/social-cover-womenswear-v1.webp) | [提示词](prompts/social-cover-womenswear-v1.md) |
| lifestyle-collage | [预览](../../../apps/web/public/commerce/templates/lifestyle-collage-womenswear-v1.webp) | [提示词](prompts/lifestyle-collage-womenswear-v1.md) |
| detail-hero | [预览](../../../apps/web/public/commerce/templates/detail-hero-womenswear-v1.webp) | [提示词](prompts/detail-hero-womenswear-v1.md) |
| detail-module | [预览](../../../apps/web/public/commerce/templates/detail-module-womenswear-v1.webp) | [提示词](prompts/detail-module-womenswear-v1.md) |
| xhs-fresh | [预览](../../../apps/web/public/commerce/templates/xhs-fresh-womenswear-v1.webp) | [提示词](prompts/xhs-fresh-womenswear-v1.md) |
| xhs-collage | [预览](../../../apps/web/public/commerce/templates/xhs-collage-womenswear-v1.webp) | [提示词](prompts/xhs-collage-womenswear-v1.md) |
| xhs-minimal | [预览](../../../apps/web/public/commerce/templates/xhs-minimal-womenswear-v1.webp) | [提示词](prompts/xhs-minimal-womenswear-v1.md) |
| xhs-sketch | [预览](../../../apps/web/public/commerce/templates/xhs-sketch-womenswear-v1.webp) | [提示词](prompts/xhs-sketch-womenswear-v1.md) |
| xhs-checklist | [预览](../../../apps/web/public/commerce/templates/xhs-checklist-womenswear-v1.webp) | [提示词](prompts/xhs-checklist-womenswear-v1.md) |
| xhs-retro | [预览](../../../apps/web/public/commerce/templates/xhs-retro-womenswear-v1.webp) | [提示词](prompts/xhs-retro-womenswear-v1.md) |

## 历史：原 v2 预览

# 创作模板预览 2.0.0

18 张原创预览使用原生 imagegen 生成，随后以 Sharp 等比缩放到宽 1080px、WebP quality 88。模板定义位于 `packages/domain/src/commerce-visuals.ts`；预览通过模板 ID、版本和适用角色绑定，其他分图显示布局说明。图片仅为示例，不作为用户商品参考上传。

提示词按商品事实、图片职责、构图、配色、光线、文字层级及限制组织，参考 [awesome-gpt-image-2 模板指南](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md)；小红书模板借鉴 [baoyu-xhs-images](https://raw.githubusercontent.com/jimliu/baoyu-skills/main/skills/baoyu-xhs-images/SKILL.md) 的风格与布局分离方法。没有照搬其示例图片。

视觉复核：六款海报的主要中文与各自风格已检查；杂志拼贴、手绘知识卡、电商卖点、生活拼贴和详情首屏删除额外文案后重新生成；材质模板重新生成杯沿与杯柄连接处的微距。原始提示词保留，revision-1 为修正版完整要求。完整输出路径及 SQL/测试日志保存在本地忽略目录 `.design-qa/2026-09-13-creative/`。

这些预览不代表应用内 Seedream/Gemini 等模型的实际输出验收；真实商品还原与服务端模型效果需在登录及云端迁移就绪后独立比对。

| 模板 ID | 预览 | 提示词 |
| --- | --- | --- |
| brand-hero | [预览](../../../apps/web/public/commerce/templates/brand-hero-v2.webp) | [最终提示词](prompts/brand-hero-v2.md) |
| daily-scene | [预览](../../../apps/web/public/commerce/templates/daily-scene-v2.webp) | [最终提示词](prompts/daily-scene-v2.md) |
| detail-hero | [预览](../../../apps/web/public/commerce/templates/detail-hero-v2.webp) | [最终提示词](prompts/detail-hero-v2-revision-1.md) |
| detail-module | [预览](../../../apps/web/public/commerce/templates/detail-module-v2.webp) | [最终提示词](prompts/detail-module-v2.md) |
| handheld | [预览](../../../apps/web/public/commerce/templates/handheld-v2.webp) | [最终提示词](prompts/handheld-v2.md) |
| lifestyle-collage | [预览](../../../apps/web/public/commerce/templates/lifestyle-collage-v2.webp) | [最终提示词](prompts/lifestyle-collage-v2-revision-1.md) |
| material-detail | [预览](../../../apps/web/public/commerce/templates/material-detail-v2.webp) | [最终提示词](prompts/material-detail-v2-revision-1.md) |
| selling-point | [预览](../../../apps/web/public/commerce/templates/selling-point-v2.webp) | [最终提示词](prompts/selling-point-v2-revision-1.md) |
| social-cover | [预览](../../../apps/web/public/commerce/templates/social-cover-v2.webp) | [最终提示词](prompts/social-cover-v2.md) |
| soft-studio | [预览](../../../apps/web/public/commerce/templates/soft-studio-v2.webp) | [最终提示词](prompts/soft-studio-v2.md) |
| spec-layout | [预览](../../../apps/web/public/commerce/templates/spec-layout-v2.webp) | [最终提示词](prompts/spec-layout-v2.md) |
| white-main | [预览](../../../apps/web/public/commerce/templates/white-main-v2.webp) | [最终提示词](prompts/white-main-v2.md) |
| xhs-checklist | [预览](../../../apps/web/public/commerce/templates/xhs-checklist-v2.webp) | [最终提示词](prompts/xhs-checklist-v2.md) |
| xhs-collage | [预览](../../../apps/web/public/commerce/templates/xhs-collage-v2.webp) | [最终提示词](prompts/xhs-collage-v2-revision-1.md) |
| xhs-fresh | [预览](../../../apps/web/public/commerce/templates/xhs-fresh-v2.webp) | [最终提示词](prompts/xhs-fresh-v2.md) |
| xhs-minimal | [预览](../../../apps/web/public/commerce/templates/xhs-minimal-v2.webp) | [最终提示词](prompts/xhs-minimal-v2.md) |
| xhs-retro | [预览](../../../apps/web/public/commerce/templates/xhs-retro-v2.webp) | [最终提示词](prompts/xhs-retro-v2.md) |
| xhs-sketch | [预览](../../../apps/web/public/commerce/templates/xhs-sketch-v2.webp) | [最终提示词](prompts/xhs-sketch-v2-revision-1.md) |

[桌面工作台验收截图（Mock）](workbench-desktop-mock.png)：包含海报方案保存后的会话分类、类型徽标和确认生成操作；不代表真实模型输出。
